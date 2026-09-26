import { EventEmitter } from 'node:events';
import type { Address, Hex } from 'viem';
import type { SseEventName, SsePayload } from '@bnbplay/shared/sse';
import type { OracleRound, OracleStatus, TxKind, TxStep } from './ports.ts';

export interface BusEvents {
  'oracle.round': OracleRound;
  'oracle.status': { status: OracleStatus };
  'tx.step': { id: string; kind: TxKind; step: TxStep; roundId?: bigint; intentId?: string; txHash?: Hex; error?: string };
  'chain.event': { name: string; args: Record<string, unknown>; txHash: Hex; logIndex: number; blockNumber: bigint; finalized: boolean };
  /** A player-facing SSE event; the SSE hub persists and fans it out. */
  'player.event': { [E in SseEventName]: { player: Address; event: E; payload: SsePayload<E> } }[SseEventName];
  /** A public SSE event (prices, stats, oracle status) broadcast to every client. */
  'public.event': { [E in SseEventName]: { event: E; payload: SsePayload<E> } }[SseEventName];
}

export class Bus {
  private readonly ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(100);
  }

  on<K extends keyof BusEvents>(topic: K, fn: (payload: BusEvents[K]) => void): () => void {
    this.ee.on(topic, fn);
    return () => this.ee.off(topic, fn);
  }

  emit<K extends keyof BusEvents>(topic: K, payload: BusEvents[K]): void {
    this.ee.emit(topic, payload);
  }
}
