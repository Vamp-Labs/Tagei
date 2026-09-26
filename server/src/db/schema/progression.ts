// A4 — progression (F1d). `xp_ledger` is the idempotency anchor: one row per
// (player, round, reason). Per-round awards use the round id; daily and lifetime
// awards (streak, missions, badges) use round 0 with a dated or unique reason,
// e.g. `streak:2026-09-26`, `mission:fly_3:2026-09-26`, `badge:first_orbit`.
// Days are UTC `YYYY-MM-DD` strings.

import type { RoundDTO } from '@bnbplay/shared/dto';
import { bigint, bigserial, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const uint256 = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const xpLedger = pgTable(
  'xp_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    player: text('player').notNull(),
    roundId: uint256('round_id').notNull().default('0'),
    reason: text('reason').notNull(),
    amount: integer('amount').notNull(),
    day: text('day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('xp_ledger_player_round_reason_uq').on(t.player, t.roundId, t.reason),
    index('xp_ledger_day_idx').on(t.day),
    index('xp_ledger_player_idx').on(t.player),
  ],
);

/** One row per finalized live round: the processing guard plus the facts behind stats and history. */
export const progressionRounds = pgTable(
  'progression_rounds',
  {
    roundId: uint256('round_id').primaryKey(),
    player: text('player').notNull(),
    assetId: integer('asset_id').notNull(),
    tier: integer('tier').notNull(),
    direction: text('direction').$type<'LONG' | 'SHORT'>().notNull(),
    outcome: text('outcome').notNull(),
    stake: uint256('stake').notNull(),
    payout: uint256('payout').notNull(),
    /** payout / stake in bps (20000 = 2.0x). */
    payoutXBps: integer('payout_x_bps').notNull(),
    disciplined: boolean('disciplined').notNull(),
    day: text('day').notNull(),
    /** Live rounds the player had already finalized that UTC day (drives dailyXpFactor). */
    dayIndex: integer('day_index').notNull().default(0),
    settledAtMs: bigint('settled_at_ms', { mode: 'number' }).notNull(),
    xp: integer('xp').notNull().default(0),
    round: jsonb('round').$type<RoundDTO>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('progression_rounds_player_idx').on(t.player, t.roundId)],
);

export const playerProgress = pgTable(
  'player_progress',
  {
    player: text('player').primaryKey(),
    xp: integer('xp').notNull().default(0),
    streakDays: integer('streak_days').notNull().default(0),
    lastActiveDay: text('last_active_day'),
    rounds: integer('rounds').notNull().default(0),
    targetHits: integer('target_hits').notNull().default(0),
    disciplinedExits: integer('disciplined_exits').notNull().default(0),
    bestPayoutXBps: integer('best_payout_x_bps').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('player_progress_xp_idx').on(t.xp)],
);

/** Daily counters: live rounds (diminishing returns + fly_3), directions bitmask (bit0 LONG, bit1 SHORT), debrief reviews. */
export const playerDays = pgTable(
  'player_days',
  {
    player: text('player').notNull(),
    day: text('day').notNull(),
    rounds: integer('rounds').notNull().default(0),
    directions: integer('directions').notNull().default(0),
    reviews: integer('reviews').notNull().default(0),
    missionsCompleted: jsonb('missions_completed').$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.player, t.day] })],
);

export const playerBadges = pgTable(
  'player_badges',
  {
    player: text('player').notNull(),
    badgeId: text('badge_id').notNull(),
    roundId: uint256('round_id'),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.player, t.badgeId] })],
);

/** The owner opened the PIX debrief; credited once the round is finalized (Learning +5, review mission). */
export const debriefReviews = pgTable(
  'debrief_reviews',
  {
    player: text('player').notNull(),
    roundId: uint256('round_id').notNull(),
    reviewedAtMs: bigint('reviewed_at_ms', { mode: 'number' }).notNull(),
    credited: boolean('credited').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.player, t.roundId] })],
);
