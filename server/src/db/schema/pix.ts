// A4 — PIX: pre-generated debriefs, LLM usage (daily budget kill-switch) and the
// per-player daily chat quota.

import type { DebriefDTO } from '@bnbplay/shared/dto';
import { bigint, bigserial, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const pixDebriefs = pgTable('pix_debriefs', {
  roundId: numeric('round_id', { precision: 78, scale: 0 }).primaryKey(),
  player: text('player').notNull(),
  debrief: jsonb('debrief').$type<DebriefDTO>().notNull(),
  source: text('source').$type<'llm' | 'template'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    day: text('day').notNull(),
    kind: text('kind').$type<'insight' | 'debrief' | 'chat'>().notNull(),
    model: text('model').notNull(),
    player: text('player'),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    /** Cost in micro-USD ($/MTok × tokens). */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull(),
    /** ok | refusal | timeout | null_parse | parse_error | max_tokens | guardrail | error */
    outcome: text('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_usage_day_idx').on(t.day)],
);

export const pixChatQuota = pgTable(
  'pix_chat_quota',
  {
    player: text('player').notNull(),
    day: text('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.player, t.day] })],
);
