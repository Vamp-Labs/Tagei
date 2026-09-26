// Tracks the player intents A4 hands to a TxSender and translates the senders'
// `tx.step` bus events into player-facing `settlement.step` SSE events. Steps for
// A3's own jobs (settle / void) are attributed through the RoundBook.

import type { Address, Hex } from 'viem';
import type { ErrorCode } from '@bnbplay/shared/dto';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { Bus, BusEvents } from '../bus.ts';
import type { RoundBook, TxHandle, TxJob, TxKey, TxKind, TxSender } from '../ports.ts';
import { ApiError, mapRevertToCode, publicMessage } from './errors.ts';
import { silentLogger, type Logger } from './log.ts';

export type SettlementKind = SsePayload<'settlement.step'>['kind'];

const KIND_MAP: Partial<Record<TxKind, SettlementKind>> = {
  open: 'open',
  cashout: 'cashout',
  withdraw: 'withdraw',
  faucet: 'faucet',
  settle: 'settle',
  record_settle: 'settle',
  void: 'void',
};

const HASH32 = /^0x[0-9a-fA-F]{64}$/;

export interface TrackedIntent {
  intentId: string;
  player: Address;
  kind: SettlementKind;
  roundId?: bigint;
  intentHash?: Hex;
  handleId?: string;
  createdAtMs: number;
}

export type TxOutcome = { status: 'confirmed' | 'failed'; txHash?: Hex; error?: string; code: ErrorCode | null };

export interface IntentTrackerDeps {
  bus: Bus;
  roundBook: RoundBook;
  now?: () => number;
  log?: Logger;
  /** How long an intent stays addressable (idempotency + step attribution). */
  ttlMs?: number;
}

export class IntentTracker {
  private readonly deps: IntentTrackerDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly ttlMs: number;
  private readonly byIntent = new Map<string, TrackedIntent>();
  private readonly byHandle = new Map<string, string>();
  private readonly byHash = new Map<string, string>();
  private readonly inFlightByKey = new Map<TxKey, number>();

  constructor(deps: IntentTrackerDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
    this.ttlMs = deps.ttlMs ?? 10 * 60_000;
  }

  /** Subscribes to `tx.step`; returns the unsubscribe function. */
  start(): () => void {
    return this.deps.bus.on('tx.step', (s) => this.onTxStep(s));
  }

  byIntentHash(hash: Hex): TrackedIntent | undefined {
    const id = this.byHash.get(hash.toLowerCase());
    return id ? this.byIntent.get(id) : undefined;
  }

  get(intentId: string): TrackedIntent | undefined {
    return this.byIntent.get(intentId);
  }

  inFlight(key: TxKey): number {
    return this.inFlightByKey.get(key) ?? 0;
  }

  /** Enqueues `job` and remembers who it belongs to; `onDone` runs once with the receipt outcome. */
  submit(
    sender: TxSender,
    job: TxJob,
    intent: Omit<TrackedIntent, 'createdAtMs' | 'handleId'>,
    onDone?: (outcome: TxOutcome) => void | Promise<void>,
  ): TxHandle {
    this.sweep();
    const tracked: TrackedIntent = { ...intent, createdAtMs: this.now() };
    this.byIntent.set(intent.intentId, tracked);
    if (intent.intentHash) this.byHash.set(intent.intentHash.toLowerCase(), intent.intentId);

    let handle: TxHandle;
    try {
      handle = sender.enqueue(job);
    } catch (err) {
      this.forget(intent.intentId);
      this.log.error('enqueue failed', { kind: job.kind, err: String(err) });
      throw new ApiError('RELAYER_BUSY', publicMessage('RELAYER_BUSY'));
    }
    tracked.handleId = handle.id;
    this.byHandle.set(handle.id, intent.intentId);
    this.inFlightByKey.set(job.key, this.inFlight(job.key) + 1);

    handle.done
      .then(
        (r): TxOutcome => ({ ...r, code: r.status === 'failed' ? mapRevertToCode(r.error) : null }),
        (err: unknown): TxOutcome => ({ status: 'failed', error: String(err), code: 'INTERNAL' }),
      )
      .then(async (outcome) => {
        this.inFlightByKey.set(job.key, Math.max(0, this.inFlight(job.key) - 1));
        if (outcome.status === 'failed') this.log.warn('tx failed', { kind: job.kind, intentId: intent.intentId, error: outcome.error });
        await onDone?.(outcome);
      })
      .catch((err: unknown) => this.log.error('intent completion handler failed', { intentId: intent.intentId, err: String(err) }));
    return handle;
  }

  private forget(intentId: string): void {
    const t = this.byIntent.get(intentId);
    if (!t) return;
    this.byIntent.delete(intentId);
    if (t.handleId) this.byHandle.delete(t.handleId);
    if (t.intentHash) this.byHash.delete(t.intentHash.toLowerCase());
  }

  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, t] of this.byIntent) if (t.createdAtMs < cutoff) this.forget(id);
  }

  private onTxStep(s: BusEvents['tx.step']): void {
    const kind = KIND_MAP[s.kind];
    if (!kind) return;
    const trackedId = (s.intentId && this.byIntent.has(s.intentId) ? s.intentId : undefined) ?? this.byHandle.get(s.id);
    const tracked = trackedId ? this.byIntent.get(trackedId) : undefined;
    const roundId = s.roundId ?? tracked?.roundId;
    const player = tracked?.player ?? (roundId !== undefined ? this.deps.roundBook.get(roundId)?.player : undefined);
    if (!player) return;
    const code = s.step === 'failed' ? mapRevertToCode(s.error) : null;
    this.deps.bus.emit('player.event', {
      player,
      event: 'settlement.step',
      payload: {
        kind,
        intentId: tracked?.intentId ?? s.intentId ?? null,
        roundId: roundId !== undefined ? roundId.toString() : null,
        step: s.step,
        txHash: s.txHash && HASH32.test(s.txHash) ? s.txHash : null,
        error: code ? { code, message: publicMessage(code) } : null,
      },
    });
  }
}
