// voidStale watchdog (ops key). An open round whose needed checkpoint is still missing
// STALL_AFTER_SEC after its endSec (or provably never recordable, on non-late oracles) is voided
// so the stake is refunded. previewSettle is the authority; the local path evaluation only
// decides which rounds are worth asking about.

import { encodeFunctionData, type Address } from 'viem';
import { STALL_AFTER_SEC } from '@bnbplay/shared/constants';
import { Outcome } from '@bnbplay/shared/enums';
import type { ChainRoundBook } from '../indexer/roundBook.ts';
import { arenaAbi } from '../recorder/abi.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import type { ChainTxSender } from '../relayer/sender.ts';

export interface WatchdogOptions {
  arena: Address;
  roundBook: ChainRoundBook;
  sender: ChainTxSender;
  chain: ChainIo;
  log?: Logger;
  intervalMs?: number;
  /** Also ask previewSettle about rounds past endSec on oracles without late verification. */
  checkGaps?: boolean;
}

export class VoidWatchdog {
  private timer: NodeJS.Timeout | undefined;
  private readonly inflight = new Set<string>();
  private running = false;
  voided = 0;

  constructor(private readonly o: WatchdogOptions) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const log = this.o.log ?? silentLogger;
    try {
      const now = this.o.chain.heads.nowSec();
      for (const r of this.o.roundBook.open()) {
        const id = r.roundId.toString();
        if (this.inflight.has(id)) continue;
        const stalled = now > r.terms.endSec + STALL_AFTER_SEC;
        if (!stalled && !(this.o.checkGaps && now > r.terms.endSec)) continue;
        let preview: readonly [boolean, number, bigint, number, number];
        try {
          preview = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'previewSettle', args: [r.roundId] });
        } catch (err) {
          log.debug('previewSettle failed', { roundId: id, error: errorMessage(err) });
          continue;
        }
        const [decidable, outcome] = preview;
        if (!decidable) continue;
        if (outcome !== Outcome.Voided) {
          if (stalled) log.warn('stalled round is decidable but unsettled (recorder should settle it)', { roundId: id });
          continue;
        }
        this.inflight.add(id);
        const h = this.o.sender.enqueue({
          key: 'ops',
          kind: 'void',
          to: this.o.arena,
          data: encodeFunctionData({ abi: arenaAbi, functionName: 'voidStale', args: [r.roundId] }),
          roundId: r.roundId,
          priority: 80,
          idempotent: true,
          playerSteps: { kind: 'void', targets: [{ player: r.player, roundId: r.roundId }] },
        });
        log.warn('voiding stale round', { roundId: id, endSec: r.terms.endSec });
        void h.done.then((res) => {
          this.inflight.delete(id);
          if (res.status === 'confirmed') this.voided++;
          else log.warn('voidStale failed', { roundId: id, error: res.error ?? null });
        });
      }
    } finally {
      this.running = false;
    }
  }
}
