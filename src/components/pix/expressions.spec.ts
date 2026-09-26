import { describe, expect, it } from 'vitest';
import { pixExpressionFor, type PixExpressionInput } from './expressions';
import { HAPPY_PNL, NEAR_STOP_FX_PNL } from './mood';

const base: PixExpressionInput = {
  gameStage: 'HOME',
  targetProgressPct: 0,
  fxPnl: 0,
  selectedDirection: null,
};

describe('pixExpressionFor', () => {
  it('reads idle on HOME', () => {
    expect(pixExpressionFor(base)).toBe('idle');
  });

  it('reads idle on PRE_TRADE with no direction chosen', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'PRE_TRADE' })).toBe('idle');
  });

  it('reads ready on PRE_TRADE once a direction is chosen', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'PRE_TRADE', selectedDirection: 'LONG' })).toBe('ready');
    expect(pixExpressionFor({ ...base, gameStage: 'PRE_TRADE', selectedDirection: 'SHORT' })).toBe('ready');
  });

  it('reads idle on LIVE_TRADE between the happy and alert thresholds', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'LIVE_TRADE', fxPnl: 0 })).toBe('idle');
  });

  it('reads happy on LIVE_TRADE at or above HAPPY_PNL', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'LIVE_TRADE', fxPnl: HAPPY_PNL })).toBe('happy');
    expect(pixExpressionFor({ ...base, gameStage: 'LIVE_TRADE', fxPnl: HAPPY_PNL + 10 })).toBe('happy');
  });

  it('reads alert on LIVE_TRADE at or below NEAR_STOP_FX_PNL', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'LIVE_TRADE', fxPnl: NEAR_STOP_FX_PNL })).toBe('alert');
    expect(pixExpressionFor({ ...base, gameStage: 'LIVE_TRADE', fxPnl: NEAR_STOP_FX_PNL - 10 })).toBe('alert');
  });

  it('reads celebrate on TARGET_HIT regardless of fxPnl', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'TARGET_HIT', fxPnl: -5 })).toBe('celebrate');
  });

  it('reads concerned on LOSS_HIT regardless of fxPnl', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'LOSS_HIT', fxPnl: 5 })).toBe('concerned');
  });

  it('reads loading on SETTLING', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'SETTLING' })).toBe('loading');
  });

  it('reads celebrate on RESULT with a non-negative fxPnl', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'RESULT', fxPnl: 0 })).toBe('celebrate');
    expect(pixExpressionFor({ ...base, gameStage: 'RESULT', fxPnl: 3 })).toBe('celebrate');
  });

  it('reads concerned on RESULT with a negative fxPnl', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'RESULT', fxPnl: -0.01 })).toBe('concerned');
  });

  it('reads idle on LAUNCHING', () => {
    expect(pixExpressionFor({ ...base, gameStage: 'LAUNCHING' })).toBe('idle');
  });
});
