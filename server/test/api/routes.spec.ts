import { describe, expect, it } from 'vitest';
import { ConfigSchema, MarketSnapshotSchema, RoundSchema } from '@bnbplay/shared/dto';
import { validateLane } from '@bnbplay/shared/lane';
import { SSE_EVENTS } from '@bnbplay/shared/sse';
import { mapRevertToCode } from '../../src/api/errors.ts';
import { fixtureAssets } from '../../src/api/lanes.fixture.ts';
import { CalibrationSchema, OracleRoundsSchema } from '../../src/api/public.router.ts';
import { E18, makeHarness, roundDto, signCashOut, signOpen, signWithdraw, tick } from './helpers.ts';

type Err = { error: { code: string; message: string; retryAfterMs?: number } };
const code = async (res: Response) => ((await res.json()) as Err).error.code;
const nowSec = (h: { clock: { t: number } }) => Math.floor(h.clock.t / 1000);

describe('GET /v1/config', () => {
  it('serves the F1e lanes (CRUISE+BOOST live, BTC BOOST off, HYPER/WARP coming soon)', async () => {
    const h = makeHarness();
    const res = await h.request('/v1/config');
    expect(res.status).toBe(200);
    const cfg = ConfigSchema.parse(await res.json());
    expect(cfg.chainId).toBe(97);
    expect(cfg.contracts?.arena).toBeDefined();
    expect(cfg.entryDelaySec).toBe(3);
    expect(cfg.features).toEqual({ pixLlm: false, faucet: true, walletConnect: true });
    const bnb = cfg.assets.find((a) => a.symbol === 'BNB');
    expect(bnb?.tiers.map((t) => [t.label, t.enabled, t.targetPpm, t.stopPpm])).toEqual([
      ['CRUISE', true, 226, 434],
      ['BOOST', true, 291, 262],
      ['HYPER', false, 718, 276],
      ['WARP', false, 1526, 276],
    ]);
    expect(cfg.assets.find((a) => a.symbol === 'BTC')?.tiers[1]?.enabled).toBe(false);
  });

  it('every fixture lane passes the on-chain setLane guard', () => {
    for (const a of fixtureAssets()) {
      for (const t of a.tiers) {
        const errors = validateLane({ ...t, minStake: BigInt(t.minStake), maxStake: BigInt(t.maxStake) }, a.gapMarginPpm);
        expect(errors, `${a.symbol} ${t.label}`).toEqual([]);
      }
    }
  });
});

describe('market and oracle audit', () => {
  it('serves snapshots, recorded rounds, proofs and calibration', async () => {
    const h = makeHarness();
    h.hub.seed(49, 1000, [600n * E18, 601n * E18, 602n * E18]);
    const snaps = await (await h.request('/v1/market/snapshots')).json();
    expect(MarketSnapshotSchema.array().parse(snaps)).toHaveLength(1);

    const rounds = OracleRoundsSchema.parse(await (await h.request('/v1/oracle/rounds?asset=BNB&fromSec=1001')).json());
    expect(rounds.map((r) => r.sec)).toEqual([1001, 1002]);

    const proofHash = rounds[0]?.proofHash as string;
    const proof = await h.request(`/v1/oracle/proof/${proofHash}`);
    expect(proof.status).toBe(200);
    expect((await h.request(`/v1/oracle/proof/0x${'00'.repeat(32)}`)).status).toBe(404);

    const cal = CalibrationSchema.parse(await (await h.request('/v1/oracle/calibration')).json());
    expect(cal.assets.find((a) => a.asset === 'BNB')?.tiers[0]?.backtest?.pTP).toBeCloseTo(0.323, 3);
    expect((await h.request('/v1/oracle/rounds?asset=XRP')).status).toBe(400);
  });
});

describe('POST /v1/rounds/open', () => {
  it('validates, enqueues on the relayer key and is idempotent by intent hash', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    const body = JSON.stringify(await signOpen(account, { deadline: nowSec(h) + 5 }));
    const res = await h.request('/v1/rounds/open', { method: 'POST', body, token });
    expect(res.status).toBe(202);
    const out = (await res.json()) as { intentId: string; intentHash: string };
    expect(out.intentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h.relayer.jobs).toHaveLength(1);
    expect(h.relayer.jobs[0]).toMatchObject({ key: 'relayer', kind: 'open', to: '0x1111111111111111111111111111111111111111', intentId: out.intentId });

    const again = await h.request('/v1/rounds/open', { method: 'POST', body, token });
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual(out);
    expect(h.relayer.jobs).toHaveLength(1);
  });

  it('maps a failed open to round.open_failed (stake not taken) and settlement.step failed', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    await h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(await signOpen(account, { deadline: nowSec(h) + 5 })), token });
    const job = h.relayer.jobs[0];
    if (!job) throw new Error('no job');
    h.bus.emit('tx.step', { id: job.handleId, kind: 'open', step: 'submitted', intentId: job.intentId, txHash: `0x${'aa'.repeat(32)}` });
    h.bus.emit('tx.step', { id: job.handleId, kind: 'open', step: 'failed', intentId: job.intentId, error: 'execution reverted: PlayerHasOpenRound(7)' });
    h.relayer.finish(job.handleId, { status: 'failed', error: 'PlayerHasOpenRound(7)' });
    await tick(5);
    const steps = h.events.filter((e) => e.event === 'settlement.step').map((e) => SSE_EVENTS['settlement.step'].parse(e.payload));
    expect(steps.map((s) => s.step)).toEqual(['submitted', 'failed']);
    expect(steps[1]?.error?.code).toBe('ROUND_ALREADY_ACTIVE');
    const failed = h.events.find((e) => e.event === 'round.open_failed');
    expect(failed?.payload).toMatchObject({ intentId: job.intentId, code: 'ROUND_ALREADY_ACTIVE', stakeTaken: false });
    expect(failed?.player).toBe(account.address);
  });

  it('rejects bad intents with the F1b codes', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    const open = async (o: Parameters<typeof signOpen>[1], tok = token) =>
      h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(await signOpen(account, o)), token: tok });
    const d = nowSec(h) + 5;

    expect(await code(await open({ deadline: nowSec(h) }))).toBe('INTENT_EXPIRED');
    expect(await code(await open({ deadline: d, laneVersion: 2 }))).toBe('LANE_VERSION_MISMATCH');
    expect(await code(await open({ deadline: d, assetId: 1, tier: 1 }))).toBe('TIER_DISABLED'); // BTC BOOST
    expect(await code(await open({ deadline: d, tier: 2 }))).toBe('TIER_DISABLED'); // HYPER coming soon
    expect(await code(await open({ deadline: d, stake: 1n * E18 }))).toBe('VALIDATION');
    h.hub.statusValue = 'degraded';
    expect(await code(await open({ deadline: d }))).toBe('ORACLE_UNAVAILABLE');
    h.hub.statusValue = 'ok';
    h.relayer.balance = 10n ** 15n;
    expect(await code(await open({ deadline: d }))).toBe('RELAYER_UNFUNDED');
    h.relayer.balance = 10n ** 18n;
    h.clock.t += 16_000; // relayer balance is cached for 15 s
    const d2 = nowSec(h) + 5;
    h.roundBook.put(roundDto({ roundId: 9n, player: account.address, entrySec: nowSec(h), status: 'open' }));
    expect(await code(await open({ deadline: d2 }))).toBe('ROUND_ALREADY_ACTIVE');

    const tampered = await signOpen(account, { deadline: d2 });
    tampered.intent.stake = (20n * E18).toString();
    expect(await code(await h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(tampered), token }))).toBe('BAD_SIGNATURE');
    const other = await h.login();
    expect((await open({ deadline: d2 }, other.token)).status).toBe(403);
    expect(h.relayer.jobs).toHaveLength(0);
  });

  it('rate-limits to one launch per 3 s per player', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    const d = nowSec(h) + 5;
    expect((await h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(await signOpen(account, { deadline: d })), token })).status).toBe(202);
    const second = await h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(await signOpen(account, { deadline: d, seq: 1n })), token });
    expect(second.status).toBe(429);
    expect(((await second.json()) as Err).error.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('cash-out, withdraw, rounds and balance', () => {
  it('enqueues a cash-out, or answers CASHOUT_TOO_LATE near the end', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    h.roundBook.put(roundDto({ roundId: 5n, player: account.address, entrySec: nowSec(h) - 10, status: 'open' }));
    const ok = await h.request('/v1/rounds/5/cashout', { method: 'POST', body: JSON.stringify(await signCashOut(account, 5n, nowSec(h) + 3)), token });
    expect(ok.status).toBe(202);
    expect(h.relayer.jobs[0]).toMatchObject({ kind: 'cashout', roundId: 5n, priority: 100 });

    h.roundBook.put(roundDto({ roundId: 6n, player: account.address, entrySec: nowSec(h) - 28, status: 'open' }));
    const late = await h.request('/v1/rounds/6/cashout', { method: 'POST', body: JSON.stringify(await signCashOut(account, 6n, nowSec(h) + 3)), token });
    expect(await code(late)).toBe('CASHOUT_TOO_LATE');
    const missing = await h.request('/v1/rounds/77/cashout', { method: 'POST', body: JSON.stringify(await signCashOut(account, 77n, nowSec(h) + 3)), token });
    expect(missing.status).toBe(404);
  });

  it('withdraws, serves rounds and the balance with the locked stake', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    const w = await h.request('/v1/me/withdraw', { method: 'POST', body: JSON.stringify(await signWithdraw(account, 5n * E18, nowSec(h) + 60)), token });
    expect(w.status).toBe(202);
    expect(h.relayer.jobs[0]?.kind).toBe('withdraw');

    h.roundBook.put(roundDto({ roundId: 3n, player: account.address, entrySec: nowSec(h), status: 'open', stake: 7n * E18 }));
    h.bus.emit('player.event', { player: account.address, event: 'balance', payload: { available: (93n * E18).toString(), locked: (7n * E18).toString() } });
    const bal = (await (await h.request('/v1/me/balance', { token })).json()) as { available: string; locked: string };
    expect(bal).toEqual({ available: (93n * E18).toString(), locked: (7n * E18).toString() });

    const round = await h.request('/v1/rounds/3');
    expect(RoundSchema.parse(await round.json()).roundId).toBe('3');
    expect((await h.request('/v1/rounds/404')).status).toBe(404);
    const page = (await (await h.request(`/v1/players/${account.address}/rounds`)).json()) as { items: unknown[]; nextCursor: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('answers 503 when the arena is not deployed', async () => {
    const h = makeHarness({ deps: { contracts: null, senders: {} } });
    const { token, account } = await h.login();
    const res = await h.request('/v1/rounds/open', { method: 'POST', body: JSON.stringify(await signOpen(account, { deadline: nowSec(h) + 5 })), token });
    expect(res.status).toBe(503);
    expect(((await (await h.request('/v1/config')).json()) as { contracts: unknown }).contracts).toBeNull();
  });
});

describe('API hygiene', () => {
  it('uses the error envelope for validation errors and unknown routes', async () => {
    const h = makeHarness();
    const bad = await h.request('/v1/auth/challenge', { method: 'POST', body: '{"address":"nope"}' });
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe('VALIDATION');
    expect((await h.request('/v1/nope')).status).toBe(404);
  });

  it('limits every IP hash to 120 requests per minute', async () => {
    const h = makeHarness();
    for (let i = 0; i < 120; i++) await h.request('/v1/leaderboard', { ip: '10.9.9.9' });
    const res = await h.request('/v1/leaderboard', { ip: '10.9.9.9' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect((await h.request('/v1/leaderboard', { ip: '10.9.9.10' })).status).toBe(200);
  });

  it('maps revert names and selectors to API codes', () => {
    expect(mapRevertToCode('InsufficientBalance(1, 2)')).toBe('INSUFFICIENT_CREDITS');
    expect(mapRevertToCode('LaneDisabled(1,1)')).toBe('TIER_DISABLED');
    expect(mapRevertToCode('reverted with 0x8baa579f')).toBe('BAD_SIGNATURE'); // InvalidSignature()
    expect(mapRevertToCode('StakeOutOfRange(1,2,3)')).toBe('INTERNAL');
  });
});
