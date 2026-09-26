// Chain indexer. Every INDEXER_POLL_MS it sweeps getLogs over [cursor+1, latest] for the Arena,
// the CheckpointOracles and the faucet, upserts chain_events on (tx_hash, log_index), projects
// rounds (RoundBook), emits `chain.event` and the player events, and marks events finalized with
// the `finalized` tag. Sender receipts are ingested immediately (before the sweep); the sweep of
// a range is authoritative, so receipt-fed events that are not returned are undone.
// Reorgs: the cursor block hash is re-checked each tick; on mismatch the stored block hashes locate
// the fork point and every unfinalized event above it is undone newest-first.

import { decodeEventLog, zeroAddress, type Address, type Hex, type Log, type PublicClient, type TransactionReceipt } from 'viem';
import { STALL_AFTER_SEC } from '@bnbplay/shared/constants';
import { Outcome, voidReasonLabel, type VoidReason } from '@bnbplay/shared/enums';
import type { Bus } from '../bus.ts';
import type { ProgressionService } from '../ports.ts';
import { arenaAbi, indexedEventsAbi } from '../recorder/abi.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import type { ReceiptEvent } from '../relayer/sender.ts';
import { ChainRoundBook, type OpenedArgs, type SettledArgs } from './roundBook.ts';
import { MemoryIndexerStore, type IndexerStore } from './store.ts';
import { eventKey, roundToDTO, type BlockRef, type ChainRound, type Cursor, type StoredEvent } from './types.ts';

export interface ReceiptSource {
  onReceipt(cb: (e: ReceiptEvent) => void): () => void;
}

export interface CheckpointInfo {
  oracle: Address;
  pairId: number;
  sec: number;
  price18: bigint;
  tsMs: number | null;
  disputed: boolean;
  blockNumber: bigint;
}

export interface IndexerOptions {
  chain: ChainIo;
  arena: Address;
  /** Known CheckpointOracle addresses; more are discovered via arena.oracles(i) and OracleAdded. */
  oracles?: Address[];
  faucet?: Address;
  /** First block to index when there is no cursor (ARENA_DEPLOY_BLOCK). Defaults to the head. */
  startBlock?: bigint;
  pollMs: number;
  bus?: Bus;
  store?: IndexerStore;
  log?: Logger;
  receipts?: ReceiptSource;
  progression?: ProgressionService;
  chunkBlocks?: number;
  /** Player events are only emitted for logs at most this many blocks below the head. */
  liveWindowBlocks?: number;
  /** Used when the RPC does not support the `finalized` tag. */
  finalizedFallbackDepth?: number;
  /** Settled rounds loaded into memory on boot. */
  bootSettledWindowMs?: number;
}

type Change = { opened: ChainRound[]; changed: Map<string, ChainRound>; removed: bigint[] };

const lc = (a: string) => a.toLowerCase() as Address;

export class ChainIndexer {
  readonly roundBook = new ChainRoundBook();
  private readonly o: IndexerOptions;
  private readonly store: IndexerStore;
  private readonly log: Logger;
  private readonly addresses = new Set<Address>();
  private readonly oracleByIdx = new Map<number, Address>();
  private readonly events = new Map<string, StoredEvent>();
  private readonly blocks = new Map<bigint, BlockRef>();
  private readonly checkpoints = new Map<string, CheckpointInfo>();
  private readonly logListeners = new Set<(events: StoredEvent[]) => void>();
  private readonly pendingProgression = new Set<string>();
  private readonly emitted = new Set<string>();
  private readonly blockTimes = new Map<bigint, number>();
  private cursor: Cursor | undefined;
  private finalized: bigint | null = null;
  private head: bigint | null = null;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private ticking: Promise<void> | undefined;
  private unsubReceipts: (() => void) | undefined;
  private chain = Promise.resolve();
  lastTickMs = 0;
  lastError: string | null = null;

  constructor(opts: IndexerOptions) {
    this.o = opts;
    this.store = opts.store ?? new MemoryIndexerStore();
    this.log = opts.log ?? silentLogger;
    this.addresses.add(lc(opts.arena));
    for (const a of opts.oracles ?? []) this.addresses.add(lc(a));
    if (opts.faucet) this.addresses.add(lc(opts.faucet));
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const c = await this.store.loadCursor();
    if (c) {
      this.cursor = { number: c.number, hash: c.hash };
      this.finalized = c.finalized;
    }
    for (const b of await this.store.loadBlocks()) this.blocks.set(b.number, b);
    for (const e of await this.store.loadUnfinalizedEvents()) this.events.set(eventKey(e), e);
    this.roundBook.load(await this.store.loadRounds(Date.now() - (this.o.bootSettledWindowMs ?? 24 * 3600_000)));
    for (const r of this.roundBook.all()) {
      this.markEmitted(r);
      if (r.status === 'settled' && !r.settleFinalized) this.pendingProgression.add(r.roundId.toString());
    }
    await this.discoverOracles();
    this.unsubReceipts = this.o.receipts?.onReceipt((e) => void this.ingestReceipt(e.receipt));
    await this.tick();
    this.schedule();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.unsubReceipts?.();
    await this.ticking;
    await this.chain;
  }

  private schedule(delay = this.o.pollMs): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      const behind = await this.tick();
      this.schedule(behind ? 0 : this.o.pollMs);
    }, delay);
  }

  // ── public helpers ────────────────────────────────────────────────────────

  onLogs(cb: (events: StoredEvent[]) => void): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  oracleAddress(idx: number): Address | undefined {
    return this.oracleByIdx.get(idx);
  }

  oracleIndexOf(address: Address): number | undefined {
    for (const [i, a] of this.oracleByIdx) if (a === lc(address)) return i;
    return undefined;
  }

  checkpoint(oracle: Address, pairId: number, sec: number): CheckpointInfo | undefined {
    return this.checkpoints.get(`${lc(oracle)}:${pairId}:${sec}`);
  }

  status(): { cursor: string | null; head: string | null; finalized: string | null; lagBlocks: number | null; lastTickMs: number; lastError: string | null } {
    return {
      cursor: this.cursor?.number.toString() ?? null,
      head: this.head?.toString() ?? null,
      finalized: this.finalized?.toString() ?? null,
      lagBlocks: this.cursor && this.head !== null ? Number(this.head - this.cursor.number) : null,
      lastTickMs: this.lastTickMs,
      lastError: this.lastError,
    };
  }

  /** Ingests a receipt's logs now (serialized with the sweep). */
  ingestReceipt(receipt: TransactionReceipt): Promise<void> {
    return this.serial(async () => {
      const logs = receipt.logs.filter((l) => this.addresses.has(lc(l.address)));
      if (logs.length > 0) await this.ingest(logs as Log[], 'receipt');
    });
  }

  /** Runs one sweep now; returns true while catching up. */
  tick(): Promise<boolean> {
    let behind = false;
    const p = this.serial(async () => {
      try {
        behind = await this.sweep();
        await this.updateFinality();
        this.lastError = null;
      } catch (err) {
        this.lastError = errorMessage(err);
        this.log.warn('indexer tick failed', { error: this.lastError });
      }
      this.lastTickMs = Date.now();
    });
    this.ticking = p;
    return p.then(() => behind);
  }

  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  // ── sweep ─────────────────────────────────────────────────────────────────

  private client(from: bigint): PublicClient {
    return this.head !== null && this.head - from > 5000n ? this.o.chain.archive : this.o.chain.read;
  }

  private async discoverOracles(): Promise<void> {
    for (let i = 0; i < 16; i++) {
      if (this.oracleByIdx.has(i)) continue;
      try {
        const a = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'oracles', args: [BigInt(i)] });
        if (a === zeroAddress) break;
        this.oracleByIdx.set(i, lc(a));
        this.addresses.add(lc(a));
      } catch {
        break;
      }
    }
  }

  private async sweep(): Promise<boolean> {
    const head = await this.o.chain.read.getBlockNumber();
    this.head = head;
    await this.checkReorg();
    const from = this.cursor ? this.cursor.number + 1n : (this.o.startBlock ?? head);
    if (from > head) return false;
    const chunk = BigInt(this.o.chunkBlocks ?? 2000);
    let to = from + chunk - 1n > head ? head : from + chunk - 1n;
    let logs: Log[];
    for (;;) {
      try {
        logs = await this.client(from).getLogs({ address: [...this.addresses], fromBlock: from, toBlock: to });
        break;
      } catch (err) {
        if (to === from) throw err;
        to = from + (to - from) / 2n;
      }
    }
    const toBlock = await this.client(from).getBlock({ blockNumber: to });
    const hashes = new Map<bigint, Hex>();
    for (const l of logs) {
      const prev = hashes.get(l.blockNumber as bigint);
      if (prev && prev !== l.blockHash) throw new Error(`inconsistent block hash at ${l.blockNumber} (reorg in progress)`);
      hashes.set(l.blockNumber as bigint, l.blockHash as Hex);
    }
    if (hashes.has(to) && hashes.get(to) !== toBlock.hash) throw new Error(`block ${to} changed during the sweep`);
    await this.ingest(logs, 'logs', { from, to });
    this.cursor = { number: to, hash: toBlock.hash as Hex };
    const ref: BlockRef = { number: to, hash: toBlock.hash as Hex, parentHash: toBlock.parentHash, timestampSec: Number(toBlock.timestamp) };
    this.blocks.set(to, ref);
    this.blockTimes.set(to, Number(toBlock.timestamp) * 1000);
    await this.store.saveBlocks([ref]);
    await this.store.saveCursor(this.cursor, this.finalized);
    return to < head;
  }

  private async checkReorg(): Promise<void> {
    if (!this.cursor) return;
    const b = await this.o.chain.read.getBlock({ blockNumber: this.cursor.number }).catch(() => undefined);
    if (!b || b.hash === this.cursor.hash) return;
    const floor = this.finalized ?? this.cursor.number - 64n;
    let fork = floor;
    const stored = [...this.blocks.values()].filter((x) => x.number <= this.cursor!.number && x.number > floor).sort((a, c) => Number(c.number - a.number));
    for (const s of stored) {
      const cb = await this.o.chain.read.getBlock({ blockNumber: s.number }).catch(() => undefined);
      if (cb && cb.hash === s.hash) {
        fork = s.number;
        break;
      }
    }
    this.log.warn('reorg detected', { cursor: this.cursor.number, fork });
    const removed = [...this.events.values()].filter((e) => !e.finalized && e.blockNumber > fork);
    await this.undo(removed);
    for (const n of [...this.blocks.keys()]) if (n > fork) this.blocks.delete(n);
    const forkBlock = await this.o.chain.read.getBlock({ blockNumber: fork });
    this.cursor = { number: fork, hash: forkBlock.hash as Hex };
    await this.store.saveCursor(this.cursor, this.finalized);
  }

  // ── ingestion ─────────────────────────────────────────────────────────────

  private decode(l: Log, source: 'logs' | 'receipt'): StoredEvent {
    let name = 'unknown';
    let args: Record<string, unknown> = { topics: l.topics, data: l.data };
    try {
      const d = decodeEventLog({ abi: indexedEventsAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      name = d.eventName;
      args = (d.args ?? {}) as Record<string, unknown>;
    } catch {
      // unknown event (kept raw)
    }
    return {
      txHash: l.transactionHash as Hex,
      logIndex: l.logIndex as number,
      blockNumber: l.blockNumber as bigint,
      blockHash: l.blockHash as Hex,
      address: lc(l.address),
      name,
      args,
      finalized: this.finalized !== null && (l.blockNumber as bigint) <= this.finalized,
      source,
    };
  }

  private async ingest(logs: Log[], source: 'logs' | 'receipt', range?: { from: bigint; to: bigint }): Promise<void> {
    const decoded = logs.filter((l) => !l.removed).map((l) => this.decode(l, source)).sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
    const change: Change = { opened: [], changed: new Map(), removed: [] };
    if (range) {
      const seen = new Set(decoded.map((e) => `${eventKey(e)}@${e.blockHash}`));
      const stale = [...this.events.values()].filter((e) => !e.finalized && e.blockNumber >= range.from && e.blockNumber <= range.to && !seen.has(`${eventKey(e)}@${e.blockHash}`));
      if (stale.length > 0) {
        this.log.warn('events no longer canonical', { count: stale.length });
        await this.undo(stale);
      }
    }
    const fresh: StoredEvent[] = [];
    for (const e of decoded) {
      const prev = this.events.get(eventKey(e));
      if (prev && prev.blockHash === e.blockHash) continue;
      if (prev) await this.undo([prev]);
      if (!e.finalized) this.events.set(eventKey(e), e);
      if (!this.blocks.has(e.blockNumber)) this.blocks.set(e.blockNumber, { number: e.blockNumber, hash: e.blockHash, parentHash: '0x' as Hex, timestampSec: 0 });
      fresh.push(e);
    }
    if (fresh.length === 0) return;
    for (const e of fresh) await this.apply(e, change);
    await this.persist(fresh, change);
    for (const cb of this.logListeners) {
      try {
        cb(fresh);
      } catch (err) {
        this.log.error('log listener failed', { error: errorMessage(err) });
      }
    }
  }

  private isLive(e: StoredEvent): boolean {
    if (e.source === 'receipt') return true;
    const window = BigInt(this.o.liveWindowBlocks ?? 1500);
    return this.head === null || this.head - e.blockNumber <= window;
  }

  private async blockTimeMs(n: bigint): Promise<number> {
    const hit = this.blockTimes.get(n);
    if (hit !== undefined) return hit;
    const h = this.o.chain.heads.latest();
    if (h && h.number === n) return h.timestamp * 1000;
    try {
      const b = await this.o.chain.read.getBlock({ blockNumber: n });
      const ms = Number(b.timestamp) * 1000;
      this.blockTimes.set(n, ms);
      if (this.blockTimes.size > 2000) this.blockTimes.delete(this.blockTimes.keys().next().value as bigint);
      return ms;
    } catch {
      return Date.now();
    }
  }

  private async apply(e: StoredEvent, change: Change): Promise<void> {
    const bus = this.o.bus;
    const now = Date.now();
    const live = this.isLive(e);
    bus?.emit('chain.event', { name: e.name, args: e.args, txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, finalized: e.finalized });
    const a = e.args as Record<string, unknown>;
    switch (e.name) {
      case 'RoundOpened': {
        const r = this.roundBook.applyOpened(a as unknown as OpenedArgs, e, now);
        if (!r) return;
        change.opened.push(r);
        const oracle = this.oracleByIdx.get(r.oracleIdx);
        const cp = oracle ? this.checkpoint(oracle, r.pairId, r.terms.entrySec) : undefined;
        if (cp && !cp.disputed) this.roundBook.setEntryPrice(r.roundId, cp.price18, now);
        change.changed.set(r.roundId.toString(), r);
        if (live && this.once(`opened:${r.roundId}`)) {
          bus?.emit('player.event', { player: r.player, event: 'round.opened', payload: roundToDTO(r) });
          void this.emitBalance(r.player);
        }
        return;
      }
      case 'CashOutRequested': {
        const r = this.roundBook.applyCashOut(a.roundId as bigint, a.exitSec as number, e.txHash, now);
        if (!r) return;
        change.changed.set(r.roundId.toString(), r);
        if (live && this.once(`cashout:${r.roundId}`)) {
          bus?.emit('player.event', { player: r.player, event: 'round.cashout_requested', payload: { roundId: r.roundId.toString(), exitSec: a.exitSec as number, txHash: e.txHash } });
        }
        return;
      }
      case 'RoundSettled': {
        const r = this.roundBook.applySettled(a as unknown as SettledArgs, e, await this.blockTimeMs(e.blockNumber), now);
        if (!r) return;
        change.changed.set(r.roundId.toString(), r);
        if (e.finalized) this.pendingProgression.add(r.roundId.toString());
        if (live && this.once(`settled:${r.roundId}`)) {
          bus?.emit('player.event', { player: r.player, event: 'round.settled', payload: roundToDTO(r) });
          if (r.outcome === Outcome.Voided) {
            const reason = voidReasonLabel((r.voidReason ?? 0) as VoidReason) ?? 'stalled';
            bus?.emit('player.event', { player: r.player, event: 'round.voided', payload: { roundId: r.roundId.toString(), reason, payout: (r.payout ?? 0n).toString() } });
          }
          void this.emitBalance(r.player);
        }
        return;
      }
      case 'Deposited':
      case 'Withdrawn':
        if (live) void this.emitBalance(a.player as Address);
        return;
      case 'CheckpointRecorded':
      case 'CheckpointDisputed': {
        const pairId = a.pairId as number;
        const sec = a.sec as number;
        const key = `${e.address}:${pairId}:${sec}`;
        const prev = this.checkpoints.get(key);
        if (e.name === 'CheckpointRecorded') {
          this.checkpoints.set(key, { oracle: e.address, pairId, sec, price18: a.price18 as bigint, tsMs: Number(a.tsMs), disputed: prev?.disputed ?? false, blockNumber: e.blockNumber });
        } else {
          this.checkpoints.set(key, { oracle: e.address, pairId, sec, price18: a.recorded as bigint, tsMs: prev?.tsMs ?? null, disputed: true, blockNumber: e.blockNumber });
        }
        this.trimCheckpoints();
        const idx = this.oracleIndexOf(e.address);
        if (idx !== undefined && e.name === 'CheckpointRecorded') {
          for (const r of this.roundBook.awaitingEntry(idx, pairId, sec)) {
            this.roundBook.setEntryPrice(r.roundId, a.price18 as bigint, now);
            change.changed.set(r.roundId.toString(), r);
          }
        }
        return;
      }
      case 'OracleAdded': {
        const addr = lc(a.oracle as Address);
        this.oracleByIdx.set(a.idx as number, addr);
        this.addresses.add(addr);
        return;
      }
      default:
        return;
    }
  }

  private once(key: string): boolean {
    if (this.emitted.has(key)) return false;
    this.emitted.add(key);
    if (this.emitted.size > 50_000) this.emitted.delete(this.emitted.values().next().value as string);
    return true;
  }

  private markEmitted(r: ChainRound): void {
    this.emitted.add(`opened:${r.roundId}`);
    if (r.terms.cashOutRequested) this.emitted.add(`cashout:${r.roundId}`);
    if (r.status === 'settled') this.emitted.add(`settled:${r.roundId}`);
  }

  private trimCheckpoints(): void {
    if (this.checkpoints.size <= 60_000) return;
    const cut = Math.floor(Date.now() / 1000) - 2 * 3600;
    for (const [k, c] of this.checkpoints) if (c.sec < cut) this.checkpoints.delete(k);
  }

  private async emitBalance(player: Address): Promise<void> {
    const bus = this.o.bus;
    if (!bus) return;
    try {
      const available = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'balanceOf', args: [player] });
      const active = this.roundBook.activeFor(player);
      bus.emit('player.event', { player, event: 'balance', payload: { available: available.toString(), locked: (active?.terms.stake ?? 0n).toString() } });
    } catch (err) {
      this.log.debug('balance read failed', { player, error: errorMessage(err) });
    }
  }

  /** Undoes events newest-first (reorg or a receipt event the sweep did not confirm). */
  private async undo(events: StoredEvent[]): Promise<void> {
    if (events.length === 0) return;
    const now = Date.now();
    const sorted = [...events].sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);
    const changed: ChainRound[] = [];
    const removedRounds: bigint[] = [];
    for (const e of sorted) {
      this.events.delete(eventKey(e));
      const a = e.args as Record<string, unknown>;
      const id = a.roundId as bigint | undefined;
      switch (e.name) {
        case 'RoundOpened':
          if (id !== undefined && this.roundBook.undoOpened(id)) {
            removedRounds.push(id);
            this.emitted.delete(`opened:${id}`);
          }
          break;
        case 'CashOutRequested': {
          const r = id !== undefined ? this.roundBook.undoCashOut(id, now) : undefined;
          if (r) (changed.push(r), this.emitted.delete(`cashout:${id}`));
          break;
        }
        case 'RoundSettled': {
          const r = id !== undefined ? this.roundBook.undoSettled(id, now) : undefined;
          if (r) (changed.push(r), this.emitted.delete(`settled:${id}`));
          break;
        }
        case 'CheckpointRecorded':
        case 'CheckpointDisputed':
          this.checkpoints.delete(`${e.address}:${a.pairId as number}:${a.sec as number}`);
          break;
      }
    }
    try {
      await this.store.deleteEvents(sorted);
      await this.store.deleteRounds(removedRounds);
      await this.store.upsertRounds(changed.filter((r) => !removedRounds.includes(r.roundId)));
    } catch (err) {
      this.log.warn('persisting reorg undo failed', { error: errorMessage(err) });
    }
  }

  private async persist(events: StoredEvent[], change: Change): Promise<void> {
    try {
      await this.store.upsertEvents(events);
      if (change.changed.size > 0) await this.store.upsertRounds([...change.changed.values()]);
      const blocks = [...new Set(events.map((e) => e.blockNumber))].map((n) => this.blocks.get(n)).filter((b): b is BlockRef => Boolean(b && b.timestampSec > 0));
      if (blocks.length > 0) await this.store.saveBlocks(blocks);
    } catch (err) {
      this.log.warn('indexer persist failed', { error: errorMessage(err) });
    }
  }

  // ── finality ──────────────────────────────────────────────────────────────

  private async updateFinality(): Promise<void> {
    let fin: bigint | null = null;
    try {
      const b = await this.o.chain.read.getBlock({ blockTag: 'finalized' });
      fin = b.number;
    } catch {
      if (this.head !== null) fin = this.head - BigInt(this.o.finalizedFallbackDepth ?? 15);
    }
    if (fin !== null && this.cursor && fin > this.cursor.number) fin = this.cursor.number;
    if (fin !== null && (this.finalized === null || fin > this.finalized)) {
      this.finalized = fin;
      const done = [...this.events.values()].filter((e) => e.blockNumber <= fin).sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
      const now = Date.now();
      const changed: ChainRound[] = [];
      for (const e of done) {
        e.finalized = true;
        this.events.delete(eventKey(e));
        if (!e.name.startsWith('Checkpoint')) {
          this.o.bus?.emit('chain.event', { name: e.name, args: e.args, txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, finalized: true });
        }
        if (e.name === 'RoundSettled') this.pendingProgression.add(String(e.args.roundId));
      }
      for (const id of this.pendingProgression) {
        const r = this.roundBook.markFinalized(BigInt(id), now);
        if (r) changed.push(r);
      }
      try {
        await this.store.markFinalized(fin);
        if (changed.length > 0) await this.store.upsertRounds(changed);
        await this.store.pruneBlocks(fin - 64n);
        if (this.cursor) await this.store.saveCursor(this.cursor, this.finalized);
      } catch (err) {
        this.log.warn('finality persist failed', { error: errorMessage(err) });
      }
      for (const n of [...this.blocks.keys()]) if (n < fin - 64n) this.blocks.delete(n);
    }
    // Progression only for settlements at or below finality; retried until it succeeds.
    for (const id of [...this.pendingProgression]) {
      const r = this.roundBook.get(BigInt(id));
      if (!r || r.status !== 'settled' || r.settleBlock === null || this.finalized === null || r.settleBlock > this.finalized) continue;
      if (!r.settleFinalized) {
        this.roundBook.markFinalized(r.roundId, Date.now());
        await this.store.upsertRounds([r]).catch(() => undefined);
      }
      if (!this.o.progression) {
        this.pendingProgression.delete(id);
        continue;
      }
      try {
        await this.o.progression.onRoundFinalized(r.roundId);
        this.pendingProgression.delete(id);
      } catch (err) {
        this.log.warn('progression.onRoundFinalized failed; will retry', { roundId: id, error: errorMessage(err) });
      }
    }
  }
}

/** Seconds after endSec at which an open round becomes voidable as Stalled (F1a §7). */
export const stallDeadline = (r: ChainRound): number => r.terms.endSec + STALL_AFTER_SEC;
