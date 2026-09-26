import { describe, expect, it } from 'vitest';
import { laneEdgeGuardOk } from '@bnbplay/shared/lane';
import { BASE_LANES, describeLane, mockSigma1sPpm, practiceLane, practiceTiers } from '../src/game/lanes';
import { SettlementEngine } from '../src/services/settlementEngine';
import { SUPPORTED_ASSETS, type AssetSymbol } from '../src/types/market';

const ASSETS: AssetSymbol[] = ['BNB', 'BTC', 'ETH', 'SOL', 'DOGE'];

describe('practice lanes', () => {
  it('keep the base multiplier and scale T/S by the mock volatility', () => {
    for (const asset of ASSETS) {
      const lane = practiceLane(asset, 0);
      expect(lane).not.toBeNull();
      if (!lane) continue;
      const base = BASE_LANES[asset].tiers[0];
      const scale = mockSigma1sPpm(SUPPORTED_ASSETS[asset].volatility) / BASE_LANES[asset].sigma1sPpm;
      expect(lane.multiplierBps).toBe(base.multiplierBps);
      expect(lane.targetPpm).toBe(Math.round(base.targetPpm * scale));
      expect(lane.stopPpm).toBe(Math.round(base.stopPpm * scale));
      expect(laneEdgeGuardOk(lane.targetPpm, lane.stopPpm, lane.multiplierBps, Math.ceil(BASE_LANES[asset].gapMarginPpm * scale))).toBe(true);
    }
  });

  it('keeps disabled tiers disabled (BTC BOOST, every HYPER/WARP)', () => {
    expect(practiceLane('BTC', 1)).toBeNull();
    for (const asset of ASSETS) {
      expect(practiceLane(asset, 2)).toBeNull();
      expect(practiceLane(asset, 3)).toBeNull();
      expect(practiceTiers(asset).filter((tier) => tier.enabled).map((tier) => tier.label)).toEqual(asset === 'BTC' ? ['CRUISE'] : ['CRUISE', 'BOOST']);
    }
  });

  it('lands BNB CRUISE close to today’s 1.2 % practice target', () => {
    const lane = practiceLane('BNB', 0);
    expect(lane?.targetPpm).toBeGreaterThan(10_000);
    expect(lane?.targetPpm).toBeLessThan(15_000);
  });

  it('describes a lane in the PRE_TRADE copy format', () => {
    expect(describeLane({ targetPpm: 500, stopPpm: 400, multiplierBps: 20_000 })).toBe('Target +0.05% · Stop −0.04% · 2x');
    expect(describeLane({ targetPpm: 226, stopPpm: 434, multiplierBps: 15_000 })).toBe('Target +0.0226% · Stop −0.0434% · 1.5x');
  });
});

describe('SettlementEngine lane facade', () => {
  it('opens a practice round from a lane and evaluates with the shared lane math', () => {
    const lane = practiceLane('BNB', 0);
    if (!lane) throw new Error('lane expected');
    const round = SettlementEngine.initLaneRound('BNB', 'LONG', 10, 600, lane, 1_000_000);
    expect(round.mode).toBe('practice');
    expect(round.durationSeconds).toBe(30);
    expect(round.targetPrice).toBeGreaterThan(600);
    expect(round.stopLossPrice).toBeLessThan(600);

    const flat = SettlementEngine.evaluateLaneTick(round, 600);
    expect(flat.updatedRound.currentPnl).toBeCloseTo(-0.1, 2);
    expect(flat.isTargetHit).toBe(false);

    const hit = SettlementEngine.evaluateLaneTick(round, round.targetPrice + 0.01);
    expect(hit.isTargetHit).toBe(true);
    expect(hit.updatedRound.currentPnl).toBe(5);

    const stop = SettlementEngine.evaluateLaneTick(round, round.stopLossPrice - 0.01);
    expect(stop.isLossHit).toBe(true);
    expect(stop.updatedRound.currentPnl).toBe(-10);
  });

  it('falls back to the legacy evaluator for rounds without lane terms', () => {
    const legacy = SettlementEngine.initRound('BNB', 'LONG', 10, 600);
    const viaFacade = SettlementEngine.evaluateLaneTick(legacy, 604);
    expect(viaFacade.updatedRound).toEqual(SettlementEngine.evaluateTick(legacy, 604).updatedRound);
    expect(viaFacade.mark).toBeNull();
  });
});
