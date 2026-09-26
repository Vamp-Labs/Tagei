// Full-path settlement — the reference for BnbPlayArena._evaluate (F1a §settle).
// The first barrier touched in time order decides; a complete path is required
// for timeout / cash-out; gaps void the round (stake refunded) only when they are
// provably permanent or the round has stalled.

import { STALL_AFTER_SEC } from './constants.ts';
import { Direction, Outcome, VoidReason } from './enums.ts';
import { Touch, directional, interiorPayout, jumpOk, touch } from './lane.ts';

export interface RoundTerms {
  direction: Direction;
  stake: bigint;
  maxPayout: bigint;
  entrySec: number;
  /** Terminal second; a cash-out request shortens it to exitSec. */
  endSec: number;
  targetPpm: number;
  stopPpm: number;
  multiplierBps: number;
  feeBps: number;
  maxJumpPpm: number;
  cashOutRequested: boolean;
}

export interface Checkpoint {
  price18: bigint;
  disputed: boolean;
}

export interface PathSource {
  /** Recorded checkpoint for the round's pair, or undefined when that second was never recorded. */
  get(sec: number): Checkpoint | undefined;
  /** True when the second can never be recorded any more (Supra already stored a newer round). */
  isPermanentlyMissing(sec: number): boolean;
}

export type Evaluation =
  | { decidable: true; outcome: Outcome; payout: bigint; decisionSec: number; voidReason: VoidReason; entryPrice: bigint | null; exitPrice: bigint | null }
  | { decidable: false; missingSec: number; entryPrice: bigint | null };

const voided = (reason: VoidReason, stake: bigint, sec: number, entryPrice: bigint | null): Evaluation => ({
  decidable: true,
  outcome: Outcome.Voided,
  payout: stake,
  decisionSec: sec,
  voidReason: reason,
  entryPrice,
  exitPrice: null,
});

function onMissing(terms: RoundTerms, src: PathSource, sec: number, nowSec: number, entryPrice: bigint | null): Evaluation {
  if (src.isPermanentlyMissing(sec)) return voided(VoidReason.CheckpointGap, terms.stake, sec, entryPrice);
  if (nowSec > terms.endSec + STALL_AFTER_SEC) return voided(VoidReason.Stalled, terms.stake, sec, entryPrice);
  return { decidable: false, missingSec: sec, entryPrice };
}

export function evaluatePath(terms: RoundTerms, src: PathSource, nowSec: number): Evaluation {
  const entry = src.get(terms.entrySec);
  if (!entry) return onMissing(terms, src, terms.entrySec, nowSec, null);
  if (entry.disputed) return voided(VoidReason.EntryInvalid, terms.stake, terms.entrySec, null);

  const p0 = entry.price18;
  let prev = p0;
  for (let sec = terms.entrySec + 1; sec <= terms.endSec; sec++) {
    const cp = src.get(sec);
    if (!cp) return onMissing(terms, src, sec, nowSec, p0);

    const valid = !cp.disputed && jumpOk(prev, cp.price18, terms.maxJumpPpm);
    prev = cp.price18;
    const terminal = sec === terms.endSec;

    if (!valid) {
      if (terminal) return voided(VoidReason.TerminalInvalid, terms.stake, sec, p0);
      // G1 L1: a conflicting signed price inside the path voids the round instead of being
      // skipped (skipping let a late dispute flip an already-decided outcome).
      if (cp.disputed) return voided(VoidReason.PathDisputed, terms.stake, sec, p0);
      continue; // price jump beyond maxJumpPpm: skip the second, no barrier evaluated
    }

    const { fav, mag } = directional(terms.direction, p0, cp.price18);
    const t = touch(fav, mag, p0, terms.targetPpm, terms.stopPpm);
    if (t === Touch.Target) {
      return { decidable: true, outcome: Outcome.TargetHit, payout: terms.maxPayout, decisionSec: sec, voidReason: VoidReason.None, entryPrice: p0, exitPrice: cp.price18 };
    }
    if (t === Touch.Stop) {
      return { decidable: true, outcome: Outcome.StopHit, payout: 0n, decisionSec: sec, voidReason: VoidReason.None, entryPrice: p0, exitPrice: cp.price18 };
    }
    if (terminal) {
      const payout = interiorPayout(terms.stake, fav, mag, p0, terms.targetPpm, terms.stopPpm, terms.multiplierBps, terms.feeBps);
      return {
        decidable: true,
        outcome: terms.cashOutRequested ? Outcome.CashedOut : Outcome.Timeout,
        payout,
        decisionSec: sec,
        voidReason: VoidReason.None,
        entryPrice: p0,
        exitPrice: cp.price18,
      };
    }
  }
  // endSec <= entrySec never passes contract validation (D >= 5, exitSec >= entrySec + 1).
  throw new Error('invalid round terms: endSec must be greater than entrySec');
}

/** Live mark-to-market for the HUD: what a terminal at `price18` would pay right now (no barrier touched). */
export function markToMarket(terms: RoundTerms, p0: bigint, price18: bigint): { payout: bigint; touch: Touch } {
  const { fav, mag } = directional(terms.direction, p0, price18);
  const t = touch(fav, mag, p0, terms.targetPpm, terms.stopPpm);
  if (t === Touch.Target) return { payout: terms.maxPayout, touch: t };
  if (t === Touch.Stop) return { payout: 0n, touch: t };
  return { payout: interiorPayout(terms.stake, fav, mag, p0, terms.targetPpm, terms.stopPpm, terms.multiplierBps, terms.feeBps), touch: t };
}
