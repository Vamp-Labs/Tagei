// A4 — faucet claims (auto-drip on a guest's first session + manual refills).
// Cooldowns and caps (F1b §Rate limits) are evaluated over this table; IPs are
// only ever stored as salted hashes.

import { index, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type FaucetClaimStatus = 'queued' | 'submitted' | 'confirmed' | 'failed';

export const faucetClaims = pgTable(
  'faucet_claims',
  {
    id: text('id').primaryKey(),
    player: text('player').notNull(),
    ipHash: text('ip_hash'),
    /** 18-decimal tUSD. */
    amount: numeric('amount', { precision: 78, scale: 0 }).notNull(),
    source: text('source').$type<'auto' | 'claim'>().notNull(),
    status: text('status').$type<FaucetClaimStatus>().notNull(),
    txHash: text('tx_hash'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('faucet_claims_player_idx').on(t.player, t.createdAt),
    index('faucet_claims_ip_idx').on(t.ipHash, t.createdAt),
    index('faucet_claims_created_idx').on(t.createdAt),
  ],
);
