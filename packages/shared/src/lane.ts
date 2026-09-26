// Target Lane math — the reference implementation that contracts/src/libraries/LaneMath.sol
// mirrors bit-for-bit (enforced by the golden vectors in vectors/lane-vectors.json).
// Prices are 18-decimal integers, barriers are ppm, multipliers and fees are bps.
// Every division floors, which always favours the house.

import { BPS, MAX_BARRIER_PPM, MAX_DURATION_SEC, MAX_FEE_BPS, MAX_MULTIPLIER_BPS, MIN_BARRIER_PPM, MIN_DURATION_SEC, MIN_MULTIPLIER_BPS, PPM } from './constants.ts';
import { Direction } from './enums.ts';

export interface LaneParams {
  targetPpm: number;
  stopPpm: number;
  multiplierBps: number;
  feeBps: number;
  durationSec: number;
  enabled: boolean;
  minStake: bigint;
  maxStake: bigint;
}

export const Touch = { None: 0, Target: 1, Stop: 2 } as const;
export type Touch = (typeof Touch)[keyof typeof Touch];

export const mulDiv = (a: bigint, b: bigint, c: bigint): bigint => (a * b) / c;

/** Favourable-or-not plus the absolute move. A zero move counts as favourable. */
export function directional(direction: Direction, p0: bigint, p: bigint): { fav: boolean; mag: bigint } {
  if (p >= p0) {
    const mag = p - p0;
    return { fav: direction === Direction.Long || mag === 0n, mag };
  }
  return { fav: direction === Direction.Short, mag: p0 - p };
}

/** Inclusive barrier check by cross-multiplication (no division). */
export function touch(fav: boolean, mag: bigint, p0: bigint, targetPpm: number, stopPpm: number): Touch {
  if (fav) return mag * PPM >= BigInt(targetPpm) * p0 ? Touch.Target : Touch.None;
  return mag * PPM >= BigInt(stopPpm) * p0 ? Touch.Stop : Touch.None;
}

export const maxPayout = (stake: bigint, multiplierBps: number): bigint => mulDiv(stake, BigInt(multiplierBps), BPS);

/**
 * Payout when the round ends between the barriers (timeout or cash-out).
 * fav:   V = 1 + (M-1)·r/T      unfav: V = 1 - |r|/S      then × (1 - fee).
 * Caller guarantees no barrier was touched at this price.
 */
export function interiorPayout(
  stake: bigint,
  fav: boolean,
  mag: bigint,
  p0: bigint,
  targetPpm: number,
  stopPpm: number,
  multiplierBps: number,
  feeBps: number,
): bigint {
  const keep = BPS - BigInt(feeBps);
  if (fav) {
    const den = p0 * BigInt(targetPpm);
    const num = BPS * den + (BigInt(multiplierBps) - BPS) * mag * PPM;
    return mulDiv(stake, num * keep, den * BPS * BPS);
  }
  const d = p0 * BigInt(stopPpm);
  return mulDiv(stake, (d - mag * PPM) * keep, d * BPS);
}

/** Smallest absolute move that satisfies an inclusive barrier of `ppm`. */
const barrierMove = (p0: bigint, ppm: number): bigint => (BigInt(ppm) * p0 + PPM - 1n) / PPM;

/** Exact barrier prices for display, rounded away from the entry. */
export function barrierPrices(direction: Direction, p0: bigint, targetPpm: number, stopPpm: number): { target: bigint; stop: bigint } {
  const t = barrierMove(p0, targetPpm);
  const s = barrierMove(p0, stopPpm);
  return direction === Direction.Long ? { target: p0 + t, stop: p0 - s } : { target: p0 - t, stop: p0 + s };
}

/** |p - prev| / prev <= maxJumpPpm, inclusive. */
export const jumpOk = (prev: bigint, p: bigint, maxJumpPpm: number): boolean => {
  const mag = p >= prev ? p - prev : prev - p;
  return mag * PPM <= BigInt(maxJumpPpm) * prev;
};

/** House-edge guard enforced by `setLane`: (M-1)·S + max(0, M-2)·gap <= T (all in bps × ppm). */
export function laneEdgeGuardOk(targetPpm: number, stopPpm: number, multiplierBps: number, gapMarginPpm: number): boolean {
  const m = BigInt(multiplierBps);
  const overTwo = m > 2n * BPS ? m - 2n * BPS : 0n;
  return (m - BPS) * BigInt(stopPpm) + overTwo * BigInt(gapMarginPpm) <= BPS * BigInt(targetPpm);
}

export function validateLane(p: LaneParams, gapMarginPpm: number): string[] {
  const errors: string[] = [];
  const inRange = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!inRange(p.targetPpm, MIN_BARRIER_PPM, MAX_BARRIER_PPM)) errors.push('targetPpm out of range');
  if (!inRange(p.stopPpm, MIN_BARRIER_PPM, MAX_BARRIER_PPM)) errors.push('stopPpm out of range');
  if (!inRange(p.multiplierBps, MIN_MULTIPLIER_BPS, MAX_MULTIPLIER_BPS)) errors.push('multiplierBps out of range');
  if (!inRange(p.feeBps, 0, MAX_FEE_BPS)) errors.push('feeBps out of range');
  if (!inRange(p.durationSec, MIN_DURATION_SEC, MAX_DURATION_SEC)) errors.push('durationSec out of range');
  if (p.minStake <= 0n || p.minStake > p.maxStake) errors.push('stake bounds invalid');
  if (errors.length === 0 && !laneEdgeGuardOk(p.targetPpm, p.stopPpm, p.multiplierBps, gapMarginPpm)) {
    errors.push('house edge guard violated');
  }
  return errors;
}
