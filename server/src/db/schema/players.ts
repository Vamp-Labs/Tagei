// A4 — players and the single-use EIP-712 login challenges (F1b §Auth).
// Addresses are stored lowercase; DTOs return the checksummed form.

import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  address: text('address').primaryKey(),
  kind: text('kind').$type<'guest' | 'wallet'>().notNull(),
  displayName: text('display_name').notNull(),
  sessions: integer('sessions').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSessionAt: timestamp('last_session_at', { withTimezone: true }),
});

export const authChallenges = pgTable(
  'auth_challenges',
  {
    salt: text('salt').primaryKey(),
    address: text('address').notNull(),
    /** Unix seconds; echoed verbatim in the signed `Login` message. */
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_challenges_expires_idx').on(t.expiresAt)],
);
