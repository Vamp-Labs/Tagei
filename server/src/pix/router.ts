import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { AssetSymbolSchema, DebriefSchema, MarketInsightSchema, UintString } from '@bnbplay/shared/dto';
import type { AuthGuard } from '../auth/jwt.ts';
import { ApiError } from '../api/errors.ts';
import { parseWith, readJson, readQuery, sendJson } from '../api/http.ts';
import type { Logger } from '../api/log.ts';
import { RateLimiter } from '../api/rate-limit.ts';
import type { PixServiceImpl } from './service.ts';

const InsightQuery = z.object({
  asset: AssetSymbolSchema,
  tier: z.string().regex(/^[0-3]$/).transform(Number).optional(),
});

export const ChatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(600) }))
    .min(1)
    .max(12)
    .refine((m) => m[m.length - 1]?.role === 'user', 'the last message must be from the user'),
  asset: AssetSymbolSchema.optional(),
});

/** Chat stream events (POST /v1/pix/chat); requested as an addition to shared sse.ts. */
export const PIX_CHAT_EVENTS = {
  'pix.delta': z.object({ text: z.string() }),
  'pix.done': z.object({
    usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }).nullable(),
    source: z.enum(['llm', 'template']),
  }),
  'pix.error': z.object({ code: z.string(), message: z.string() }),
} as const;

/** Mounted at `/pix`. */
export function createPixRouter(deps: {
  service: PixServiceImpl;
  guard: AuthGuard;
  ipHashOf: (c: Context) => string;
  onDebriefReviewed?: (player: `0x${string}`, roundId: bigint) => Promise<void>;
  log: Logger;
  now?: () => number;
}): Hono {
  const r = new Hono();
  const insightLimiter = new RateLimiter({ limit: 30, windowMs: 60_000, now: deps.now });

  r.get('/insight', async (c) => {
    insightLimiter.consume(deps.ipHashOf(c), 'too many insight requests');
    const q = readQuery(c, InsightQuery);
    return sendJson(c, MarketInsightSchema, await deps.service.insight(q.asset, q.tier));
  });

  r.get('/debrief/:roundId', deps.guard.optional, async (c) => {
    const roundId = BigInt(parseWith(UintString, c.req.param('roundId'), 'roundId'));
    const debrief = await deps.service.debrief(roundId);
    const session = deps.guard.session(c);
    if (session && deps.onDebriefReviewed) {
      // The owner's JWT marks the debrief reviewed (Learning XP); ownership is checked there.
      await deps.onDebriefReviewed(session.player, roundId).catch((err: unknown) =>
        deps.log.warn('debrief review credit failed', { roundId: roundId.toString(), err: String(err) }),
      );
    }
    return sendJson(c, DebriefSchema, debrief);
  });

  r.post('/chat', deps.guard.required, async (c) => {
    const session = deps.guard.requireSession(c);
    const body = await readJson(c, ChatRequestSchema);
    const chat = await deps.service.chatSession(session.player, body.messages, body.asset); // PIX_QUOTA → JSON 429
    c.header('X-Accel-Buffering', 'no');
    const res = streamSSE(c, async (stream) => {
      try {
        for await (const text of chat.chunks) {
          if (stream.aborted) break;
          await stream.writeSSE({ event: 'pix.delta', data: JSON.stringify({ text }) });
        }
        await stream.writeSSE({ event: 'pix.done', data: JSON.stringify({ usage: chat.result.usage, source: chat.result.source }) });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : 'INTERNAL';
        deps.log.warn('pix chat failed', { err: String(err) });
        await stream.writeSSE({ event: 'pix.error', data: JSON.stringify({ code, message: 'PIX is unavailable right now.' }) });
      }
    });
    res.headers.set('Cache-Control', 'no-cache, no-transform');
    return res;
  });

  return r;
}
