import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AuthGuard } from '../auth/jwt.ts';
import { parseWith, sendJson } from '../api/http.ts';
import type { FaucetService } from './service.ts';

const ClaimBody = z.object({ turnstileToken: z.string().max(4096).optional() });
export const FaucetClaimResponseSchema = z.object({ claimId: z.string() });

/** Mounted at `/faucet`: POST /claim (JWT) → 202 { claimId } or FAUCET_COOLDOWN. */
export function createFaucetRouter(deps: { service: FaucetService; guard: AuthGuard; ipHashOf: (c: Context) => string }): Hono {
  const r = new Hono();
  r.post('/claim', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    const raw = await c.req.json().catch(() => ({}));
    const body = parseWith(ClaimBody, raw ?? {}, 'body');
    const out = await deps.service.claim(session.player, { ipHash: deps.ipHashOf(c), turnstileToken: body.turnstileToken });
    return sendJson(c, FaucetClaimResponseSchema, out, 202);
  });
  return r;
}
