// Price hub module entry. `startPriceHub` = leader (publishes events); `startArchiver` = the
// redundant capture-only instance (ROLE=archiver, P1) that upserts into the same archive tables.

import { hostname } from 'node:os';
import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { ReadinessCheck } from '../ports.ts';
import { createLogger, type Logger } from '../relayer/log.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';
import { SupraPriceHub, type MarketStats } from './hub.ts';
import { MemoryOracleStore, PgOracleStore } from './store.ts';

export { SupraPriceHub, SecondMissedError, WaitTimeoutError, DEGRADED_AFTER_MS, type ProofArchive, type ProofEvent, type PairStats, type HubMetrics, type MarketStats } from './hub.ts';
export { buildMarketSnapshots, buildPricesSnapshot, type DayStats, type DayStatsSource } from './snapshot.ts';
export { MemoryOracleStore, PgOracleStore, type OracleStore } from './store.ts';
export { bipowerSigmaPpm, backtestTouchRates, momentumPpm, plainSigmaPpm } from './stats.ts';

export type PriceHubConfig = Pick<Config, 'SUPRA_REST_URL' | 'SUPRA_POLL_MS' | 'ORACLE_STALE_MS' | 'ORACLE_PROOF_RETENTION_H' | 'ORACLE_ROUND_RETENTION_D'>;

export interface PriceHubDeps {
  config: PriceHubConfig;
  bus?: Bus;
  db?: AnyPgDb;
  market?: MarketStats;
  log?: Logger;
  role?: 'leader' | 'archiver';
  instanceId?: string;
  fetch?: typeof fetch;
}

export function createPriceHub(deps: PriceHubDeps): SupraPriceHub {
  const log = deps.log ?? createLogger('pricehub');
  const role = deps.role ?? 'leader';
  return new SupraPriceHub({
    restUrl: deps.config.SUPRA_REST_URL,
    pollMs: deps.config.SUPRA_POLL_MS,
    staleMs: deps.config.ORACLE_STALE_MS,
    proofRetentionH: deps.config.ORACLE_PROOF_RETENTION_H,
    roundRetentionD: deps.config.ORACLE_ROUND_RETENTION_D,
    bus: deps.bus,
    store: deps.db ? new PgOracleStore(deps.db, log.child('archive')) : new MemoryOracleStore(),
    market: deps.market,
    log,
    role,
    instanceId: deps.instanceId ?? (role === 'leader' ? 'leader' : `archiver-${hostname()}`),
    fetch: deps.fetch,
  });
}

export async function startPriceHub(deps: PriceHubDeps): Promise<SupraPriceHub> {
  const hub = createPriceHub(deps);
  await hub.start();
  return hub;
}

/** Capture-only instance for another network: archives every proof, publishes nothing. */
export async function startArchiver(deps: Omit<PriceHubDeps, 'role' | 'market'> & { db: AnyPgDb }): Promise<SupraPriceHub> {
  return startPriceHub({ ...deps, role: 'archiver', bus: undefined });
}

/** `oracle` readiness: fails only when the feed is down (> 10 s without a round). */
export function priceHubReadinessCheck(hub: SupraPriceHub): ReadinessCheck {
  return {
    name: 'oracle',
    check: async () => {
      const s = hub.status();
      return { ok: s.status !== 'down', detail: s };
    },
  };
}
