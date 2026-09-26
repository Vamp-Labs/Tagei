import { Hono, type Context } from 'hono';
import {
  AuthChallengeRequestSchema,
  AuthChallengeResponseSchema,
  AuthSessionRequestSchema,
  AuthSessionResponseSchema,
} from '@bnbplay/shared/dto';
import { readJson, sendJson } from '../api/http.ts';
import type { AuthService } from './service.ts';

/** Mounted at `/auth`: POST /challenge, POST /session. */
export function createAuthRouter(deps: { service: AuthService; ipHashOf: (c: Context) => string }): Hono {
  const r = new Hono();
  r.post('/challenge', async (c) => {
    const body = await readJson(c, AuthChallengeRequestSchema);
    return sendJson(c, AuthChallengeResponseSchema, await deps.service.challenge(body.address));
  });
  r.post('/session', async (c) => {
    const body = await readJson(c, AuthSessionRequestSchema);
    return sendJson(c, AuthSessionResponseSchema, await deps.service.session(body, deps.ipHashOf(c)));
  });
  return r;
}
