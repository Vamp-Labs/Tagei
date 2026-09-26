// In-memory RoundBook (port) projected from Arena events. The indexer is the only writer;
// every mutation has an inverse so a reorg can undo removed events newest-first.

import type { Address, Hex } from 'viem';
import { ENTRY_DELAY_SEC } from '@bnbplay/shared/constants';
import { Outcome, type Direction, type VoidReason } from '@bnbplay/shared/enums';
import type { RoundDTO } from '@bnbplay/shared/dto';
import type { RoundBook } from '../ports.ts';
import { roundToDTO, type ChainRound } from './types.ts';

export type RoundChange = 'opened' | 'cashout' | 'settled' | 'entry' | 'finalized' | 'reverted';

export interface OpenedArgs {
  roundId: bigint;
  player: Address;
  assetId: number;
  terms: {
    tier: number;
    direction: number;
    stake: bigint;
    maxPayout: bigint;
    entrySec: number;
    endSec: number;
    laneVersion: number;
    oracleIdx: number;
    pairId: number;
    targetPpm: number;
    stopPpm: number;
    multiplierBps: number;
    feeBps: number;
    maxJumpPpm: number;
  };
}

export interface SettledArgs {
  roundId: bigint;
  outcome: number;
  payout: bigint;
  pnl: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
  decisionSec: number;
  voidReason: number;
}

const lc = (a: string) => a.toLowerCase();

export class ChainRoundBook implements RoundBook {
  private readonly rounds = new Map<string, ChainRound>();
  private readonly active = new Map<string, string>();
  private readonly listeners = new Set<(r: ChainRound, change: RoundChange) => void>();

  private readonly keepSettled: number;


  constructor(keepSettled = 5000) {

    this.keepSettled = keepSettled;

  }

  // ── port ──────────────────────────────────────────────────────────────────

  open(): ChainRound[] {
    return [...this.rounds.values()].filter((r) => r.status === 'open');
  }

  get(roundId: bigint): ChainRound | undefined {
    return this.rounds.get(roundId.toString());
  }

  activeFor(player: Address): ChainRound | undefined {
    const id = this.active.get(lc(player));
    return id ? this.rounds.get(id) : undefined;
  }

  toDTO(roundId: bigint): RoundDTO | undefined {
    const r = this.get(roundId);
    return r ? roundToDTO(r) : undefined;
  }

  // ── extensions ────────────────────────────────────────────────────────────

  /** The player's most recently settled round in memory (for `hello.player.lastSettled`). */
  lastSettledFor(player: Address): ChainRound | undefined {
    let best: ChainRound | undefined;
    for (const r of this.rounds.values()) {
      if (r.status !== 'settled' || lc(r.player) !== lc(player)) continue;
      const at = r.settledAtMs ?? 0;
      const bestAt = best?.settledAtMs ?? 0;
      if (!best || at > bestAt || (at === bestAt && r.roundId > best.roundId)) best = r;
    }
    return best;
  }

  all(): ChainRound[] {
    return [...this.rounds.values()];
  }

  onChange(cb: (r: ChainRound, change: RoundChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  load(rounds: ChainRound[]): void {
    for (const r of rounds) {
      this.rounds.set(r.roundId.toString(), r);
      if (r.status === 'open') this.active.set(lc(r.player), r.roundId.toString());
    }
  }

  // ── mutations (indexer) ───────────────────────────────────────────────────

  applyOpened(a: OpenedArgs, tx: { txHash: Hex; blockNumber: bigint; logIndex: number }, nowMs: number): ChainRound | undefined {
    const key = a.roundId.toString();
    if (this.rounds.has(key)) return undefined;
    const t = a.terms;
    const r: ChainRound = {
      roundId: a.roundId,
      player: a.player,
      assetId: a.assetId,
      pairId: t.pairId,
      terms: {
        direction: t.direction as Direction,
        stake: t.stake,
        maxPayout: t.maxPayout,
        entrySec: t.entrySec,
        endSec: t.endSec,
        targetPpm: t.targetPpm,
        stopPpm: t.stopPpm,
        multiplierBps: t.multiplierBps,
        feeBps: t.feeBps,
        maxJumpPpm: t.maxJumpPpm,
        cashOutRequested: false,
      },
      openTx: tx.txHash,
      status: 'open',
      tier: t.tier,
      laneVersion: t.laneVersion,
      oracleIdx: t.oracleIdx,
      openedEndSec: t.endSec,
      exitSec: null,
      entryPrice: null,
      outcome: null,
      voidReason: null,
      payout: null,
      pnl: null,
      exitPrice: null,
      decisionSec: null,
      openBlock: tx.blockNumber,
      openLogIndex: tx.logIndex,
      // entrySec = block.timestamp + ENTRY_DELAY_SEC (F1a §7), so the open block time is exact.
      openedAtMs: (t.entrySec - ENTRY_DELAY_SEC) * 1000,
      cashOutTx: null,
      settleTx: null,
      settleBlock: null,
      settledAtMs: null,
      settleFinalized: false,
      updatedAtMs: nowMs,
    };
    this.rounds.set(key, r);
    this.active.set(lc(r.player), key);
    this.emit(r, 'opened');
    return r;
  }

  applyCashOut(roundId: bigint, exitSec: number, txHash: Hex, nowMs: number): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r || r.terms.cashOutRequested) return undefined;
    r.terms = { ...r.terms, endSec: exitSec, cashOutRequested: true };
    r.exitSec = exitSec;
    r.cashOutTx = txHash;
    r.updatedAtMs = nowMs;
    this.emit(r, 'cashout');
    return r;
  }

  applySettled(a: SettledArgs, tx: { txHash: Hex; blockNumber: bigint }, settledAtMs: number, nowMs: number): ChainRound | undefined {
    const r = this.get(a.roundId);
    if (!r || r.status === 'settled') return undefined;
    r.status = 'settled';
    r.outcome = a.outcome as Outcome;
    r.voidReason = a.voidReason as VoidReason;
    r.payout = a.payout;
    r.pnl = a.pnl;
    if (a.entryPrice > 0n) r.entryPrice = a.entryPrice;
    r.exitPrice = a.outcome === Outcome.Voided ? null : a.exitPrice;
    r.decisionSec = a.decisionSec;
    r.settleTx = tx.txHash;
    r.settleBlock = tx.blockNumber;
    r.settledAtMs = settledAtMs;
    r.updatedAtMs = nowMs;
    if (this.active.get(lc(r.player)) === r.roundId.toString()) this.active.delete(lc(r.player));
    this.emit(r, 'settled');
    this.evict();
    return r;
  }

  setEntryPrice(roundId: bigint, price18: bigint, nowMs: number): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r || r.entryPrice !== null) return undefined;
    r.entryPrice = price18;
    r.updatedAtMs = nowMs;
    this.emit(r, 'entry');
    return r;
  }

  markFinalized(roundId: bigint, nowMs: number): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r || r.status !== 'settled' || r.settleFinalized) return undefined;
    r.settleFinalized = true;
    r.updatedAtMs = nowMs;
    this.emit(r, 'finalized');
    return r;
  }

  /** Rounds waiting for an entry price from a checkpoint (pairId, sec) on oracle `oracleIdx`. */
  awaitingEntry(oracleIdx: number, pairId: number, sec: number): ChainRound[] {
    return this.open().filter((r) => r.entryPrice === null && r.oracleIdx === oracleIdx && r.pairId === pairId && r.terms.entrySec === sec);
  }

  // ── undo (reorg) ──────────────────────────────────────────────────────────

  undoOpened(roundId: bigint): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r) return undefined;
    this.rounds.delete(roundId.toString());
    if (this.active.get(lc(r.player)) === roundId.toString()) this.active.delete(lc(r.player));
    this.emit(r, 'reverted');
    return r;
  }

  undoCashOut(roundId: bigint, nowMs: number): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r || !r.terms.cashOutRequested) return undefined;
    r.terms = { ...r.terms, endSec: r.openedEndSec, cashOutRequested: false };
    r.exitSec = null;
    r.cashOutTx = null;
    r.updatedAtMs = nowMs;
    this.emit(r, 'reverted');
    return r;
  }

  undoSettled(roundId: bigint, nowMs: number): ChainRound | undefined {
    const r = this.get(roundId);
    if (!r || r.status !== 'settled') return undefined;
    r.status = 'open';
    r.outcome = null;
    r.voidReason = null;
    r.payout = null;
    r.pnl = null;
    r.exitPrice = null;
    r.decisionSec = null;
    r.settleTx = null;
    r.settleBlock = null;
    r.settledAtMs = null;
    r.settleFinalized = false;
    r.updatedAtMs = nowMs;
    this.active.set(lc(r.player), roundId.toString());
    this.emit(r, 'reverted');
    return r;
  }

  private emit(r: ChainRound, change: RoundChange): void {
    for (const cb of this.listeners) cb(r, change);
  }

  private evict(): void {
    const settled = [...this.rounds.values()].filter((r) => r.status === 'settled' && r.settleFinalized);
    if (settled.length <= this.keepSettled) return;
    settled.sort((a, b) => (a.settledAtMs ?? 0) - (b.settledAtMs ?? 0));
    for (const r of settled.slice(0, settled.length - this.keepSettled)) this.rounds.delete(r.roundId.toString());
  }
}
