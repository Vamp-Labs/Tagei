// Transaction log for the three hot keys (relayer, recorder, ops). One row per TxJob;
// `tx_hashes` keeps every replace-by-fee attempt, `tx_hash` the one that was mined.

import { sql } from 'drizzle-orm';
import { bigint, index, integer, numeric, pgTable, text } from 'drizzle-orm/pg-core';

export const relayerTxs = pgTable(
  'relayer_txs',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    selector: text('selector').notNull(),
    dataHash: text('data_hash').notNull(),
    /** Full calldata, except for checkpoint kinds whose proof bytes already live in oracle_proofs. */
    data: text('data'),
    priority: integer('priority').notNull(),
    roundId: numeric('round_id', { precision: 78, scale: 0 }),
    intentId: text('intent_id'),
    /** queued | preparing | signing | submitted | confirmed | failed */
    status: text('status').notNull(),
    nonce: bigint('nonce', { mode: 'number' }),
    gasLimit: bigint('gas_limit', { mode: 'number' }),
    gasPriceWei: numeric('gas_price_wei', { precision: 78, scale: 0 }),
    txHash: text('tx_hash'),
    txHashes: text('tx_hashes').array().notNull().default(sql`'{}'::text[]`),
    attempts: integer('attempts').notNull().default(0),
    blockNumber: bigint('block_number', { mode: 'number' }),
    gasUsed: bigint('gas_used', { mode: 'number' }),
    error: text('error'),
    errorCode: text('error_code'),
    createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
    updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
    submittedAtMs: bigint('submitted_at_ms', { mode: 'number' }),
    confirmedAtMs: bigint('confirmed_at_ms', { mode: 'number' }),
  },
  (t) => [
    index('relayer_txs_key_status_idx').on(t.key, t.status),
    index('relayer_txs_round_idx').on(t.roundId),
    index('relayer_txs_intent_idx').on(t.intentId),
    index('relayer_txs_created_idx').on(t.createdAtMs),
  ],
);
