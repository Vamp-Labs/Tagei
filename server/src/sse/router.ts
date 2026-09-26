import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getAddress } from 'viem';
import { z } from 'zod';
import { AddressString } from '@bnbplay/shared/dto';
import { readQuery } from '../api/http.ts';
import type { SseHub } from './hub.ts';

const StreamQuery = z.object({
  player: AddressString.optional(),
  /** EventSource cannot set headers on the first connect; clients may pass the id here. */
  lastEventId: z.string().regex(/^\d+$/).optional(),
});

/** Mounted at the v1 root: GET /stream?player=0x…[&lastEventId=n]. */
export function createStreamRouter(deps: { hub: SseHub; ipHashOf: (c: Context) => string }): Hono {
  const r = new Hono();
  r.get('/stream', (c) => {
    const q = readQuery(c, StreamQuery);
    const header = c.req.header('last-event-id');
    const raw = header && /^\d+$/.test(header.trim()) ? header.trim() : q.lastEventId;
    const lastEventId = raw !== undefined ? Number(raw) : null;
    const slot = deps.hub.reserve(deps.ipHashOf(c));
    c.header('X-Accel-Buffering', 'no');
    const res = streamSSE(c, (stream) =>
      deps.hub.serve(stream, { player: q.player ? getAddress(q.player) : null, lastEventId, slot }),
    );
    res.headers.set('Cache-Control', 'no-cache, no-transform');
    return res;
  });
  return r;
}
