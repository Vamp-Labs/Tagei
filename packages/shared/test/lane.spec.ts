import { describe, expect, it } from 'vitest';
import { Direction } from '../src/enums.ts';
import {
  Touch,
  barrierPrices,
  directional,
  interiorPayout,
  jumpOk,
  laneEdgeGuardOk,
  maxPayout,
  touch,
  validateLane,
  type LaneParams,
} from '../src/lane.ts';

const E18 = 10n ** 18n;
const p0 = 612n * E18 + 340_000_000_000_000_000n; // 612.34
const stake = 10n * E18;

describe('directional', () => {
  it('treats a zero move as favourable for both directions', () => {
    expect(directional(Direction.Long, p0, p0)).toEqual({ fav: true, mag: 0n });
    expect(directional(Direction.Short, p0, p0)).toEqual({ fav: true, mag: 0n });
  });

  it('mirrors LONG and SHORT', () => {
    expect(directional(Direction.Long, p0, p0 + 5n).fav).toBe(true);
    expect(directional(Direction.Short, p0, p0 + 5n).fav).toBe(false);
    expect(directional(Direction.Short, p0, p0 - 5n)).toEqual({ fav: true, mag: 5n });
  });
});

describe('barriers are inclusive and exact', () => {
  for (const direction of [Direction.Long, Direction.Short]) {
    it(`direction ${direction}`, () => {
      const { target, stop } = barrierPrices(direction, p0, 450, 400);
      const at = (p: bigint) => {
        const d = directional(direction, p0, p);
        return touch(d.fav, d.mag, p0, 450, 400);
      };
      const toward = direction === Direction.Long ? -1n : 1n;
      expect(at(target)).toBe(Touch.Target);
      expect(at(target + toward)).toBe(Touch.None);
      expect(at(stop)).toBe(Touch.Stop);
      expect(at(stop - toward)).toBe(Touch.None);
    });
  }
});

describe('payouts', () => {
  it('maxPayout floors stake × M', () => {
    expect(maxPayout(stake, 20_000)).toBe(20n * E18);
    expect(maxPayout(7n, 15_000)).toBe(10n);
  });

  it('pays stake × (1 − fee) at a flat terminal', () => {
    expect(interiorPayout(stake, true, 0n, p0, 450, 400, 20_000, 100)).toBe((stake * 9_900n) / 10_000n);
  });

  it('is monotone in the favourable move and stays below maxPayout', () => {
    const { target } = barrierPrices(Direction.Long, p0, 450, 400);
    let last = -1n;
    for (let i = 0n; i < 20n; i++) {
      const p = p0 + ((target - p0 - 1n) * i) / 19n;
      const { fav, mag } = directional(Direction.Long, p0, p);
      const v = interiorPayout(stake, fav, mag, p0, 450, 400, 20_000, 100);
      expect(v >= last).toBe(true);
      expect(v < maxPayout(stake, 20_000)).toBe(true);
      last = v;
    }
  });

  it('approaches zero just inside the stop', () => {
    const { stop } = barrierPrices(Direction.Long, p0, 450, 400);
    const { fav, mag } = directional(Direction.Long, p0, stop + 1n);
    const v = interiorPayout(stake, fav, mag, p0, 450, 400, 20_000, 100);
    expect(v < stake / 1000n).toBe(true);
  });
});

describe('lane validation', () => {
  const base: LaneParams = {
    targetPpm: 450,
    stopPpm: 400,
    multiplierBps: 20_000,
    feeBps: 100,
    durationSec: 20,
    enabled: true,
    minStake: 5n * E18,
    maxStake: 50n * E18,
  };

  it('accepts the example tiers from the plan', () => {
    const tiers = [
      { m: 15_000, s: 500, t: 300 },
      { m: 20_000, s: 400, t: 450 },
      { m: 30_000, s: 300, t: 700 },
      { m: 50_000, s: 200, t: 1050 },
    ];
    for (const x of tiers) expect(laneEdgeGuardOk(x.t, x.s, x.m, 65)).toBe(true);
  });

  it('rejects a lane that pays too much for its barriers', () => {
    expect(validateLane({ ...base, targetPpm: 300, stopPpm: 400 }, 65)).toContain('house edge guard violated');
  });

  it('rejects out-of-range parameters', () => {
    expect(validateLane({ ...base, feeBps: 5_000 }, 65)).toContain('feeBps out of range');
    expect(validateLane({ ...base, durationSec: 200 }, 65)).toContain('durationSec out of range');
    expect(validateLane(base, 65)).toEqual([]);
  });
});

describe('jumpOk', () => {
  it('is inclusive at the limit', () => {
    const prev = 1_000_000n;
    expect(jumpOk(prev, prev + 5_000n, 5_000)).toBe(true);
    expect(jumpOk(prev, prev + 5_001n, 5_000)).toBe(false);
    expect(jumpOk(prev, prev - 5_000n, 5_000)).toBe(true);
  });
});
