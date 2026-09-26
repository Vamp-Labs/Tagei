// relayer_txs writer. Updates are coalesced per job id and flushed in small batches so
// the send path never waits on Postgres.

import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { relayerTxs } from '../db/schema/relayer.ts';
import { errorMessage, silentLogger, type Logger } from './log.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDb = PgDatabase<any, any, any>;

export type TxLogRow = typeof relayerTxs.$inferInsert;

export interface TxLog {
  write(row: TxLogRow): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export const noopTxLog: TxLog = { write: () => {}, flush: async () => {}, stop: async () => {} };

export class PgTxLog implements TxLog {
  private pending = new Map<string, TxLogRow>();
  private timer: NodeJS.Timeout;
  private flushing: Promise<void> | undefined;

  constructor(
    private readonly db: AnyPgDb,
    private readonly log: Logger = silentLogger,
    flushMs = 250,
  ) {
    this.timer = setInterval(() => void this.flush(), flushMs);
    this.timer.unref?.();
  }

  write(row: TxLogRow): void {
    const prev = this.pending.get(row.id);
    this.pending.set(row.id, prev ? { ...prev, ...row } : row);
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.pending.size === 0) return;
    const rows = [...this.pending.values()];
    this.pending = new Map();
    this.flushing = (async () => {
      try {
        await this.db
          .insert(relayerTxs)
          .values(rows)
          .onConflictDoUpdate({
            target: relayerTxs.id,
            set: {
              status: sql`excluded.status`,
              nonce: sql`coalesce(excluded.nonce, ${relayerTxs.nonce})`,
              gasLimit: sql`coalesce(excluded.gas_limit, ${relayerTxs.gasLimit})`,
              gasPriceWei: sql`coalesce(excluded.gas_price_wei, ${relayerTxs.gasPriceWei})`,
              txHash: sql`coalesce(excluded.tx_hash, ${relayerTxs.txHash})`,
              txHashes: sql`case when cardinality(excluded.tx_hashes) > 0 then excluded.tx_hashes else ${relayerTxs.txHashes} end`,
              attempts: sql`greatest(excluded.attempts, ${relayerTxs.attempts})`,
              blockNumber: sql`coalesce(excluded.block_number, ${relayerTxs.blockNumber})`,
              gasUsed: sql`coalesce(excluded.gas_used, ${relayerTxs.gasUsed})`,
              error: sql`coalesce(excluded.error, ${relayerTxs.error})`,
              errorCode: sql`coalesce(excluded.error_code, ${relayerTxs.errorCode})`,
              updatedAtMs: sql`excluded.updated_at_ms`,
              submittedAtMs: sql`coalesce(${relayerTxs.submittedAtMs}, excluded.submitted_at_ms)`,
              confirmedAtMs: sql`coalesce(excluded.confirmed_at_ms, ${relayerTxs.confirmedAtMs})`,
            },
          });
      } catch (err) {
        this.log.warn('relayer_txs flush failed; re-queued', { rows: rows.length, error: errorMessage(err) });
        for (const r of rows) if (!this.pending.has(r.id)) this.pending.set(r.id, r);
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
