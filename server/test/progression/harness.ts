// Test harness for ProgressionServiceImpl over any ProgressionStore.
import type { Address } from 'viem';
import { SSE_EVENTS, type SsePayload } from '@bnbplay/shared/sse';
import { Bus } from '../../src/bus.ts';
import { ProgressionServiceImpl } from '../../src/progression/service.ts';
import { createMemoryProgressionStore, type ProgressionStore } from '../../src/progression/store.ts';
import { FakeRoundBook, roundDto, type RoundSpec } from '../api/helpers.ts';

export type Updated = SsePayload<'progression.updated'>;
export const DAY1 = Date.UTC(2026, 8, 21, 10); // Monday

export function progressionHarness(store: ProgressionStore = createMemoryProgressionStore()) {
  const clock = { t: DAY1 };
  const bus = new Bus();
  const book = new FakeRoundBook();
  const updates: Updated[] = [];
  bus.on('player.event', (e) => {
    if (e.event === 'progression.updated') updates.push(SSE_EVENTS['progression.updated'].parse(e.payload));
  });
  const svc = new ProgressionServiceImpl({ store, roundBook: book, bus, now: () => clock.t, dtoRetry: { attempts: 1, delayMs: 0 } });
  let nextId = 1n;
  /** Settles a round at the current clock and finalizes it. */
  const play = async (player: Address, spec: Partial<RoundSpec> = {}) => {
    const entrySec = Math.floor(clock.t / 1000) - 40;
    const dto = roundDto({ roundId: nextId++, player, entrySec, settledAtMs: clock.t, ...spec });
    book.put(dto);
    await svc.onRoundFinalized(BigInt(dto.roundId));
    return BigInt(dto.roundId);
  };
  return { clock, bus, book, svc, updates, play, last: () => updates[updates.length - 1] as Updated };
}

