// Chain indexer state: decoded logs (upserted on (tx_hash, log_index)), the block
// hashes used for reorg detection, and the indexer cursor.

import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

export const chainEvents = pgTable(
  'chain_events',
  {
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockHash: text('block_hash').notNull(),
    /** Lowercase emitting contract. */
    address: text('address').notNull(),
    /** Event name from the ABI, or `unknown`. */
    name: text('name').notNull(),
    /** Decoded args; bigints as decimal strings. */
    args: jsonb('args').notNull(),
    finalized: boolean('finalized').notNull().default(false),
    /** logs (getLogs sweep) | receipt (fed by a sender receipt before the sweep) */
    source: text('source').notNull(),
    createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index('chain_events_block_idx').on(t.blockNumber),
    index('chain_events_name_idx').on(t.name, t.blockNumber),
    index('chain_events_unfinalized_idx').on(t.finalized, t.blockNumber),
  ],
);

/** Hashes of indexed blocks above the finalized height (pruned below it). */
export const chainBlocks = pgTable('chain_blocks', {
  number: bigint('number', { mode: 'number' }).primaryKey(),
  hash: text('hash').notNull(),
  parentHash: text('parent_hash').notNull(),
  timestampSec: bigint('timestamp_sec', { mode: 'number' }).notNull(),
});

export const indexerState = pgTable('indexer_state', {
  id: text('id').primaryKey(),
  blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
  blockHash: text('block_hash').notNull(),
  finalizedBlock: bigint('finalized_block', { mode: 'number' }),
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
});
