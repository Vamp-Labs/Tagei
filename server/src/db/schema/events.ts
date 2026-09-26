// A4 — persisted player SSE events. The bigserial id is the SSE event id used for
// Last-Event-ID replay; rows are pruned after one hour (F1b §SSE).

import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const playerEvents = pgTable(
  'player_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    player: text('player').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('player_events_player_id_idx').on(t.player, t.id), index('player_events_created_idx').on(t.createdAt)],
);
