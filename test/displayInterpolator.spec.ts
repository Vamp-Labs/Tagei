import { describe, expect, it } from 'vitest';
import {
  DISPLAY_TICK_MS,
  DISPLAY_TWEEN_MS,
  DisplayInterpolator,
  IMPACT_SNAP_MS,
  crossesLevel,
  easeOutCubic,
} from '../src/services/displayInterpolator';

describe('DisplayInterpolator', () => {
  it('tweens with easeOutCubic and lands exactly on the exact round', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.reset(100, 0);
    interpolator.push(101, 0);
    const samples = [1, 2, 3].map((i) => interpolator.sample(i * DISPLAY_TICK_MS));
    expect(samples[0]).toBeCloseTo(100 + easeOutCubic(DISPLAY_TICK_MS / DISPLAY_TWEEN_MS), 12);
    expect(samples[0]).toBeLessThan(samples[1]);
    expect(samples[1]).toBeLessThan(samples[2]);
    expect(samples[2]).toBeLessThan(101);
    expect(interpolator.sample(DISPLAY_TWEEN_MS)).toBe(101);
    expect(interpolator.sample(4 * DISPLAY_TICK_MS)).toBe(101);
  });

  it('converges within one 1 Hz round when sampled at 4 Hz', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.reset(50, 0);
    const exact = [50.2, 49.9, 50.4, 50.1];
    exact.forEach((price, index) => {
      const at = index * 1000;
      interpolator.push(price, at);
      expect(interpolator.sample(at + 4 * DISPLAY_TICK_MS)).toBe(price);
    });
  });

  it('never jumps when a new round arrives mid-tween', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.reset(100, 0);
    interpolator.push(102, 0);
    const before = interpolator.sample(300);
    interpolator.push(99, 300);
    expect(interpolator.sample(300)).toBe(before);
    expect(Math.abs(interpolator.sample(301) - before)).toBeLessThan(0.05);
  });

  it('never overshoots either endpoint', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.reset(10, 0);
    interpolator.push(9, 0);
    for (let t = 0; t <= DISPLAY_TWEEN_MS; t += 10) {
      const value = interpolator.sample(t);
      expect(value).toBeLessThanOrEqual(10);
      expect(value).toBeGreaterThanOrEqual(9);
    }
  });

  it('snaps in 150 ms when an exact round crosses a registered level', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.setLevels([100.5]);
    interpolator.reset(100, 0);
    const pushed = interpolator.push(101, 0);
    expect(pushed).toEqual({ snapped: true, durationMs: IMPACT_SNAP_MS, settlesAtMs: IMPACT_SNAP_MS });
    expect(interpolator.sample(IMPACT_SNAP_MS / 2)).toBeLessThan(101);
    expect(interpolator.sample(IMPACT_SNAP_MS)).toBe(101);
  });

  it('keeps the normal tween when no level is crossed, so the display never shows a touch early', () => {
    const interpolator = new DisplayInterpolator();
    interpolator.setLevels([102]);
    interpolator.reset(100, 0);
    expect(interpolator.push(101, 0).snapped).toBe(false);
    expect(interpolator.sample(IMPACT_SNAP_MS)).toBeLessThan(101);
    for (let t = 0; t <= DISPLAY_TWEEN_MS; t += 25) expect(interpolator.sample(t)).toBeLessThan(102);
  });

  it('treats a level as crossed inclusively and in both directions', () => {
    expect(crossesLevel(99, 100, 100)).toBe(true);
    expect(crossesLevel(101, 100, 100)).toBe(true);
    expect(crossesLevel(100, 101, 100)).toBe(false);
    expect(crossesLevel(99, 99.5, 100)).toBe(false);
  });

  it('initialises on the first push without animating from zero', () => {
    const interpolator = new DisplayInterpolator();
    expect(interpolator.isInitialized()).toBe(false);
    interpolator.push(612.34, 1000);
    expect(interpolator.sample(1000)).toBe(612.34);
  });
});
