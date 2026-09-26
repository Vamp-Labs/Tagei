import { describe, expect, it } from 'vitest';
import { laneEdgeGuardOk } from '@bnbplay/shared/lane';
import { BASE_LANES, computeLaneUpdate } from '../../src/ops/lanes.ts';

const lane = (targetPpm: number, stopPpm: number, multiplierBps = 15_000) => ({
  targetPpm,
  stopPpm,
  multiplierBps,
  feeBps: 100,
  durationSec: 30,
  enabled: true,
  minStake: 5n * 10n ** 18n,
  maxStake: 50n * 10n ** 18n,
});

describe('adaptive lanes (F1e)', () => {
  const bnbCruise = BASE_LANES[0].tiers[0];

  it('keeps the lane when k moved by ≤ 20 %', () => {
    const d = computeLaneUpdate({ sigmaRecentPpm: 63.55 * 1.15, sigmaBasePpm: 63.55, base: bnbCruise, current: lane(226, 434), currentGapMarginPpm: 38 });
    expect(d.action).toBe('keep');
  });

  it('scales T and S by k = clamp(σ/σ_base, 0.5, 2) and rounds', () => {
    const d = computeLaneUpdate({ sigmaRecentPpm: 30, sigmaBasePpm: 63.55, base: bnbCruise, current: lane(226, 434), currentGapMarginPpm: 38 });
    expect(d).toMatchObject({ action: 'update', k: 30 / 63.55 < 0.5 ? 0.5 : 30 / 63.55, kCurrent: 1 });
    if (d.action !== 'update') throw new Error('expected update');
    expect(d.params.targetPpm).toBe(113);
    expect(d.params.stopPpm).toBe(217);
    expect(d.gapMarginPpm).toBe(Math.ceil(0.58 * 30));
    expect(d.params.multiplierBps).toBe(15_000);
    const big = computeLaneUpdate({ sigmaRecentPpm: 500, sigmaBasePpm: 63.55, base: bnbCruise, current: lane(226, 434), currentGapMarginPpm: 38 });
    expect(big.k).toBe(2);
  });

  it('derives k_current from the on-chain lane', () => {
    const d = computeLaneUpdate({ sigmaRecentPpm: 32, sigmaBasePpm: 63.55, base: bnbCruise, current: lane(113, 217), currentGapMarginPpm: 38 });
    expect(d.action).toBe('keep');
  });

  it('refuses a scaled lane that fails validateLane', () => {
    // BOOST-like lane where S·k grows past the guard with a HYPER multiplier
    const d = computeLaneUpdate({ sigmaRecentPpm: 200, sigmaBasePpm: 100, base: { targetPpm: 500, stopPpm: 400 }, current: lane(500, 400, 30_000), currentGapMarginPpm: 400 });
    expect(d.action).toBe('invalid');
  });

  it('every enabled base lane passes the setLane guard', () => {
    for (const a of Object.values(BASE_LANES)) {
      for (const t of a.tiers) expect(laneEdgeGuardOk(t.targetPpm, t.stopPpm, t.tier === 0 ? 15_000 : 20_000, 200)).toBe(true);
    }
  });
});
