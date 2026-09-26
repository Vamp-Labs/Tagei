// Recorder + settler (F1a v2 §7, A3 handoff §3 and v2 notes).
//
// Record on demand: while a round is open, every second of its [entrySec, endSec] window is sent
// to its CheckpointOracle as soon as the hub sees the Supra round. When the local evaluatePath
// (recorded ∪ in-flight ∪ this proof) says a round becomes decidable at that second, the tx is
// `recordAndSettle(oracleIdx, proof, ids)` instead of `record(proof)`. Stateless verification makes
// late records valid, so any missing second of an open round is backfilled from the proof archive
// (memory, then the shared oracle_proofs table) until endSec + STALL_AFTER_SEC. Rounds decidable
// from recorded checkpoints alone go out as `settleMany`. Reconcile runs every 5 s and on boot
// against on-chain `getRange`. Stalled / gap voids are left to the ops voidStale watchdog.
// Player events: round.entry_locked, round.touch and round.exit_locked once the checkpoints behind
// them are on chain.

import { encodeFunctionData, parseEventLogs, zeroAddress, type Address, type Hex, type TransactionReceipt } from 'viem';
import { MAX_RANGE_SECONDS, MAX_ROUND_IDS_PER_SETTLE, STALL_AFTER_SEC } from '@bnbplay/shared/constants';
import { Outcome, VoidReason } from '@bnbplay/shared/enums';
import { barrierPrices } from '@bnbplay/shared/lane';
import { evaluatePath, type Evaluation } from '@bnbplay/shared/path';
import { decodeSupraProof, isCanonicalRound, toPrice18 } from '@bnbplay/shared/supra';
import type { Bus } from '../bus.ts';
import type { OracleRound, PriceHub } from '../ports.ts';
import type { ChainRoundBook } from '../indexer/roundBook.ts';
import type { ChainRound, StoredEvent } from '../indexer/types.ts';
import type { ProofArchive } from '../pricehub/hub.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import type { ChainTxSender, TxResult } from '../relayer/sender.ts';
import { arenaAbi, checkpointEventsAbi, checkpointOracleAbi } from './abi.ts';

export const PRIORITY = { backfill: 120, record: 100, settle: 90 } as const;
/** Gas allowance per settled round on top of the estimate (estimates can run on a state where the settle is skipped). */
export const SETTLE_GAS_PER_ROUND = 300_000n;
export const RECORD_GAS_ALLOWANCE = 600_000n;
const MAX_FAILURES = 3;

interface Cp {
  price18: bigint;
  disputed: boolean;
  state: 'onchain' | 'pending';
  jobId?: string;
}

interface Pending {
  jobId: string;
  oracleIdx: number;
  sec: number;
  ids: bigint[];
  kind: 'record' | 'record_settle';
  proofHash: Hex;
  feeds: { pairId: number; sec: number; price18: bigint }[];
  roundMs: number;
}

export interface RecorderIndexerView {
  oracleAddress(idx: number): Address | undefined;
  onLogs(cb: (events: StoredEvent[]) => void): () => void;
}

export interface RecorderOptions {
  arena: Address;
  hub: PriceHub & { proofFor?(pairId: number, sec: number): { proof: Hex; proofHash: Hex } | undefined };
  archive: ProofArchive;
  roundBook: ChainRoundBook;
  sender: ChainTxSender;
  chain: ChainIo;
  indexer?: RecorderIndexerView;
  bus?: Bus;
  log?: Logger;
  reconcileMs?: number;
}

export interface RecorderMetrics {
  recordsSent: number;
  recordSettlesSent: number;
  settleManySent: number;
  backfillsSent: number;
  confirmed: number;
  failed: number;
  /** receipt seen − round start (ms), newest last (bounded). */
  inclusionLagMs: number[];
}

export class Recorder {
  private readonly o: RecorderOptions;
  private readonly log: Logger;
  private readonly cps = new Map<string, Cp>();
  private readonly pending = new Map<string, Pending>();
  private readonly settling = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly emitted = new Set<string>();
  private readonly oracleAddrs = new Map<number, Address>();
  private readonly seenSecs = new Set<number>();
  private readonly unsubs: (() => void)[] = [];
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private busy: Promise<void> = Promise.resolve();
  readonly metrics: RecorderMetrics = { recordsSent: 0, recordSettlesSent: 0, settleManySent: 0, backfillsSent: 0, confirmed: 0, failed: 0, inclusionLagMs: [] };

  constructor(opts: RecorderOptions) {
    this.o = opts;
    this.log = opts.log ?? silentLogger;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.o.bus) {
      this.unsubs.push(
        this.o.bus.on('oracle.round', (r) => {
          if (this.seenSecs.has(r.sec)) return;
          this.seenSecs.add(r.sec);
          if (this.seenSecs.size > 600) this.seenSecs.delete(this.seenSecs.values().next().value as number);
          void this.serial(() => this.onSecond(r));
        }),
      );
    }
    if (this.o.indexer) this.unsubs.push(this.o.indexer.onLogs((evs) => void this.serial(async () => this.onChainEvents(evs))));
    await this.serial(() => this.reconcile());
    this.timer = setInterval(() => void this.serial(() => this.reconcile()), this.o.reconcileMs ?? 5000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    for (const u of this.unsubs.splice(0)) u();
    await this.busy;
  }

  status() {
    return { pending: this.pending.size, settling: this.settling.size, metrics: this.metrics };
  }

  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.busy.then(fn).catch((err) => this.log.error('recorder step failed', { error: errorMessage(err) }));
    this.busy = next;
    return next;
  }

  // ── bookkeeping ───────────────────────────────────────────────────────────

  private key(oracleIdx: number, pairId: number, sec: number): string {
    return `${oracleIdx}:${pairId}:${sec}`;
  }

  private cp(oracleIdx: number, pairId: number, sec: number): Cp | undefined {
    return this.cps.get(this.key(oracleIdx, pairId, sec));
  }

  private setOnchain(oracleIdx: number, pairId: number, sec: number, price18: bigint, disputed: boolean): void {
    const k = this.key(oracleIdx, pairId, sec);
    const prev = this.cps.get(k);
    this.cps.set(k, { price18: prev?.state === 'onchain' && !disputed ? prev.price18 : price18, disputed: disputed || (prev?.disputed ?? false), state: 'onchain' });
  }

  private async oracleAddress(idx: number): Promise<Address | undefined> {
    const known = this.oracleAddrs.get(idx) ?? this.o.indexer?.oracleAddress(idx);
    if (known) {
      this.oracleAddrs.set(idx, known);
      return known;
    }
    try {
      const a = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'oracles', args: [BigInt(idx)] });
      if (a === zeroAddress) return undefined;
      this.oracleAddrs.set(idx, a.toLowerCase() as Address);
      return a;
    } catch {
      return undefined;
    }
  }

  private oracleIndexOf(address: Address): number | undefined {
    const a = address.toLowerCase();
    for (const [i, x] of this.oracleAddrs) if (x.toLowerCase() === a) return i;
    for (let i = 0; i < 16; i++) {
      const x = this.o.indexer?.oracleAddress(i);
      if (!x) break;
      if (x.toLowerCase() === a) {
        this.oracleAddrs.set(i, x);
        return i;
      }
    }
    return undefined;
  }

  private evaluate(r: ChainRound, includePending: boolean, extra?: Map<string, bigint>): Evaluation {
    return evaluatePath(
      r.terms,
      {
        get: (sec) => {
          const x = extra?.get(`${r.pairId}:${sec}`);
          if (x !== undefined) return { price18: x, disputed: false };
          const c = this.cp(r.oracleIdx, r.pairId, sec);
          if (!c || (!includePending && c.state !== 'onchain')) return undefined;
          return { price18: c.price18, disputed: c.disputed };
        },
        isPermanentlyMissing: () => false, // stateless (late-capable) oracle
      },
      this.o.chain.heads.nowSec(),
    );
  }

  /** Decidable, and not a stall/gap void (those belong to the ops voidStale watchdog). */
  private settleable(e: Evaluation): boolean {
    return e.decidable && !(e.outcome === Outcome.Voided && (e.voidReason === VoidReason.Stalled || e.voidReason === VoidReason.CheckpointGap));
  }

  private openRounds(): ChainRound[] {
    return this.o.roundBook.open().filter((r) => !this.settling.has(r.roundId.toString()));
  }

  private latestSec(pairId: number): number | undefined {
    return this.o.hub.latest(pairId)?.sec;
  }

  // ── triggers ──────────────────────────────────────────────────────────────

  private async onSecond(r: OracleRound): Promise<void> {
    if (!this.running) return;
    await this.plan(r.sec);
  }

  private onChainEvents(events: StoredEvent[]): void {
    const touched = new Set<number>();
    for (const e of events) {
      if (e.name !== 'CheckpointRecorded' && e.name !== 'CheckpointDisputed') continue;
      const idx = this.oracleIndexOf(e.address);
      if (idx === undefined) continue;
      const a = e.args as { pairId: number; sec: number; price18?: bigint; recorded?: bigint };
      this.setOnchain(idx, a.pairId, a.sec, (a.price18 ?? a.recorded) as bigint, e.name === 'CheckpointDisputed');
      touched.add(idx);
    }
    if (touched.size > 0) this.emitLocks([]);
  }

  // ── planning ──────────────────────────────────────────────────────────────

  private async proofFor(pairId: number, sec: number): Promise<{ proof: Hex; proofHash: Hex } | undefined> {
    const mem = this.o.hub.proofFor?.(pairId, sec);
    if (mem) return mem;
    try {
      return await this.o.archive.find(pairId, sec);
    } catch (err) {
      this.log.warn('archive lookup failed', { pairId, sec, error: errorMessage(err) });
      return undefined;
    }
  }

  private feedsOf(proof: Hex): { pairId: number; sec: number; price18: bigint }[] {
    return decodeSupraProof(proof)
      .filter((f) => isCanonicalRound(f))
      .map((f) => ({ pairId: f.pairId, sec: Number(f.roundMs / 1000n), price18: toPrice18(f.price, f.decimals) }));
  }

  /** One planning pass; `newSec` is the Supra second that just arrived (if any). */
  private async plan(newSec?: number): Promise<void> {
    const rounds = this.openRounds();
    if (rounds.length === 0) return;
    const now = this.o.chain.heads.nowSec();
    const byOracle = new Map<number, ChainRound[]>();
    for (const r of rounds) (byOracle.get(r.oracleIdx) ?? byOracle.set(r.oracleIdx, []).get(r.oracleIdx)!).push(r);

    const inTx = new Set<string>();
    for (const [idx, group] of byOracle) {
      const oracle = await this.oracleAddress(idx);
      if (!oracle) {
        this.log.warn('unknown oracle index for open rounds', { oracleIdx: idx });
        continue;
      }
      // 1. backfill every missing past second (records land before the new second by priority).
      for (const r of group) {
        if (now > r.terms.endSec + STALL_AFTER_SEC) continue;
        const last = Math.min(r.terms.endSec, this.latestSec(r.pairId) ?? -1);
        for (let s = r.terms.entrySec; s <= last; s++) {
          if (s === newSec || this.cp(idx, r.pairId, s) || this.pending.has(`${idx}:${s}`)) continue;
          if ((this.failures.get(`${idx}:${s}`) ?? 0) >= MAX_FAILURES) continue;
          const p = await this.proofFor(r.pairId, s);
          if (!p) continue;
          this.send(idx, oracle, s, p, [], true);
        }
      }
      // 2. the new second: record, or record-and-settle what it decides.
      if (newSec !== undefined && !this.pending.has(`${idx}:${newSec}`)) {
        const needers = group.filter((r) => r.terms.entrySec <= newSec && newSec <= r.terms.endSec && !this.cp(idx, r.pairId, newSec));
        if (needers.length > 0) {
          const p = await this.proofFor(needers[0].pairId, newSec);
          if (p) {
            const extra = new Map(this.feedsOf(p.proof).map((f) => [`${f.pairId}:${f.sec}`, f.price18]));
            const ids = group.filter((r) => this.settleable(this.evaluate(r, true, extra))).map((r) => r.roundId).slice(0, MAX_ROUND_IDS_PER_SETTLE);
            this.send(idx, oracle, newSec, p, ids, false);
            for (const id of ids) inTx.add(id.toString());
          }
        }
      }
    }
    // 3. rounds decidable from recorded + in-flight checkpoints alone.
    const decided = this.openRounds().filter((r) => !inTx.has(r.roundId.toString()) && this.settleable(this.evaluate(r, true)));
    for (let i = 0; i < decided.length; i += MAX_ROUND_IDS_PER_SETTLE) this.settleMany(decided.slice(i, i + MAX_ROUND_IDS_PER_SETTLE));
  }

  private send(oracleIdx: number, oracle: Address, sec: number, p: { proof: Hex; proofHash: Hex }, ids: bigint[], backfill: boolean): void {
    const feeds = this.feedsOf(p.proof);
    const kind = ids.length > 0 ? 'record_settle' : 'record';
    const data =
      kind === 'record_settle'
        ? encodeFunctionData({ abi: arenaAbi, functionName: 'recordAndSettle', args: [oracleIdx, p.proof, ids] })
        : encodeFunctionData({ abi: checkpointOracleAbi, functionName: 'record', args: [p.proof] });
    const targets = ids.flatMap((id) => {
      const r = this.o.roundBook.get(id);
      return r ? [{ player: r.player, roundId: id }] : [];
    });
    const handle = this.o.sender.enqueue({
      key: 'recorder',
      kind,
      to: kind === 'record_settle' ? this.o.arena : oracle,
      data,
      roundId: ids[0],
      priority: backfill ? PRIORITY.backfill : PRIORITY.record,
      idempotent: true,
      transientRetryMs: 15_000,
      gasFloor: kind === 'record_settle' ? RECORD_GAS_ALLOWANCE + SETTLE_GAS_PER_ROUND * BigInt(ids.length) : undefined,
      playerSteps: targets.length > 0 ? { kind: 'settle', targets } : undefined,
    });
    const pend: Pending = { jobId: handle.id, oracleIdx, sec, ids, kind, proofHash: p.proofHash, feeds, roundMs: sec * 1000 };
    this.pending.set(`${oracleIdx}:${sec}`, pend);
    for (const f of feeds) {
      const k = this.key(oracleIdx, f.pairId, f.sec);
      if (!this.cps.has(k)) this.cps.set(k, { price18: f.price18, disputed: false, state: 'pending', jobId: handle.id });
    }
    for (const id of ids) this.settling.add(id.toString());
    if (backfill) this.metrics.backfillsSent++;
    else if (kind === 'record_settle') this.metrics.recordSettlesSent++;
    else this.metrics.recordsSent++;
    this.log.debug('checkpoint tx queued', { kind, sec, oracleIdx, ids: ids.map(String), backfill });
    void handle.done.then((res) => this.serial(async () => this.onRecordDone(pend, oracle, res)));
  }

  private settleMany(rounds: ChainRound[]): void {
    const ids = rounds.map((r) => r.roundId);
    const handle = this.o.sender.enqueue({
      key: 'recorder',
      kind: 'settle',
      to: this.o.arena,
      data: encodeFunctionData({ abi: arenaAbi, functionName: 'settleMany', args: [ids] }),
      roundId: ids[0],
      priority: PRIORITY.settle,
      idempotent: true,
      gasFloor: 150_000n + SETTLE_GAS_PER_ROUND * BigInt(ids.length),
      playerSteps: { kind: 'settle', targets: rounds.map((r) => ({ player: r.player, roundId: r.roundId })) },
    });
    for (const id of ids) this.settling.add(id.toString());
    this.metrics.settleManySent++;
    void handle.done.then((res) => this.serial(async () => this.onSettleDone(ids, res)));
  }

  // ── completions ───────────────────────────────────────────────────────────

  private onRecordDone(p: Pending, oracle: Address, res: TxResult): void {
    this.pending.delete(`${p.oracleIdx}:${p.sec}`);
    for (const id of p.ids) this.settling.delete(id.toString());
    if (res.status === 'confirmed' && res.receipt) {
      this.metrics.confirmed++;
      this.metrics.inclusionLagMs.push(Date.now() - p.roundMs);
      if (this.metrics.inclusionLagMs.length > 2000) this.metrics.inclusionLagMs.shift();
      this.failures.delete(`${p.oracleIdx}:${p.sec}`);
      this.applyReceipt(p.oracleIdx, oracle, res.receipt, p.feeds);
      void this.o.archive.markReferenced([p.proofHash], res.receipt.transactionHash).catch((err) => this.log.warn('markReferenced failed', { error: errorMessage(err) }));
      this.emitLocks(p.ids);
      return;
    }
    this.metrics.failed++;
    this.failures.set(`${p.oracleIdx}:${p.sec}`, (this.failures.get(`${p.oracleIdx}:${p.sec}`) ?? 0) + 1);
    for (const [k, c] of this.cps) if (c.state === 'pending' && c.jobId === p.jobId) this.cps.delete(k);
    this.log.warn('checkpoint tx failed', { sec: p.sec, kind: p.kind, error: res.error ?? null });
  }

  private onSettleDone(ids: bigint[], res: TxResult): void {
    for (const id of ids) this.settling.delete(id.toString());
    if (res.status !== 'confirmed') {
      this.metrics.failed++;
      this.log.warn('settleMany failed', { ids: ids.map(String), error: res.error ?? null });
    } else this.metrics.confirmed++;
    this.emitLocks(ids);
  }

  private applyReceipt(oracleIdx: number, oracle: Address, receipt: TransactionReceipt, feeds: Pending['feeds']): void {
    const logs = parseEventLogs({ abi: checkpointEventsAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === oracle.toLowerCase()) });
    const seen = new Set<string>();
    for (const l of logs) {
      const a = l.args as { pairId: number; sec: number; price18?: bigint; recorded?: bigint };
      this.setOnchain(oracleIdx, a.pairId, a.sec, (a.price18 ?? a.recorded) as bigint, l.eventName === 'CheckpointDisputed');
      seen.add(`${a.pairId}:${a.sec}`);
    }
    // Feeds with no event were already recorded with the same price (a conflict would emit CheckpointDisputed).
    for (const f of feeds) if (!seen.has(`${f.pairId}:${f.sec}`)) this.setOnchain(oracleIdx, f.pairId, f.sec, f.price18, false);
  }

  // ── reconcile ─────────────────────────────────────────────────────────────

  private async reconcile(): Promise<void> {
    if (!this.running) return;
    const rounds = this.o.roundBook.open();
    const now = this.o.chain.heads.nowSec();
    const ranges = new Map<string, { idx: number; pairId: number; from: number; to: number }>();
    for (const r of rounds) {
      const to = Math.min(r.terms.endSec, now);
      if (to < r.terms.entrySec) continue;
      const k = `${r.oracleIdx}:${r.pairId}`;
      const cur = ranges.get(k);
      ranges.set(k, { idx: r.oracleIdx, pairId: r.pairId, from: Math.min(cur?.from ?? r.terms.entrySec, r.terms.entrySec), to: Math.max(cur?.to ?? to, to) });
    }
    for (const g of ranges.values()) {
      const oracle = await this.oracleAddress(g.idx);
      if (!oracle) continue;
      for (let from = g.from; from <= g.to; from += MAX_RANGE_SECONDS) {
        const to = Math.min(g.to, from + MAX_RANGE_SECONDS - 1);
        try {
          const cps = await this.o.chain.read.readContract({ address: oracle, abi: checkpointOracleAbi, functionName: 'getRange', args: [g.pairId, from, to] });
          cps.forEach((c, i) => {
            if (c.flags & 1) this.setOnchain(g.idx, g.pairId, from + i, c.price18, (c.flags & 2) !== 0);
          });
        } catch (err) {
          this.log.debug('getRange failed', { pairId: g.pairId, from, to, error: errorMessage(err) });
        }
      }
    }
    this.gc(now);
    this.emitLocks([]);
    await this.plan();
  }

  private gc(now: number): void {
    const open = this.o.roundBook.open();
    const minEntry = open.reduce((m, r) => Math.min(m, r.terms.entrySec), now);
    for (const [k, c] of this.cps) {
      const sec = Number(k.split(':')[2]);
      if (c.state === 'onchain' && sec < minEntry - 600) this.cps.delete(k);
    }
    for (const k of this.failures.keys()) if (Number(k.split(':')[1]) < now - 3600) this.failures.delete(k);
  }

  // ── player events ─────────────────────────────────────────────────────────

  private once(key: string): boolean {
    if (this.emitted.has(key)) return false;
    this.emitted.add(key);
    if (this.emitted.size > 20_000) this.emitted.delete(this.emitted.values().next().value as string);
    return true;
  }

  private emitLocks(extraIds: bigint[]): void {
    const bus = this.o.bus;
    if (!bus) return;
    const rounds = new Map<string, ChainRound>();
    for (const r of this.o.roundBook.open()) rounds.set(r.roundId.toString(), r);
    for (const id of extraIds) {
      const r = this.o.roundBook.get(id);
      if (r) rounds.set(id.toString(), r);
    }
    for (const r of rounds.values()) {
      const id = r.roundId.toString();
      const entry = this.cp(r.oracleIdx, r.pairId, r.terms.entrySec);
      if (entry?.state === 'onchain' && !entry.disputed && this.once(`entry:${id}`)) {
        bus.emit('player.event', { player: r.player, event: 'round.entry_locked', payload: { roundId: id, entrySec: r.terms.entrySec, entryPrice: entry.price18.toString() } });
      }
      const ev = this.evaluate(r, false);
      if (!ev.decidable || ev.entryPrice === null) continue;
      if ((ev.outcome === Outcome.TargetHit || ev.outcome === Outcome.StopHit) && ev.exitPrice !== null && this.once(`touch:${id}`)) {
        const b = barrierPrices(r.terms.direction, ev.entryPrice, r.terms.targetPpm, r.terms.stopPpm);
        const target = ev.outcome === Outcome.TargetHit;
        bus.emit('player.event', {
          player: r.player,
          event: 'round.touch',
          payload: { roundId: id, kind: target ? 'target' : 'stop', sec: ev.decisionSec, price: ev.exitPrice.toString(), thresholdPrice: (target ? b.target : b.stop).toString() },
        });
      }
      if (r.terms.cashOutRequested && ev.outcome === Outcome.CashedOut && ev.decisionSec === r.terms.endSec && ev.exitPrice !== null && this.once(`exit:${id}`)) {
        bus.emit('player.event', { player: r.player, event: 'round.exit_locked', payload: { roundId: id, exitSec: r.terms.endSec, exitPrice: ev.exitPrice.toString() } });
      }
    }
  }
}
