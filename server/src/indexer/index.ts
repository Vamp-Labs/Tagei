// Indexer module entry: `startIndexer(deps)` → the indexer, whose `roundBook` implements RoundBook.

import type { Address } from 'viem';
import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { ProgressionService, ReadinessCheck } from '../ports.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { createLogger, type Logger } from '../relayer/log.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';
import { ChainIndexer, type ReceiptSource } from './indexer.ts';
import { MemoryIndexerStore, PgIndexerStore } from './store.ts';

export { ChainIndexer, stallDeadline, type CheckpointInfo, type ReceiptSource } from './indexer.ts';
export { ChainRoundBook, type RoundChange } from './roundBook.ts';
export { MemoryIndexerStore, PgIndexerStore, roundFromRow, type IndexerStore } from './store.ts';
export { roundToDTO, type ChainRound, type StoredEvent } from './types.ts';

export type IndexerConfig = Pick<Config, 'ARENA_ADDRESS' | 'CHECKPOINT_ORACLE_ADDRESS' | 'FAUCET_ADDRESS' | 'ARENA_DEPLOY_BLOCK' | 'INDEXER_POLL_MS'>;

export interface IndexerDeps {
  config: IndexerConfig;
  chain: ChainIo;
  bus?: Bus;
  db?: AnyPgDb;
  log?: Logger;
  receipts?: ReceiptSource;
  progression?: ProgressionService;
}

export function createIndexer(deps: IndexerDeps): ChainIndexer {
  const c = deps.config;
  if (!c.ARENA_ADDRESS) throw new Error('indexer: ARENA_ADDRESS is required');
  return new ChainIndexer({
    chain: deps.chain,
    arena: c.ARENA_ADDRESS as Address,
    oracles: c.CHECKPOINT_ORACLE_ADDRESS ? [c.CHECKPOINT_ORACLE_ADDRESS as Address] : [],
    faucet: c.FAUCET_ADDRESS as Address | undefined,
    startBlock: c.ARENA_DEPLOY_BLOCK !== undefined ? BigInt(c.ARENA_DEPLOY_BLOCK) : undefined,
    pollMs: c.INDEXER_POLL_MS,
    bus: deps.bus,
    store: deps.db ? new PgIndexerStore(deps.db) : new MemoryIndexerStore(),
    log: deps.log ?? createLogger('indexer'),
    receipts: deps.receipts,
    progression: deps.progression,
  });
}

export async function startIndexer(deps: IndexerDeps): Promise<ChainIndexer> {
  const ix = createIndexer(deps);
  await ix.start();
  return ix;
}

/** `indexer` readiness: fails when the sweep lags > maxLagBlocks or has not ticked for 30 s. */
export function indexerReadinessCheck(ix: ChainIndexer, maxLagBlocks = 60): ReadinessCheck {
  return {
    name: 'indexer',
    check: async () => {
      const s = ix.status();
      const ok = s.lagBlocks !== null && s.lagBlocks <= maxLagBlocks && Date.now() - s.lastTickMs < 30_000;
      return { ok, detail: s };
    },
  };
}
