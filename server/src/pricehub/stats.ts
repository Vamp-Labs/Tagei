// Per-pair statistics from exact Supra rounds (never interpolated prices):
// σ₁ₛ EWMA (display/PIX), robust bipower σ₁ₛ (adaptive lanes, F1e), momentum, and a
// lane backtest (touch rates) for /v1/oracle/calibration and demo:check.

import { Direction } from '@bnbplay/shared/enums';
import { Touch, directional, touch } from '@bnbplay/shared/lane';
import type { OracleRound } from '../ports.ts';

/** Simple return p/prev − 1 in ppm (float, 1e-6 ppm resolution). */
export function returnPpm(prev: bigint, p: bigint): number {
  return Number(((p - prev) * 1_000_000_000_000n) / prev) / 1e6;
}

/** 1-second returns between rounds exactly one second apart (gaps are skipped). */
export function secondReturns(rounds: readonly OracleRound[]): { sec: number; r: number }[] {
  const out: { sec: number; r: number }[] = [];
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].sec === rounds[i - 1].sec + 1) out.push({ sec: rounds[i].sec, r: returnPpm(rounds[i - 1].price18, rounds[i].price18) });
  }
  return out;
}

/** Robust σ₁ₛ = sqrt(π/2 · mean(|r_t|·|r_{t−1}|)) over consecutive returns (same estimator as research/scripts/calibrate-lanes.mjs). */
export function bipowerSigmaPpm(rounds: readonly OracleRound[]): { sigmaPpm: number | null; samples: number } {
  const rs = secondReturns(rounds);
  let sum = 0;
  let n = 0;
  for (let i = 1; i < rs.length; i++) {
    if (rs[i].sec !== rs[i - 1].sec + 1) continue;
    sum += Math.abs(rs[i].r) * Math.abs(rs[i - 1].r);
    n++;
  }
  return { sigmaPpm: n > 0 ? Math.sqrt((Math.PI / 2) * (sum / n)) : null, samples: rs.length };
}

export function plainSigmaPpm(rounds: readonly OracleRound[]): number | null {
  const rs = secondReturns(rounds).map((x) => x.r);
  if (rs.length < 2) return null;
  const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
  return Math.sqrt(rs.reduce((s, x) => s + (x - mean) ** 2, 0) / rs.length);
}

/** Return of the newest round vs the newest round at least `lookbackSec` older, in ppm. */
export function momentumPpm(rounds: readonly OracleRound[], lookbackSec: number): number | null {
  const last = rounds[rounds.length - 1];
  if (!last) return null;
  for (let i = rounds.length - 2; i >= 0; i--) {
    if (rounds[i].sec <= last.sec - lookbackSec) return returnPpm(rounds[i].price18, last.price18);
  }
  return null;
}

export class EwmaSigma {
  private variance: number | null = null;
  private warm: number[] = [];
  private last: { sec: number; price: bigint } | undefined;
  private readonly lambda: number;
  count = 0;

  private readonly warmupN: number;


  constructor(halfLifeSec = 300, warmupN = 30) {

    this.warmupN = warmupN;
    this.lambda = Math.exp(Math.log(0.5) / halfLifeSec);
  }

  update(sec: number, price18: bigint): void {
    const prev = this.last;
    this.last = { sec, price: price18 };
    if (!prev || sec !== prev.sec + 1) return;
    const r = returnPpm(prev.price, price18);
    this.count++;
    if (this.variance === null) {
      this.warm.push(r);
      if (this.warm.length >= this.warmupN) {
        this.variance = this.warm.reduce((s, x) => s + x * x, 0) / this.warm.length;
        this.warm = [];
      }
      return;
    }
    this.variance = this.lambda * this.variance + (1 - this.lambda) * r * r;
  }

  value(): number | null {
    return this.variance === null ? null : Math.sqrt(this.variance);
  }
}

export interface TouchRates {
  starts: number;
  pTP: number;
  pSL: number;
  pTimeout: number;
}

/** Backtests a lane on consecutive rounds, LONG and SHORT from every start second. */
export function backtestTouchRates(rounds: readonly OracleRound[], lane: { targetPpm: number; stopPpm: number; durationSec: number }): TouchRates {
  let starts = 0;
  let tp = 0;
  let sl = 0;
  const D = lane.durationSec;
  for (let i = 0; i + D < rounds.length; i++) {
    if (rounds[i + D].sec !== rounds[i].sec + D) continue; // needs a complete path
    const p0 = rounds[i].price18;
    for (const dir of [Direction.Long, Direction.Short]) {
      starts++;
      for (let s = 1; s <= D; s++) {
        const { fav, mag } = directional(dir, p0, rounds[i + s].price18);
        const t = touch(fav, mag, p0, lane.targetPpm, lane.stopPpm);
        if (t === Touch.Target) {
          tp++;
          break;
        }
        if (t === Touch.Stop) {
          sl++;
          break;
        }
      }
    }
  }
  if (starts === 0) return { starts, pTP: 0, pSL: 0, pTimeout: 0 };
  return { starts, pTP: tp / starts, pSL: sl / starts, pTimeout: (starts - tp - sl) / starts };
}

/** Percentile of a numeric sample (nearest-rank). */
export function percentile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}
