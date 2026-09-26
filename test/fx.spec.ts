import { describe, expect, it } from 'vitest';
import { FX_REFERENCE, fxPnl, fxPnlForRound } from '../src/game/fx';
import { SettlementEngine } from '../src/services/settlementEngine';

describe('fxPnl normalisation', () => {
  it('is the identity at the reference stake $10, M 2.84 and no fee', () => {
    const samples = [-10, -6.25, -4.2, -0.01, 0, 0.05, 2.5, 5, 8, 12.5, 18.4];
    for (const pnl of samples) {
      expect(fxPnl({ pnl, stake: FX_REFERENCE.stakeUsd, multiplierBps: FX_REFERENCE.multiplierBps, feeBps: 0 })).toBe(pnl);
    }
  });

  it('defaults to the reference lane, so today’s practice P&L reaches the canvas unchanged', () => {
    const round = SettlementEngine.initRound('BNB', 'LONG', 10, 600);
    const { updatedRound } = SettlementEngine.evaluateTick(round, 603);
    expect(fxPnlForRound(updatedRound)).toBe(updatedRound.currentPnl);
  });

  it('scales losses by stake so the full stake always maps to −$10', () => {
    expect(fxPnl({ pnl: -20, stake: 20, multiplierBps: 15_000, feeBps: 100 })).toBeCloseTo(-10, 10);
    expect(fxPnl({ pnl: -5, stake: 5, multiplierBps: 20_000, feeBps: 0 })).toBeCloseTo(-10, 10);
  });

  it('maps a target hit on any lane to the reference win of +$18.40', () => {
    expect(fxPnl({ pnl: 5, stake: 10, multiplierBps: 15_000, feeBps: 100 })).toBeCloseTo(18.4, 10);
    expect(fxPnl({ pnl: 50, stake: 50, multiplierBps: 20_000, feeBps: 100 })).toBeCloseTo(18.4, 10);
  });

  it('removes the interior fee before scaling so the FX never under-reacts to a gain', () => {
    const payoutAfterFee = 12 * 0.99;
    const normalised = fxPnl({ pnl: payoutAfterFee - 10, stake: 10, multiplierBps: 15_000, feeBps: 100 });
    expect(normalised).toBeCloseTo(2 * (18_400 / 5_000), 10);
  });

  it('returns 0 for degenerate input instead of NaN', () => {
    expect(fxPnl({ pnl: Number.NaN, stake: 10 })).toBe(0);
    expect(fxPnl({ pnl: 1, stake: 0 })).toBe(0);
  });
});
