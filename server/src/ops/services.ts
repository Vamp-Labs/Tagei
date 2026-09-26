// One-call wiring of every A3 module for A0 (leader-only process):
//   const chainSvc = await startChainServices({ config, bus, db: db?.db, progression });
// Modules that lack configuration are skipped (no ARENA_ADDRESS → hub + market only;
// no key → that sender and its jobs are skipped).

import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { ProgressionService, ReadinessCheck } from '../ports.ts';
import { indexerReadinessCheck, startIndexer } from '../indexer/index.ts';
import type { ChainIndexer } from '../indexer/indexer.ts';
import { startMarket, type MarketData } from '../market/index.ts';
import { priceHubReadinessCheck, startPriceHub } from '../pricehub/index.ts';
import type { SupraPriceHub } from '../pricehub/hub.ts';
import { startRecorder } from '../recorder/index.ts';
import type { Recorder } from '../recorder/recorder.ts';
import { createChainIoFromConfig, startSenders, type ChainIo, type Senders } from '../relayer/index.ts';
import { createLogger, type LogLevel } from '../relayer/log.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';
import { startOps, type Ops } from './index.ts';

export interface ChainServicesDeps {
  config: Config;
  bus: Bus;
  db?: AnyPgDb;
  progression?: ProgressionService;
}

export interface ChainServices {
  chain: ChainIo;
  market: MarketData;
  hub: SupraPriceHub;
  senders?: Senders;
  indexer?: ChainIndexer;
  recorder?: Recorder;
  ops?: Ops;
  checks: ReadinessCheck[];
  stop(): Promise<void>;
}

export async function startChainServices(deps: ChainServicesDeps): Promise<ChainServices> {
  const c = deps.config;
  const level = c.LOG_LEVEL as LogLevel;
  const log = (s: string) => createLogger(s, level);
  const chain = createChainIoFromConfig(c, log('chain'));
  await chain.heads.start();
  const market = await startMarket({ baseUrl: c.BINANCE_DATA_URL, log: log('market') });
  const hub = await startPriceHub({ config: c, bus: deps.bus, db: deps.db, market, log: log('pricehub') });
  const checks: ReadinessCheck[] = [priceHubReadinessCheck(hub)];
  const out: ChainServices = { chain, market, hub, checks, stop: async () => {} };
  if (c.ARENA_ADDRESS) {
    const senders = await startSenders({ config: c, chain, bus: deps.bus, db: deps.db, log: log('sender') });
    checks.push(...senders.checks());
    const indexer = await startIndexer({ config: c, chain, bus: deps.bus, db: deps.db, receipts: senders, progression: deps.progression, log: log('indexer') });
    checks.push(indexerReadinessCheck(indexer));
    const recorder = senders.recorder
      ? await startRecorder({ config: c, hub, roundBook: indexer.roundBook, sender: senders.recorder, chain, indexer, bus: deps.bus, log: log('recorder') })
      : undefined;
    const ops = senders.ops
      ? await startOps({ config: c, chain, sender: senders.ops, roundBook: indexer.roundBook, hub, db: deps.db, log: log('ops'), supraMonitor: c.CHAIN_ID === 97 })
      : undefined;
    if (ops?.supra) checks.push(ops.supra.readiness());
    Object.assign(out, { senders, indexer, recorder, ops });
  }
  out.stop = async () => {
    await out.ops?.stop();
    await out.recorder?.stop();
    await out.indexer?.stop();
    await out.senders?.stop();
    await hub.stop();
    await market.stop();
    await chain.close();
  };
  return out;
}
