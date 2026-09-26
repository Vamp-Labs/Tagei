// Persisted player events (`player_events`, 1 h retention). The row id is the SSE
// event id; replay returns everything after Last-Event-ID in id order.

import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { SseEventName } from '@bnbplay/shared/sse';
import { playerEvents } from '../db/schema/events.ts';

export interface StoredEvent {
  id: number;
  player: string;
  event: SseEventName;
  payload: unknown;
  createdAtMs: number;
}

export interface PlayerEventStore {
  append(player: string, event: SseEventName, payload: unknown): Promise<{ id: number }>;
  /** Events for `player` with id > afterId, oldest first. */
  since(player: string, afterId: number, limit: number): Promise<StoredEvent[]>;
  latest(player: string, event: SseEventName): Promise<StoredEvent | null>;
  prune(olderThanMs: number): Promise<number>;
}

export function createMemoryEventStore(now: () => number = Date.now): PlayerEventStore {
  const rows: StoredEvent[] = [];
  let nextId = 1;
  return {
    async append(player, event, payload) {
      const row = { id: nextId++, player, event, payload, createdAtMs: now() };
      rows.push(row);
      return { id: row.id };
    },
    async since(player, afterId, limit) {
      return rows.filter((r) => r.player === player && r.id > afterId).slice(0, limit);
    },
    async latest(player, event) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r && r.player === player && r.event === event) return r;
      }
      return null;
    },
    async prune(olderThanMs) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r && r.createdAtMs < olderThanMs) {
          rows.splice(i, 1);
          n++;
        }
      }
      return n;
    },
  };
}

const toStored = (r: typeof playerEvents.$inferSelect): StoredEvent => ({
  id: r.id,
  player: r.player,
  event: r.event as SseEventName,
  payload: r.payload,
  createdAtMs: r.createdAt.getTime(),
});

export function createPgEventStore(sql: Sql): PlayerEventStore {
  const db = drizzle(sql);
  return {
    async append(player, event, payload) {
      const [row] = await db.insert(playerEvents).values({ player, event, payload }).returning({ id: playerEvents.id });
      if (!row) throw new Error('player event insert returned no row');
      return { id: row.id };
    },
    async since(player, afterId, limit) {
      const rows = await db
        .select()
        .from(playerEvents)
        .where(and(eq(playerEvents.player, player), gt(playerEvents.id, afterId)))
        .orderBy(asc(playerEvents.id))
        .limit(limit);
      return rows.map(toStored);
    },
    async latest(player, event) {
      const [r] = await db
        .select()
        .from(playerEvents)
        .where(and(eq(playerEvents.player, player), eq(playerEvents.event, event)))
        .orderBy(desc(playerEvents.id))
        .limit(1);
      return r ? toStored(r) : null;
    },
    async prune(olderThanMs) {
      const rows = await db
        .delete(playerEvents)
        .where(lt(playerEvents.createdAt, new Date(olderThanMs)))
        .returning({ id: playerEvents.id });
      return rows.length;
    },
  };
}
