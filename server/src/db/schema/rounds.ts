// Round projection maintained by the indexer from Arena events (RoundOpened,
// CashOutRequested, RoundSettled), plus the adaptive-lane audit (F1e).
// Enum columns hold the Solidity numeric values from packages/shared/src/enums.ts.

import { bigint, boolean, doublePrecision, index, integer, numeric, pgTable, smallint, text } from 'drizzle-orm/pg-core';

const uint = (name: string) => numeric(name, { precision: 78, scale: 0, mode: 'bigint' });

export const rounds = pgTable(
  'rounds',
  {
    roundId: uint('round_id').primaryKey(),
    /** Lowercase 0x address. */
    player: text('player').notNull(),
    assetId: smallint('asset_id').notNull(),
    pairId: integer('pair_id').notNull(),
    tier: smallint('tier').notNull(),
    direction: smallint('direction').notNull(),
    stake: uint('stake').notNull(),
    maxPayout: uint('max_payout').notNull(),
    entrySec: bigint('entry_sec', { mode: 'number' }).notNull(),
    /** Terminal second as opened (the RoundOpened snapshot). */
    endSec: bigint('end_sec', { mode: 'number' }).notNull(),
    /** Set by CashOutRequested; it replaces end_sec for settlement. */
    exitSec: bigint('exit_sec', { mode: 'number' }),
    laneVersion: integer('lane_version').notNull(),
    oracleIdx: smallint('oracle_idx').notNull(),
    targetPpm: integer('target_ppm').notNull(),
    stopPpm: integer('stop_ppm').notNull(),
    multiplierBps: integer('multiplier_bps').notNull(),
    feeBps: integer('fee_bps').notNull(),
    maxJumpPpm: integer('max_jump_ppm').notNull(),
    cashOutRequested: boolean('cash_out_requested').notNull().default(false),
    /** open | settled */
    status: text('status').notNull(),
    outcome: smallint('outcome'),
    voidReason: smallint('void_reason'),
    payout: uint('payout'),
    /** Signed; numeric keeps the sign. */
    pnl: numeric('pnl', { precision: 78, scale: 0, mode: 'bigint' }),
    entryPrice: uint('entry_price'),
    exitPrice: uint('exit_price'),
    decisionSec: bigint('decision_sec', { mode: 'number' }),
    openTx: text('open_tx').notNull(),
    openBlock: bigint('open_block', { mode: 'number' }).notNull(),
    openLogIndex: integer('open_log_index').notNull(),
    cashOutTx: text('cash_out_tx'),
    settleTx: text('settle_tx'),
    settleBlock: bigint('settle_block', { mode: 'number' }),
    openedAtMs: bigint('opened_at_ms', { mode: 'number' }).notNull(),
    settledAtMs: bigint('settled_at_ms', { mode: 'number' }),
    /** The RoundSettled block is at or below the `finalized` tag (progression may award XP). */
    settleFinalized: boolean('settle_finalized').notNull().default(false),
    updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('rounds_player_opened_idx').on(t.player, t.openedAtMs),
    index('rounds_status_idx').on(t.status),
    index('rounds_open_block_idx').on(t.openBlock),
  ],
);

/** One row per adaptive-lane change attempt (F1e "every change is logged"). */
export const laneChanges = pgTable(
  'lane_changes',
  {
    id: text('id').primaryKey(),
    assetId: smallint('asset_id').notNull(),
    tier: smallint('tier').notNull(),
    fromVersion: integer('from_version').notNull(),
    /** Known once LaneConfigured is observed in the receipt. */
    toVersion: integer('to_version'),
    sigmaRecentPpm: doublePrecision('sigma_recent_ppm').notNull(),
    sigmaBasePpm: doublePrecision('sigma_base_ppm').notNull(),
    samples: integer('samples').notNull(),
    k: doublePrecision('k').notNull(),
    kPrev: doublePrecision('k_prev').notNull(),
    targetPpmBefore: integer('target_ppm_before').notNull(),
    stopPpmBefore: integer('stop_ppm_before').notNull(),
    targetPpmAfter: integer('target_ppm_after').notNull(),
    stopPpmAfter: integer('stop_ppm_after').notNull(),
    /** gap' = ceil(0.58·σ_recent), used for the validateLane check. */
    gapMarginPpm: integer('gap_margin_ppm').notNull(),
    /** submitted | confirmed | failed */
    status: text('status').notNull(),
    txId: text('tx_id'),
    txHash: text('tx_hash'),
    error: text('error'),
    createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
    updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
  },
  (t) => [index('lane_changes_asset_tier_idx').on(t.assetId, t.tier, t.createdAtMs)],
);
