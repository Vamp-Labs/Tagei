// Indexer persistence: chain_events, chain_blocks, indexer_state and the rounds projection.
// The memory variant backs dev runs without Postgres and the unit tests.

import { and, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Address, Hex } from 'viem';
import { chainBlocks, chainEvents, indexerState } from '../db/schema/chain.ts';
import { rounds } from '../db/schema/rounds.ts';
import type { Direction, Outcome, VoidReason } from '@bnbplay/shared/enums';
import { toJsonSafe } from '../relayer/log.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';
import type { BlockRef, ChainRound, Cursor, StoredEvent } from './types.ts';
import { eventKey } from './types.ts';

export interface IndexerStore {
  loadCursor(): Promise<(Cursor & { finalized: bigint | null }) | undefined>;
  saveCursor(c: Cursor, finalized: bigint | null): Promise<void>;
  loadUnfinalizedEvents(): Promise<StoredEvent[]>;
  upsertEvents(events: StoredEvent[]): Promise<void>;
  deleteEvents(keys: { txHash: Hex; logIndex: number }[]): Promise<void>;
  markFinalized(upTo: bigint): Promise<void>;
  saveBlocks(blocks: BlockRef[]): Promise<void>;
  loadBlocks(): Promise<BlockRef[]>;
  pruneBlocks(below: bigint): Promise<void>;
  upsertRounds(rs: ChainRound[]): Promise<void>;
  deleteRounds(ids: bigint[]): Promise<void>;
  /** Open rounds plus rounds settled at or after `settledSinceMs`. */
  loadRounds(settledSinceMs: number): Promise<ChainRound[]>;
}

export class MemoryIndexerStore implements IndexerStore {
  cursor: (Cursor & { finalized: bigint | null }) | undefined;
  readonly events = new Map<string, StoredEvent>();
  readonly blocks = new Map<bigint, BlockRef>();
  readonly rounds = new Map<string, ChainRound>();

  async loadCursor() {
    return this.cursor;
  }
  async saveCursor(c: Cursor, finalized: bigint | null) {
    this.cursor = { ...c, finalized };
  }
  async loadUnfinalizedEvents() {
    return [...this.events.values()].filter((e) => !e.finalized);
  }
  async upsertEvents(events: StoredEvent[]) {
    for (const e of events) this.events.set(eventKey(e), { ...e });
  }
  async deleteEvents(keys: { txHash: Hex; logIndex: number }[]) {
    for (const k of keys) this.events.delete(eventKey(k));
  }
  async markFinalized(upTo: bigint) {
    for (const e of this.events.values()) if (e.blockNumber <= upTo) e.finalized = true;
  }
  async saveBlocks(blocks: BlockRef[]) {
    for (const b of blocks) this.blocks.set(b.number, b);
  }
  async loadBlocks() {
    return [...this.blocks.values()];
  }
  async pruneBlocks(below: bigint) {
    for (const n of this.blocks.keys()) if (n < below) this.blocks.delete(n);
  }
  async upsertRounds(rs: ChainRound[]) {
    for (const r of rs) this.rounds.set(r.roundId.toString(), structuredClone(r));
  }
  async deleteRounds(ids: bigint[]) {
    for (const id of ids) this.rounds.delete(id.toString());
  }
  async loadRounds(settledSinceMs: number) {
    return [...this.rounds.values()].filter((r) => r.status === 'open' || (r.settledAtMs ?? 0) >= settledSinceMs).map((r) => structuredClone(r));
  }
}

const bi = (v: bigint | null): bigint | null => v;
const num = (v: number | null): number | null => v;

type RoundRow = typeof rounds.$inferSelect;

function toRow(r: ChainRound): typeof rounds.$inferInsert {
  return {
    roundId: r.roundId,
    player: r.player.toLowerCase(),
    assetId: r.assetId,
    pairId: r.pairId,
    tier: r.tier,
    direction: r.terms.direction,
    stake: r.terms.stake,
    maxPayout: r.terms.maxPayout,
    entrySec: r.terms.entrySec,
    endSec: r.openedEndSec,
    exitSec: num(r.exitSec),
    laneVersion: r.laneVersion,
    oracleIdx: r.oracleIdx,
    targetPpm: r.terms.targetPpm,
    stopPpm: r.terms.stopPpm,
    multiplierBps: r.terms.multiplierBps,
    feeBps: r.terms.feeBps,
    maxJumpPpm: r.terms.maxJumpPpm,
    cashOutRequested: r.terms.cashOutRequested,
    status: r.status,
    outcome: num(r.outcome),
    voidReason: num(r.voidReason),
    payout: bi(r.payout),
    pnl: bi(r.pnl),
    entryPrice: bi(r.entryPrice),
    exitPrice: bi(r.exitPrice),
    decisionSec: num(r.decisionSec),
    openTx: r.openTx,
    openBlock: Number(r.openBlock),
    openLogIndex: r.openLogIndex,
    cashOutTx: r.cashOutTx,
    settleTx: r.settleTx,
    settleBlock: r.settleBlock === null ? null : Number(r.settleBlock),
    openedAtMs: r.openedAtMs,
    settledAtMs: r.settledAtMs,
    settleFinalized: r.settleFinalized,
    updatedAtMs: r.updatedAtMs,
  };
}

export function roundFromRow(row: RoundRow): ChainRound {
  const endSec = row.exitSec ?? row.endSec;
  return {
    roundId: row.roundId,
    player: row.player as Address,
    assetId: row.assetId,
    pairId: row.pairId,
    terms: {
      direction: row.direction as Direction,
      stake: row.stake,
      maxPayout: row.maxPayout,
      entrySec: row.entrySec,
      endSec,
      targetPpm: row.targetPpm,
      stopPpm: row.stopPpm,
      multiplierBps: row.multiplierBps,
      feeBps: row.feeBps,
      maxJumpPpm: row.maxJumpPpm,
      cashOutRequested: row.cashOutRequested,
    },
    openTx: row.openTx as Hex,
    status: row.status === 'settled' ? 'settled' : 'open',
    tier: row.tier,
    laneVersion: row.laneVersion,
    oracleIdx: row.oracleIdx,
    openedEndSec: row.endSec,
    exitSec: row.exitSec,
    entryPrice: row.entryPrice,
    outcome: row.outcome as Outcome | null,
    voidReason: row.voidReason as VoidReason | null,
    payout: row.payout,
    pnl: row.pnl,
    exitPrice: row.exitPrice,
    decisionSec: row.decisionSec,
    openBlock: BigInt(row.openBlock),
    openLogIndex: row.openLogIndex,
    openedAtMs: row.openedAtMs,
    cashOutTx: row.cashOutTx as Hex | null,
    settleTx: row.settleTx as Hex | null,
    settleBlock: row.settleBlock === null ? null : BigInt(row.settleBlock),
    settledAtMs: row.settledAtMs,
    settleFinalized: row.settleFinalized,
    updatedAtMs: row.updatedAtMs,
  };
}

/** Rebuilds bigint fields that were stringified in chain_events.args. */
function reviveArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const big = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : v);
  const out: Record<string, unknown> = { ...args };
  for (const k of ['roundId', 'stake', 'maxPayout', 'payout', 'pnl', 'entryPrice', 'exitPrice', 'amount', 'price18', 'recorded', 'conflicting', 'tsMs']) {
    if (k in out) out[k] = big(out[k]);
  }
  if (name === 'RoundOpened' && out.terms && typeof out.terms === 'object') {
    const t = { ...(out.terms as Record<string, unknown>) };
    t.stake = big(t.stake);
    t.maxPayout = big(t.maxPayout);
    out.terms = t;
  }
  return out;
}

export class PgIndexerStore implements IndexerStore {
  constructor(
    private readonly db: AnyPgDb,
    private readonly id = 'arena',
  ) {}

  async loadCursor() {
    const rows = await this.db.select().from(indexerState).where(eq(indexerState.id, this.id)).limit(1);
    const r = rows[0];
    return r ? { number: BigInt(r.blockNumber), hash: r.blockHash as Hex, finalized: r.finalizedBlock === null ? null : BigInt(r.finalizedBlock) } : undefined;
  }

  async saveCursor(c: Cursor, finalized: bigint | null) {
    const row = { id: this.id, blockNumber: Number(c.number), blockHash: c.hash, finalizedBlock: finalized === null ? null : Number(finalized), updatedAtMs: Date.now() };
    await this.db.insert(indexerState).values(row).onConflictDoUpdate({ target: indexerState.id, set: row });
  }

  async loadUnfinalizedEvents() {
    const rows = await this.db.select().from(chainEvents).where(eq(chainEvents.finalized, false)).orderBy(chainEvents.blockNumber, chainEvents.logIndex);
    return rows.map((r) => ({
      txHash: r.txHash as Hex,
      logIndex: r.logIndex,
      blockNumber: BigInt(r.blockNumber),
      blockHash: r.blockHash as Hex,
      address: r.address as Address,
      name: r.name,
      args: reviveArgs(r.name, r.args as Record<string, unknown>),
      finalized: r.finalized,
      source: r.source === 'receipt' ? ('receipt' as const) : ('logs' as const),
    }));
  }

  async upsertEvents(events: StoredEvent[]) {
    const now = Date.now();
    for (let i = 0; i < events.length; i += 500) {
      const chunk = events.slice(i, i + 500).map((e) => ({
        txHash: e.txHash.toLowerCase(),
        logIndex: e.logIndex,
        blockNumber: Number(e.blockNumber),
        blockHash: e.blockHash.toLowerCase(),
        address: e.address.toLowerCase(),
        name: e.name,
        args: toJsonSafe(e.args) as Record<string, unknown>,
        finalized: e.finalized,
        source: e.source,
        createdAtMs: now,
      }));
      await this.db
        .insert(chainEvents)
        .values(chunk)
        .onConflictDoUpdate({
          target: [chainEvents.txHash, chainEvents.logIndex],
          set: { blockNumber: sql`excluded.block_number`, blockHash: sql`excluded.block_hash`, args: sql`excluded.args`, name: sql`excluded.name`, address: sql`excluded.address` },
        });
    }
  }

  async deleteEvents(keys: { txHash: Hex; logIndex: number }[]) {
    if (keys.length === 0) return;
    await this.db
      .delete(chainEvents)
      .where(or(...keys.map((k) => and(eq(chainEvents.txHash, k.txHash.toLowerCase()), eq(chainEvents.logIndex, k.logIndex)))));
  }

  async markFinalized(upTo: bigint) {
    await this.db
      .update(chainEvents)
      .set({ finalized: true })
      .where(and(eq(chainEvents.finalized, false), lte(chainEvents.blockNumber, Number(upTo))));
  }

  async saveBlocks(blocks: BlockRef[]) {
    if (blocks.length === 0) return;
    await this.db
      .insert(chainBlocks)
      .values(blocks.map((b) => ({ number: Number(b.number), hash: b.hash, parentHash: b.parentHash, timestampSec: b.timestampSec })))
      .onConflictDoUpdate({ target: chainBlocks.number, set: { hash: sql`excluded.hash`, parentHash: sql`excluded.parent_hash`, timestampSec: sql`excluded.timestamp_sec` } });
  }

  async loadBlocks() {
    const rows = await this.db.select().from(chainBlocks);
    return rows.map((r) => ({ number: BigInt(r.number), hash: r.hash as Hex, parentHash: r.parentHash as Hex, timestampSec: r.timestampSec }));
  }

  async pruneBlocks(below: bigint) {
    await this.db.delete(chainBlocks).where(lt(chainBlocks.number, Number(below)));
  }

  async upsertRounds(rs: ChainRound[]) {
    for (const r of rs) {
      const row = toRow(r);
      const { roundId: _id, ...set } = row;
      void _id;
      await this.db.insert(rounds).values(row).onConflictDoUpdate({ target: rounds.roundId, set });
    }
  }

  async deleteRounds(ids: bigint[]) {
    if (ids.length === 0) return;
    await this.db.delete(rounds).where(inArray(rounds.roundId, ids));
  }

  async loadRounds(settledSinceMs: number) {
    const rows = await this.db
      .select()
      .from(rounds)
      .where(or(eq(rounds.status, 'open'), gte(rounds.settledAtMs, settledSinceMs)));
    return rows.map(roundFromRow);
  }
}
