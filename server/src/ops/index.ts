// Ops module entry: faucet drips, the voidStale watchdog, adaptive lanes and the Supra monitor,
// all on the ops key. `startOps(deps)` starts every job whose prerequisites are configured.

import type { Address, Hex } from 'viem';
import type { Config } from '../config.ts';
import type { ChainRoundBook } from '../indexer/roundBook.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { createLogger, type Logger } from '../relayer/log.ts';
import type { ChainTxSender } from '../relayer/sender.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';
import { FaucetDripper } from './faucet.ts';
import { AdaptiveLanes, MemoryLaneChangeStore, PgLaneChangeStore, type SigmaSource } from './lanes.ts';
import { SupraMonitor } from './supraMonitor.ts';
import { VoidWatchdog } from './watchdog.ts';

export { FaucetDripper } from './faucet.ts';
export { AdaptiveLanes, BASE_LANES, computeLaneUpdate, MemoryLaneChangeStore, PgLaneChangeStore, type LaneDecision, type AssetEvaluation } from './lanes.ts';
export { SupraMonitor, type SupraAlert } from './supraMonitor.ts';
export { VoidWatchdog } from './watchdog.ts';

export type OpsConfig = Pick<Config, 'ARENA_ADDRESS' | 'FAUCET_ADDRESS' | 'FAUCET_AMOUNT_USD' | 'ADAPTIVE_LANES_ENABLED' | 'ADAPTIVE_LANES_INTERVAL_MIN'>;

export interface OpsDeps {
  config: OpsConfig;
  chain: ChainIo;
  /** The ops-key sender (faucet, voidStale, setLane). */
  sender: ChainTxSender;
  roundBook: ChainRoundBook;
  hub: SigmaSource & { latest(pairId: number): { sec: number } | undefined; proofForSecond(sec: number): { proof: Hex } | undefined };
  db?: AnyPgDb;
  log?: Logger;
  /** Start the Supra monitor (reads chain 97 only; off on anvil). */
  supraMonitor?: boolean;
}

export interface Ops {
  faucet?: FaucetDripper;
  watchdog: VoidWatchdog;
  lanes: AdaptiveLanes;
  supra?: SupraMonitor;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createOps(deps: OpsDeps): Ops {
  const c = deps.config;
  if (!c.ARENA_ADDRESS) throw new Error('ops: ARENA_ADDRESS is required');
  if (deps.sender.key !== 'ops') throw new Error('ops: pass the ops-key sender');
  const log = deps.log ?? createLogger('ops');
  const arena = c.ARENA_ADDRESS as Address;
  const faucet = c.FAUCET_ADDRESS ? new FaucetDripper(c.FAUCET_ADDRESS as Address, deps.sender, c.FAUCET_AMOUNT_USD) : undefined;
  const watchdog = new VoidWatchdog({ arena, roundBook: deps.roundBook, sender: deps.sender, chain: deps.chain, log: log.child('watchdog') });
  const lanes = new AdaptiveLanes({
    arena,
    hub: deps.hub,
    sender: deps.sender,
    chain: deps.chain,
    store: deps.db ? new PgLaneChangeStore(deps.db) : new MemoryLaneChangeStore(),
    enabled: () => c.ADAPTIVE_LANES_ENABLED,
    intervalMin: c.ADAPTIVE_LANES_INTERVAL_MIN,
    log: log.child('lanes'),
  });
  const supra = deps.supraMonitor
    ? new SupraMonitor({
        chain: deps.chain,
        latestProof: () => {
          const s = deps.hub.latest(49)?.sec;
          return s === undefined ? undefined : deps.hub.proofForSecond(s)?.proof;
        },
        log: log.child('supra'),
      })
    : undefined;
  return {
    faucet,
    watchdog,
    lanes,
    supra,
    start: async () => {
      watchdog.start();
      lanes.start();
      supra?.start();
    },
    stop: async () => {
      watchdog.stop();
      lanes.stop();
      supra?.stop();
    },
  };
}

export async function startOps(deps: OpsDeps): Promise<Ops> {
  const ops = createOps(deps);
  await ops.start();
  return ops;
}
