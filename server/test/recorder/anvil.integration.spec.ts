// End-to-end chain services on anvil (:8548) with the Stubs.sol doubles and a fake Supra REST:
// senders (revert decoding, nonce resync, RBF), faucet, record-on-demand, TP / SL / timeout /
// cash-out, recorder kill + restart with archive backfill, TerminalInvalid and Stalled voids,
// a reorg, finality → progression, and an adaptive-lane change. Postgres is used when
// DATABASE_URL is set (otherwise the in-memory stores).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeEventLog, encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Direction, Outcome, VoidReason } from '@bnbplay/shared/enums';
import { barrierPrices } from '@bnbplay/shared/lane';
import { evaluatePath } from '@bnbplay/shared/path';
import { RoundSchema } from '@bnbplay/shared/dto';
import { Bus } from '../../src/bus.ts';
import { ChainIndexer } from '../../src/indexer/indexer.ts';
import { MemoryIndexerStore, PgIndexerStore } from '../../src/indexer/store.ts';
import type { ChainRound } from '../../src/indexer/types.ts';
import { FaucetDripper } from '../../src/ops/faucet.ts';
import { AdaptiveLanes, MemoryLaneChangeStore } from '../../src/ops/lanes.ts';
import { VoidWatchdog } from '../../src/ops/watchdog.ts';
import { SupraPriceHub } from '../../src/pricehub/hub.ts';
import { MemoryOracleStore, PgOracleStore, type OracleStore } from '../../src/pricehub/store.ts';
import { percentile } from '../../src/pricehub/stats.ts';
import { arenaAbi, checkpointOracleAbi } from '../../src/recorder/abi.ts';
import { Recorder } from '../../src/recorder/recorder.ts';
import { createChainIo, type ChainIo } from '../../src/relayer/chain.ts';
import { createSenders, type Senders } from '../../src/relayer/index.ts';
import { ChainTxSender } from '../../src/relayer/sender.ts';
import { BASE_PRICES, E18, startFakeSupra, type FakeSupra } from '../pricehub/fakeSupra.ts';
import { ANVIL_KEYS, ANVIL_URL, anvilAvailable, anvilRpc, startAnvil } from './harness/anvil.ts';
import { createTestDb, DATABASE_URL, type TestDb } from './harness/db.ts';
import { deployStubs, send, TEST_DURATION_SEC } from './harness/stubs.ts';

const [DEPLOYER, RELAYER, RECORDER, OPS, P1, P2, P3, P4] = ANVIL_KEYS as unknown as Hex[];
const addr = (pk: Hex) => privateKeyToAccount(pk).address;
const STAKE = 10n * E18;
const ppm = (p: bigint, delta: number) => (p * BigInt(1_000_000 + delta)) / 1_000_000n;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs: number, what: string): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

interface PlayerEv {
  player: Address;
  event: string;
  payload: Record<string, unknown>;
}

describe.skipIf(!anvilAvailable())('chain services on anvil', () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let t: TestDb | undefined;
  let chain: ChainIo;
  let pc: PublicClient;
  let stubs: Awaited<ReturnType<typeof deployStubs>>;
  let fake: FakeSupra;
  const bus = new Bus();
  const events: PlayerEv[] = [];
  const chainEvents: { name: string; txHash: Hex; finalized: boolean }[] = [];
  const memStore = new MemoryOracleStore();
  const storeFor = (): OracleStore => (t ? new PgOracleStore(t.db) : memStore);
  let hub: SupraPriceHub;
  let archiver: SupraPriceHub | undefined;
  let senders: Senders;
  let recorderSender: ChainTxSender;
  let indexer: ChainIndexer;
  let recorder: Recorder;
  let watchdog: VoidWatchdog;
  const progressionCalls: bigint[] = [];
  const settledIds: bigint[] = [];

  const newHub = (role: 'leader' | 'archiver') =>
    new SupraPriceHub({ restUrl: fake.url, pollMs: 200, staleMs: 3000, proofRetentionH: 6, roundRetentionD: 3, bus: role === 'leader' ? bus : undefined, store: storeFor(), role, instanceId: role });
  const newRecorder = (h: SupraPriceHub, s: ChainTxSender) =>
    new Recorder({ arena: stubs.arena, hub: h, archive: h.archive, roundBook: indexer.roundBook, sender: s, chain, indexer, bus, reconcileMs: 2000 });

  async function open(pk: Hex, assetId: number, direction: number): Promise<{ id: bigint; entrySec: number; endSec: number }> {
    const data = encodeFunctionData({ abi: arenaAbi, functionName: 'openRound', args: [assetId, 0, direction, STAKE, 1, 0] });
    const w = (await import('./harness/stubs.ts')).wallet(pk);
    const hash = await w.sendTransaction({ to: stubs.arena, data });
    const r = await pc.waitForTransactionReceipt({ hash, pollingInterval: 100 });
    for (const l of r.logs) {
      try {
        const d = decodeEventLog({ abi: arenaAbi, data: l.data, topics: l.topics });
        if (d.eventName === 'RoundOpened') return { id: d.args.roundId, entrySec: d.args.terms.entrySec, endSec: d.args.terms.endSec };
      } catch {
        // other event
      }
    }
    throw new Error('no RoundOpened');
  }

  /** Pins a flat path at the base price over a round's window (earlier scripts may overlap it). */
  const flat = (pairId: number, r: { entrySec: number; endSec: number }) => {
    for (let x = r.entrySec; x <= r.endSec + 5; x++) fake.set(pairId, x, BASE_PRICES[pairId]);
  };
  const settled = (id: bigint) => until(() => { const r = indexer.roundBook.get(id); return r?.status === 'settled' ? r : undefined; }, 60_000, `round ${id} settled`);
  const evs = (player: Address, event: string) => events.filter((e) => e.player.toLowerCase() === player.toLowerCase() && e.event === event);
  const pathFor = (pairId: number) => ({ get: (s: number) => ({ price18: fake.priceAt(pairId, s), disputed: false }), isPermanentlyMissing: () => false });
  const checkpoints = (pairId: number, from: number, to: number) =>
    pc.readContract({ address: stubs.oracle, abi: checkpointOracleAbi, functionName: 'getRange', args: [pairId, from, to] });

  beforeAll(async () => {
    anvil = await startAnvil(['--block-time', '0.5', '--slots-in-an-epoch', '10']);
    t = DATABASE_URL ? await createTestDb() : undefined;
    chain = createChainIo({ chainId: 31337, httpUrls: [ANVIL_URL], sendUrls: [ANVIL_URL, ANVIL_URL], headPollMs: 250 });
    pc = chain.read;
    await chain.heads.start();
    stubs = await deployStubs(pc, DEPLOYER, addr(OPS));
    for (const p of [P1, P2, P3, P4]) await send(pc, p, stubs.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'deposit', args: [1000n * E18] }));
    fake = await startFakeSupra();
    bus.on('player.event', (e) => events.push(e as unknown as PlayerEv));
    bus.on('chain.event', (e) => chainEvents.push({ name: e.name, txHash: e.txHash, finalized: e.finalized }));
    hub = newHub('leader');
    await hub.start();
    senders = createSenders({
      config: {
        RELAYER_PRIVATE_KEY: RELAYER,
        RECORDER_PRIVATE_KEY: RECORDER,
        OPS_PRIVATE_KEY: OPS,
        GAS_PRICE_FLOOR_GWEI: 1,
        GAS_PRICE_MAX_GWEI: 50,
        RECORDER_GAS_PREMIUM: 2,
        RECORDER_REPLACE_AFTER_MS: 1500,
        RELAYER_MIN_BALANCE_BNB: 0.05,
      },
      chain,
      bus,
      db: t?.db,
      overrides: { receiptPollMs: 100 },
    });
    await senders.start();
    recorderSender = senders.recorder as ChainTxSender;
    indexer = new ChainIndexer({
      chain,
      arena: stubs.arena,
      oracles: [stubs.oracle],
      faucet: stubs.faucet,
      startBlock: stubs.deployBlock,
      pollMs: 400,
      bus,
      store: t ? new PgIndexerStore(t.db) : new MemoryIndexerStore(),
      receipts: senders,
      progression: { onRoundFinalized: async (id) => void progressionCalls.push(id) },
      liveWindowBlocks: 10_000,
    });
    await indexer.start();
    recorder = newRecorder(hub, recorderSender);
    await recorder.start();
    watchdog = new VoidWatchdog({ arena: stubs.arena, roundBook: indexer.roundBook, sender: senders.ops as ChainTxSender, chain, intervalMs: 1000 });
    watchdog.start();
  }, 120_000);

  afterAll(async () => {
    watchdog?.stop();
    await recorder?.stop();
    await indexer?.stop();
    await senders?.stop();
    await recorderSender?.stop();
    await hub?.stop();
    await archiver?.stop();
    await fake?.close();
    await chain?.close();
    await anvil?.stop();
    await t?.drop();
  }, 60_000);

  it('senders: a revert is decoded before any nonce is used, and nonce drift self-heals', async () => {
    const relayer = senders.relayer as ChainTxSender;
    const before = await pc.getTransactionCount({ address: relayer.address() });
    const bad = await relayer.enqueue({ key: 'relayer', kind: 'open', to: stubs.arena, data: encodeFunctionData({ abi: arenaAbi, functionName: 'openRound', args: [0, 0, 0, STAKE, 99, 0] }), priority: 1, intentId: 'i-1' }).done;
    expect(bad).toMatchObject({ status: 'failed', errorName: 'LaneVersionMismatch', errorCode: 'LANE_VERSION_MISMATCH' });
    expect(await pc.getTransactionCount({ address: relayer.address() })).toBe(before);
    await send(pc, RELAYER, stubs.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'deposit', args: [1n] })); // behind the sender's back
    const ok = await relayer.enqueue({ key: 'relayer', kind: 'withdraw', to: stubs.arena, data: encodeFunctionData({ abi: arenaAbi, functionName: 'deposit', args: [2n] }), priority: 1 }).done;
    expect(ok.status).toBe('confirmed');
  }, 30_000);

  it('senders: a stuck transaction is replaced by fee', async () => {
    const s = new ChainTxSender({ key: 'ops', privateKey: DEPLOYER, chain, replaceAfterMs: 400, receiptPollMs: 100, gasPriceFloorGwei: 1, gasPriceMaxGwei: 50, premium: 1 });
    await s.start();
    await anvilRpc('evm_setIntervalMining', [0]);
    const h = s.enqueue({ key: 'ops', kind: 'admin', to: stubs.arena, data: encodeFunctionData({ abi: arenaAbi, functionName: 'deposit', args: [3n] }), priority: 1 });
    await sleep(1500);
    await anvilRpc('evm_setIntervalMining', [1]);
    const res = await h.done;
    expect(res.status).toBe('confirmed');
    const tx = await pc.getTransaction({ hash: res.txHash as Hex });
    expect(tx.gasPrice).toBeGreaterThan(10n ** 9n); // mined attempt is a bumped replacement
    await s.stop();
  }, 30_000);

  it('faucet drips credit the ledger via the ops key', async () => {
    const f = new FaucetDripper(stubs.faucet, senders.ops as ChainTxSender, 100);
    const res = await f.drip(addr(P1), { intentId: 'claim-1' }).done;
    expect(res.status).toBe('confirmed');
    expect(evs(addr(P1), 'settlement.step').map((e) => e.payload.step)).toEqual(expect.arrayContaining(['preparing', 'submitted', 'confirmed']));
    await until(() => evs(addr(P1), 'balance').length > 0, 10_000, 'balance event');
  }, 30_000);

  it('records nothing while no round is open', () => {
    expect(recorder.metrics.recordsSent + recorder.metrics.recordSettlesSent).toBe(0);
    expect(hub.latest(49)).toBeDefined();
  });

  it('settles TP, SL, timeout and cash-out rounds from the recorded path', async () => {
    const opened = await Promise.all([open(P1, 0, Direction.Long), open(P2, 2, Direction.Long), open(P3, 3, Direction.Short), open(P4, 4, Direction.Long)]);
    const [bnb, eth, sol, doge] = opened;
    for (let s = bnb.entrySec + 4; s <= bnb.endSec + 5; s++) fake.set(49, s, ppm(BASE_PRICES[49], 300)); // ≥ T 226
    for (let s = eth.entrySec + 3; s <= eth.endSec + 5; s++) fake.set(1, s, ppm(BASE_PRICES[1], -600)); // ≥ S 507 (LONG loses)
    for (let s = sol.entrySec + 1; s <= sol.endSec + 5; s += 2) fake.set(10, s, ppm(BASE_PRICES[10], 50));
    for (let s = doge.entrySec + 1; s <= doge.endSec + 5; s++) fake.set(3, s, ppm(BASE_PRICES[3], 100));
    await until(() => chain.heads.nowSec() >= doge.entrySec + 1, 10_000, 'cash-out window');
    await send(pc, P4, stubs.arena, encodeFunctionData({ abi: arenaAbi, functionName: 'requestCashOut', args: [doge.id] }));

    const rounds = await Promise.all(opened.map((o) => settled(o.id)));
    settledIds.push(...opened.map((o) => o.id));
    const [rb, re, rs, rd] = rounds;
    expect(rb).toMatchObject({ outcome: Outcome.TargetHit, decisionSec: bnb.entrySec + 4, payout: (STAKE * 15_000n) / 10_000n, entryPrice: BASE_PRICES[49] });
    expect(re).toMatchObject({ outcome: Outcome.StopHit, decisionSec: eth.entrySec + 3, payout: 0n });
    expect(rs).toMatchObject({ outcome: Outcome.Timeout, decisionSec: sol.endSec });
    expect(rd.outcome).toBe(Outcome.CashedOut);
    expect(rd.decisionSec).toBe(rd.exitSec);
    for (const r of rounds) {
      const ev = evaluatePath(r.terms, pathFor(r.pairId), chain.heads.nowSec());
      expect(ev.decidable && ev.payout).toBe(r.payout);
      expect(RoundSchema.parse(indexer.roundBook.toDTO(r.roundId)).status).toBe('settled');
    }
    const full = await checkpoints(10, sol.entrySec, sol.endSec);
    expect(full.every((c) => (c.flags & 1) === 1)).toBe(true);
    expect(full).toHaveLength(TEST_DURATION_SEC + 1);

    await until(() => evs(addr(P4), 'round.exit_locked').length === 1, 10_000, 'exit_locked');
    for (const [pk, r] of [[P1, rb], [P2, re], [P3, rs], [P4, rd]] as const) {
      for (const e of ['round.opened', 'round.entry_locked', 'round.settled']) expect(evs(addr(pk), e), `${e} for ${r.roundId}`).toHaveLength(1);
      expect(evs(addr(pk), 'round.entry_locked')[0].payload.entryPrice).toBe(BASE_PRICES[r.pairId].toString());
      const steps = evs(addr(pk), 'settlement.step').filter((e) => e.payload.kind === 'settle' && e.payload.roundId === r.roundId.toString()).map((e) => e.payload.step);
      expect(steps).toContain('confirmed');
    }
    const touchT = evs(addr(P1), 'round.touch')[0].payload;
    expect(touchT).toMatchObject({ kind: 'target', sec: bnb.entrySec + 4, thresholdPrice: barrierPrices(Direction.Long, BASE_PRICES[49], 226, 434).target.toString() });
    expect(evs(addr(P2), 'round.touch')[0].payload).toMatchObject({ kind: 'stop', sec: eth.entrySec + 3 });
    expect(evs(addr(P3), 'round.touch')).toHaveLength(0);
    expect(evs(addr(P4), 'round.cashout_requested')).toHaveLength(1);
    const lags = recorder.metrics.inclusionLagMs;
    console.log(`[recorder] checkpoint confirmed at round start + ${percentile(lags, 0.5)} ms p50 / ${percentile(lags, 0.95)} ms p95 (n=${lags.length}, anvil 0.5-1 s blocks)`);
    expect(percentile(lags, 0.5)).toBeLessThan(3000);
    const last = await pc.readContract({ address: stubs.oracle, abi: checkpointOracleAbi, functionName: 'latestKnownSec', args: [49] });
    expect(last).toBeLessThanOrEqual(Math.max(...opened.map((o) => o.endSec)) + 1); // record on demand only
  }, 90_000);

  it('survives a recorder + hub crash mid-round by backfilling from the archive', async () => {
    archiver = newHub('archiver');
    await archiver.start();
    const r = await open(P2, 2, Direction.Short);
    flat(1, r);
    await until(async () => (await pc.readContract({ address: stubs.oracle, abi: checkpointOracleAbi, functionName: 'lastRecordedSec', args: [1] })) >= r.entrySec + 3, 20_000, 'first seconds recorded');
    await recorder.stop();
    await hub.stop();
    await recorderSender.stop();
    await sleep(4500); // seconds only the archiver captures
    hub = newHub('leader');
    await hub.start();
    recorderSender = new ChainTxSender({ key: 'recorder', privateKey: RECORDER, chain, bus, replaceAfterMs: 1500, receiptPollMs: 100, gasPriceFloorGwei: 1, gasPriceMaxGwei: 50, premium: 2 });
    await recorderSender.start();
    recorder = newRecorder(hub, recorderSender);
    await recorder.start();
    const done = await settled(r.id);
    settledIds.push(r.id);
    expect(done.outcome).toBe(Outcome.Timeout);
    expect(recorder.metrics.backfillsSent).toBeGreaterThanOrEqual(3);
    expect((await checkpoints(1, r.entrySec, r.endSec)).every((c) => (c.flags & 1) === 1)).toBe(true);
  }, 90_000);

  it('voids with TerminalInvalid when the terminal second jumps beyond maxJumpPpm', async () => {
    const r = await open(P1, 0, Direction.Long);
    flat(49, r);
    fake.set(49, r.endSec, ppm(BASE_PRICES[49], 20_000)); // BNB maxJump 15 000 ppm
    const done = await settled(r.id);
    settledIds.push(r.id);
    expect(done).toMatchObject({ outcome: Outcome.Voided, voidReason: VoidReason.TerminalInvalid, payout: STAKE });
    await until(() => evs(addr(P1), 'round.voided').some((e) => e.payload.roundId === r.id.toString()), 10_000, 'round.voided');
    expect(evs(addr(P1), 'round.voided').at(-1)?.payload).toMatchObject({ reason: 'terminal_invalid', payout: STAKE.toString() });
  }, 60_000);

  it('the watchdog voids a round whose seconds were never captured (Stalled)', async () => {
    const r = await open(P3, 3, Direction.Long);
    flat(10, r);
    await until(() => Date.now() / 1000 >= r.entrySec + 1.35, 10_000, 'entry+1');
    fake.outageUntilMs = Date.now() + 3200; // nobody captures entry+2 … entry+4
    await sleep(4000);
    expect(indexer.roundBook.get(r.id)?.status).toBe('open');
    await anvilRpc('evm_increaseTime', [TEST_DURATION_SEC + 80]);
    await anvilRpc('evm_mine', []);
    const done = await settled(r.id);
    settledIds.push(r.id);
    expect(done).toMatchObject({ outcome: Outcome.Voided, voidReason: VoidReason.Stalled, payout: STAKE });
    expect(watchdog.voided).toBeGreaterThanOrEqual(1);
    expect(evs(addr(P3), 'settlement.step').some((e) => e.payload.kind === 'void' && e.payload.step === 'confirmed')).toBe(true);
  }, 90_000);

  it('undoes the events of reorged blocks', async () => {
    const r = await open(P4, 1, Direction.Long);
    await until(() => indexer.roundBook.get(r.id), 10_000, 'open indexed');
    const head = await pc.getBlockNumber();
    const openBlock = indexer.roundBook.get(r.id)!.openBlock;
    await anvilRpc('anvil_reorg', [Number(head - openBlock) + 1, []]);
    await until(() => indexer.roundBook.get(r.id) === undefined, 15_000, 'reorged round removed');
    expect(indexer.roundBook.activeFor(addr(P4))).toBeUndefined();
    const onChain = await pc.readContract({ address: stubs.arena, abi: arenaAbi, functionName: 'getRound', args: [r.id] });
    expect(onChain.status).toBe(0);
    await sleep(1500);
    const s = indexer.status();
    const cur = await pc.getBlock({ blockNumber: BigInt(s.cursor as string) });
    expect(cur.number).toBeGreaterThan(0n); // cursor points at a canonical block again
  }, 60_000);

  it('hands finalized settlements to progression exactly once', async () => {
    await until(() => settledIds.every((id) => progressionCalls.includes(id)), 45_000, 'progression for every settled round');
    expect(new Set(progressionCalls.map(String)).size).toBe(progressionCalls.length);
    expect(settledIds.every((id) => (indexer.roundBook.get(id) as ChainRound).settleFinalized)).toBe(true);
    expect(chainEvents.some((e) => e.name === 'RoundSettled' && e.finalized)).toBe(true);
    if (t) {
      const [{ n }] = await t.sql`select count(*)::int as n from rounds where status = 'settled' and settle_finalized`;
      expect(n).toBeGreaterThanOrEqual(settledIds.length);
      const [{ c }] = await t.sql`select count(*)::int as c from relayer_txs where status = 'confirmed' and key = 'recorder'`;
      expect(c).toBeGreaterThan(20);
    }
  }, 60_000);

  it('adaptive lanes halve BNB CRUISE when σ drops, through tuneLane on the ops key', async () => {
    const store = new MemoryLaneChangeStore();
    const lanes = new AdaptiveLanes({ arena: stubs.arena, hub: { sigmaBipower: () => ({ sigmaPpm: 25, samples: 1800 }) }, sender: senders.ops as ChainTxSender, chain, store, enabled: () => true, intervalMin: 10 });
    const out = await lanes.runOnce();
    expect(out.find((a) => a.assetId === 1)?.tiers.find((x) => x.tier === 1)?.reason).toBe('disabled in the base table');
    const bnb = await until(async () => {
      const l = await pc.readContract({ address: stubs.arena, abi: arenaAbi, functionName: 'getLane', args: [0, 0] });
      return l.version === 2 ? l : undefined;
    }, 20_000, 'tuneLane mined');
    expect(bnb.p).toMatchObject({ targetPpm: 113, stopPpm: 217, multiplierBps: 15_000, durationSec: TEST_DURATION_SEC, enabled: true });
    await until(() => [...store.rows.values()].some((r) => r.assetId === 0 && r.status === 'confirmed' && r.toVersion === 2), 10_000, 'lane_changes row');
    expect((await lanes.runOnce()).find((a) => a.assetId === 0)?.tiers[0].action).toBe('keep');
    const disabled = await new AdaptiveLanes({ arena: stubs.arena, hub: { sigmaBipower: () => ({ sigmaPpm: 25, samples: 1800 }) }, sender: senders.ops as ChainTxSender, chain, enabled: () => false, intervalMin: 10 }).runOnce();
    expect(disabled).toEqual([]);
  }, 60_000);
});
