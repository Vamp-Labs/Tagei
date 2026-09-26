export const DISPLAY_TICK_MS = 250;
export const DISPLAY_TWEEN_MS = 900;
export const IMPACT_SNAP_MS = 150;

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export interface DisplayInterpolatorOptions {
  tweenMs?: number;
  snapMs?: number;
  ease?: (t: number) => number;
}

export interface PushResult {
  snapped: boolean;
  durationMs: number;
  settlesAtMs: number;
}

export const crossesLevel = (from: number, to: number, level: number): boolean =>
  (from < level && to >= level) || (from > level && to <= level);

export class DisplayInterpolator {
  private readonly tweenMs: number;
  private readonly snapMs: number;
  private readonly ease: (t: number) => number;
  private from = 0;
  private to = 0;
  private startMs = 0;
  private durationMs = 0;
  private initialized = false;
  private levels: readonly number[] = [];

  constructor(options: DisplayInterpolatorOptions = {}) {
    this.tweenMs = options.tweenMs ?? DISPLAY_TWEEN_MS;
    this.snapMs = options.snapMs ?? IMPACT_SNAP_MS;
    this.ease = options.ease ?? easeOutCubic;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(price: number, nowMs: number): void {
    this.from = price;
    this.to = price;
    this.startMs = nowMs;
    this.durationMs = 0;
    this.initialized = true;
  }

  clear(): void {
    this.initialized = false;
    this.durationMs = 0;
  }

  setLevels(levels: readonly number[] | null): void {
    this.levels = (levels ?? []).filter((level) => Number.isFinite(level));
  }

  getLevels(): readonly number[] {
    return this.levels;
  }

  target(): number {
    return this.to;
  }

  push(price: number, nowMs: number): PushResult {
    if (!this.initialized) {
      this.reset(price, nowMs);
      return { snapped: false, durationMs: 0, settlesAtMs: nowMs };
    }
    const current = this.sample(nowMs);
    const snapped = this.levels.some((level) => crossesLevel(current, price, level));
    this.from = current;
    this.to = price;
    this.startMs = nowMs;
    this.durationMs = snapped ? this.snapMs : this.tweenMs;
    return { snapped, durationMs: this.durationMs, settlesAtMs: nowMs + this.durationMs };
  }

  sample(nowMs: number): number {
    if (this.durationMs <= 0) return this.to;
    const progress = (nowMs - this.startMs) / this.durationMs;
    if (progress >= 1) return this.to;
    if (progress <= 0) return this.from;
    return this.from + (this.to - this.from) * this.ease(progress);
  }
}
