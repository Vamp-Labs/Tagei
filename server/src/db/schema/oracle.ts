// Supra DORA-2 archive (A3 price hub). Rounds live 3 days; proofs live 6 hours unless
// a checkpoint on chain references them (then forever, for third-party verification).
// Both the leader hub and a second archiver instance upsert into these tables.

import { bigint, boolean, customType, index, integer, numeric, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const oracleProofs = pgTable(
  'oracle_proofs',
  {
    /** keccak256 of the raw proof bytes, 0x-prefixed lowercase hex. */
    hash: text('hash').primaryKey(),
    /** Round second of the proof's feeds (the smallest one if a proof ever mixes rounds). */
    sec: bigint('sec', { mode: 'number' }).notNull(),
    proof: bytea('proof').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    firstSeenMs: bigint('first_seen_ms', { mode: 'number' }).notNull(),
    /** Instance that captured it first (`leader`, `archiver-<host>`, …). */
    source: text('source').notNull(),
    /** Set once a checkpoint transaction that carried this proof confirmed. */
    referenced: boolean('referenced').notNull().default(false),
    recordedTx: text('recorded_tx'),
  },
  (t) => [index('oracle_proofs_sec_idx').on(t.sec), index('oracle_proofs_prune_idx').on(t.referenced, t.firstSeenMs)],
);

export const oracleRounds = pgTable(
  'oracle_rounds',
  {
    pairId: integer('pair_id').notNull(),
    sec: bigint('sec', { mode: 'number' }).notNull(),
    roundMs: bigint('round_ms', { mode: 'number' }).notNull(),
    tsMs: bigint('ts_ms', { mode: 'number' }).notNull(),
    price18: numeric('price18', { precision: 78, scale: 0, mode: 'bigint' }).notNull(),
    proofHash: text('proof_hash').notNull(),
    receivedAtMs: bigint('received_at_ms', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.pairId, t.sec] }), index('oracle_rounds_sec_idx').on(t.sec)],
);
