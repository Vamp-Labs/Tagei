export type MonotonicClock = () => number;

const defaultMonotonic: MonotonicClock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

export interface ServerClockOptions {
  monotonic?: MonotonicClock;
  wall?: () => number;
}

export class ServerClock {
  private anchor: { serverMs: number; monotonicMs: number } | null = null;
  private readonly monotonic: MonotonicClock;
  private readonly wall: () => number;

  constructor(options: ServerClockOptions = {}) {
    this.monotonic = options.monotonic ?? defaultMonotonic;
    this.wall = options.wall ?? (() => Date.now());
  }

  sync(serverTimeMs: number, receivedAtMonotonicMs: number = this.monotonic()): void {
    this.anchor = { serverMs: serverTimeMs, monotonicMs: receivedAtMonotonicMs };
  }

  now(): number {
    if (!this.anchor) return this.wall();
    return this.anchor.serverMs + (this.monotonic() - this.anchor.monotonicMs);
  }

  nowSec(): number {
    return Math.floor(this.now() / 1000);
  }

  offsetMs(): number {
    return this.now() - this.wall();
  }

  isSynced(): boolean {
    return this.anchor !== null;
  }

  reset(): void {
    this.anchor = null;
  }
}
