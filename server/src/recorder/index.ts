// Recorder module entry: `startRecorder(deps)` records the seconds of open rounds and settles them.

import type { Address } from 'viem';
import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { PriceHub } from '../ports.ts';
import type { ChainRoundBook } from '../indexer/roundBook.ts';
import type { ProofArchive } from '../pricehub/hub.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { createLogger, type Logger } from '../relayer/log.ts';
import type { ChainTxSender } from '../relayer/sender.ts';
import { Recorder, type RecorderIndexerView } from './recorder.ts';

export { Recorder, PRIORITY, SETTLE_GAS_PER_ROUND, type RecorderMetrics, type RecorderIndexerView } from './recorder.ts';
export * from './abi.ts';

export interface RecorderDeps {
  config: Pick<Config, 'ARENA_ADDRESS'>;
  hub: PriceHub & { proofFor?(pairId: number, sec: number): { proof: `0x${string}`; proofHash: `0x${string}` } | undefined; archive?: ProofArchive };
  archive?: ProofArchive;
  roundBook: ChainRoundBook;
  /** The recorder-key sender. */
  sender: ChainTxSender;
  chain: ChainIo;
  indexer?: RecorderIndexerView;
  bus: Bus;
  log?: Logger;
}

export function createRecorder(deps: RecorderDeps): Recorder {
  if (!deps.config.ARENA_ADDRESS) throw new Error('recorder: ARENA_ADDRESS is required');
  const archive = deps.archive ?? deps.hub.archive;
  if (!archive) throw new Error('recorder: a proof archive is required');
  if (deps.sender.key !== 'recorder') throw new Error('recorder: pass the recorder-key sender');
  return new Recorder({
    arena: deps.config.ARENA_ADDRESS as Address,
    hub: deps.hub,
    archive,
    roundBook: deps.roundBook,
    sender: deps.sender,
    chain: deps.chain,
    indexer: deps.indexer,
    bus: deps.bus,
    log: deps.log ?? createLogger('recorder'),
  });
}

export async function startRecorder(deps: RecorderDeps): Promise<Recorder> {
  const r = createRecorder(deps);
  await r.start();
  return r;
}
