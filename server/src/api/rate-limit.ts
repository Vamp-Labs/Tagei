// In-memory fixed-window limiters (single API instance in P0). Keys are salted
// IP hashes or lowercase player addresses.

import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors.ts';

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Counts a hit; returns the wait until the window resets when over the limit. */
  hit(key: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
      if (this.hits.size > 50_000) this.sweep(now);
    }
    if (entry.count >= this.limit) return { ok: false, retryAfterMs: entry.resetAt - now };
    entry.count++;
    return { ok: true };
  }

  /** Throws RATE_LIMITED when over the limit. */
  consume(key: string, message = 'too many requests'): void {
    const r = this.hit(key);
    if (!r.ok) throw new ApiError('RATE_LIMITED', message, { retryAfterMs: r.retryAfterMs });
  }

  sweep(now = this.now()): void {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

export function rateLimitMiddleware(limiter: RateLimiter, keyOf: (c: Parameters<MiddlewareHandler>[0]) => string): MiddlewareHandler {
  return async (c, next) => {
    limiter.consume(keyOf(c));
    await next();
  };
}
