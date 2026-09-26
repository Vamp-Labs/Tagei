import { describe, expect, it } from 'vitest';
import type { OracleRound } from '../../src/ports.ts';
import { EwmaSigma, backtestTouchRates, bipowerSigmaPpm, momentumPpm, returnPpm } from '../../src/pricehub/stats.ts';

const E18 = 10n ** 18n;
const round = (sec: number, price: bigint): OracleRound => ({ pairId: 49, roundMs: BigInt(sec) * 1000n, sec, tsMs: sec * 1000 + 160, price18: price, proofHash: '0x00', receivedAtMs: 0 });

describe('stats', () => {
  it('computes bipower σ like calibrate-lanes.mjs', () => {
    const prices = [100, 101, 100, 102, 101, 101].map((p) => BigInt(p) * E18);
    const rounds = prices.map((p, i) => round(1000 + i, p));
    const r = prices.slice(1).map((p, i) => Number(p - prices[i]) / Number(prices[i]) * 1e6);
    let bp = 0;
    for (let i = 1; i < r.length; i++) bp += Math.abs(r[i]) * Math.abs(r[i - 1]);
    const expected = Math.sqrt((Math.PI / 2) * (bp / (r.length - 1)));
    expect(bipowerSigmaPpm(rounds).sigmaPpm).toBeCloseTo(expected, 3);
    expect(bipowerSigmaPpm(rounds).samples).toBe(5);
  });

  it('skips returns across missing seconds', () => {
    const rounds = [round(1, 100n * E18), round(2, 101n * E18), round(5, 90n * E18), round(6, 91n * E18)];
    expect(bipowerSigmaPpm(rounds).samples).toBe(2);
  });

  it('measures momentum and returns in ppm', () => {
    expect(returnPpm(100n * E18, 101n * E18)).toBeCloseTo(10_000, 6);
    const rounds = Array.from({ length: 70 }, (_, i) => round(i, (1000n + BigInt(i)) * E18));
    expect(momentumPpm(rounds, 60)).toBeCloseTo((1069 / 1009 - 1) * 1e6, 3);
  });

  it('warms up the EWMA before reporting', () => {
    const e = new EwmaSigma(300, 5);
    for (let i = 0; i < 5; i++) e.update(i, 100n * E18 + BigInt(i % 2) * E18);
    expect(e.value()).toBeNull();
    e.update(5, 100n * E18);
    expect(e.value()).toBeGreaterThan(0);
  });

  it('backtests touch rates on complete paths only', () => {
    const up = Array.from({ length: 12 }, (_, i) => round(i, (10_000n + BigInt(i)) * E18));
    const rates = backtestTouchRates(up, { targetPpm: 250, stopPpm: 250, durationSec: 5 });
    expect(rates.starts).toBe(14);
    expect(rates.pTP).toBeCloseTo(0.5, 6); // every LONG hits +250 ppm within 5 s
    expect(rates.pSL).toBeCloseTo(0.5, 6);
  });
});
