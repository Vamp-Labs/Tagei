// Client IP resolution. IPs never leave memory unhashed: limiters and tables key on
// sha256(IP_HASH_SALT : ip). Behind Railway, TRUST_PROXY=true reads X-Forwarded-For.

import { createHash } from 'node:crypto';
import type { Context } from 'hono';

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    const first = xff?.split(',')[0]?.trim();
    if (first) return first;
    const real = c.req.header('x-real-ip')?.trim();
    if (real) return real;
  }
  // @hono/node-server exposes the Node request as c.env.incoming.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export const hashIp = (ip: string, salt: string): string =>
  createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);

export function ipHashOf(c: Context, opts: { trustProxy: boolean; salt: string }): string {
  return hashIp(clientIp(c, opts.trustProxy), opts.salt);
}
