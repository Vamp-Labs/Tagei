import { describe, it, expect } from 'vitest';
import { SettlementEngine, DEFAULT_CONFIG } from '../src/services/settlementEngine';

describe('SettlementEngine — Data Integrity & Logic (PRD §37)', () => {
  it('initializes a LONG round with exact target and stop loss levels', () => {
    const entryPrice = 600.0;
    const stake = 10.0;
    const round = SettlementEngine.initRound('BNB', 'LONG', stake, entryPrice, {
      ...DEFAULT_CONFIG,
      targetThresholdPct: 1.0,
      stopLossThresholdPct: 1.0,
    });

    expect(round.entryPrice).toBe(600.0);
    expect(round.targetPrice).toBe(606.0); // +1%
    expect(round.stopLossPrice).toBe(594.0); // -1%
    expect(round.currentPnl).toBe(0);
  });

  it('initializes a SHORT round with inverted target and stop loss levels', () => {
    const entryPrice = 600.0;
    const stake = 10.0;
    const round = SettlementEngine.initRound('BNB', 'SHORT', stake, entryPrice, {
      ...DEFAULT_CONFIG,
      targetThresholdPct: 1.0,
      stopLossThresholdPct: 1.0,
    });

    expect(round.entryPrice).toBe(600.0);
    expect(round.targetPrice).toBe(594.0); // -1%
    expect(round.stopLossPrice).toBe(606.0); // +1%
  });

  it('correctly detects a LONG target hit when exact raw price reaches target', () => {
    const entryPrice = 600.0;
    const stake = 10.0;
    const round = SettlementEngine.initRound('BNB', 'LONG', stake, entryPrice, {
      ...DEFAULT_CONFIG,
      targetThresholdPct: 1.0,
      stopLossThresholdPct: 1.0,
      multiplierLeverage: 10.0,
    });

    // Price moves to 606.5
    const evaluation = SettlementEngine.evaluateTick(round, 606.5, {
      ...DEFAULT_CONFIG,
      multiplierLeverage: 10.0,
    });

    expect(evaluation.isTargetHit).toBe(true);
    expect(evaluation.isLossHit).toBe(false);
    expect(evaluation.updatedRound.currentPnl).toBeGreaterThan(0);
  });

  it('correctly detects a SHORT target hit when exact raw price drops to target', () => {
    const entryPrice = 600.0;
    const stake = 10.0;
    const round = SettlementEngine.initRound('BNB', 'SHORT', stake, entryPrice, {
      ...DEFAULT_CONFIG,
      targetThresholdPct: 1.0,
      stopLossThresholdPct: 1.0,
      multiplierLeverage: 10.0,
    });

    // Price drops to 593.5
    const evaluation = SettlementEngine.evaluateTick(round, 593.5, {
      ...DEFAULT_CONFIG,
      multiplierLeverage: 10.0,
    });

    expect(evaluation.isTargetHit).toBe(true);
    expect(evaluation.isLossHit).toBe(false);
    expect(evaluation.updatedRound.currentPnl).toBeGreaterThan(0);
  });

  it('correctly detects stop loss hit and caps loss at stake', () => {
    const entryPrice = 600.0;
    const stake = 10.0;
    const round = SettlementEngine.initRound('BNB', 'LONG', stake, entryPrice, {
      ...DEFAULT_CONFIG,
      targetThresholdPct: 1.0,
      stopLossThresholdPct: 1.0,
      multiplierLeverage: 20.0,
    });

    // Price plummets to 550.0
    const evaluation = SettlementEngine.evaluateTick(round, 550.0, {
      ...DEFAULT_CONFIG,
      multiplierLeverage: 20.0,
    });

    expect(evaluation.isLossHit).toBe(true);
    expect(evaluation.updatedRound.currentPnl).toBe(-10.0); // capped at -stake
  });
});
