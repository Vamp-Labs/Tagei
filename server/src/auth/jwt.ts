// HS256 session tokens (24 h) and the Bearer guard. Expiry is checked against the
// injected clock so tests can move time.

import type { Context, MiddlewareHandler } from 'hono';
import { sign, verify } from 'hono/jwt';
import { getAddress, isAddress, type Address } from 'viem';
import { ApiError } from '../api/errors.ts';
import { nowSec } from '../api/time.ts';
import type { PlayerKind } from './store.ts';

export const SESSION_TTL_SEC = 24 * 3600;

export interface SessionClaims {
  player: Address;
  kind: PlayerKind;
  iat: number;
  exp: number;
}

export const signSession = (secret: string, s: SessionClaims): Promise<string> =>
  sign({ sub: s.player, kind: s.kind, iat: s.iat, exp: s.exp }, secret, 'HS256');

export async function verifySession(secret: string, token: string, atSec: number): Promise<SessionClaims | null> {
  try {
    const p = await verify(token, secret, { alg: 'HS256', exp: false, iat: false, nbf: false });
    if (typeof p.sub !== 'string' || !isAddress(p.sub) || typeof p.exp !== 'number' || p.exp <= atSec) return null;
    return { player: getAddress(p.sub), kind: p.kind === 'wallet' ? 'wallet' : 'guest', iat: Number(p.iat ?? 0), exp: p.exp };
  } catch {
    return null;
  }
}

export interface AuthGuard {
  /** Rejects with SESSION_REQUIRED unless a valid Bearer token is present. */
  required: MiddlewareHandler;
  /** Attaches the session when a valid token is present; never rejects. */
  optional: MiddlewareHandler;
  session(c: Context): SessionClaims | undefined;
  requireSession(c: Context): SessionClaims;
}

export function createAuthGuard(opts: { secret: string; now: () => number }): AuthGuard {
  const sessions = new WeakMap<Request, SessionClaims>();
  const extract = async (c: Context): Promise<SessionClaims | null> => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    return m?.[1] ? verifySession(opts.secret, m[1], nowSec(opts.now())) : null;
  };
  const guard: AuthGuard = {
    required: async (c, next) => {
      const s = await extract(c);
      if (!s) throw new ApiError('SESSION_REQUIRED', 'a valid session token is required');
      sessions.set(c.req.raw, s);
      await next();
    },
    optional: async (c, next) => {
      const s = await extract(c);
      if (s) sessions.set(c.req.raw, s);
      await next();
    },
    session: (c) => sessions.get(c.req.raw),
    requireSession: (c) => {
      const s = sessions.get(c.req.raw);
      if (!s) throw new ApiError('SESSION_REQUIRED', 'a valid session token is required');
      return s;
    },
  };
  return guard;
}
