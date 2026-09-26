// Frozen module boundaries (F1). Modules depend on these interfaces and the bus,
// never on each other's internals. A3 implements the chain side, A4 the app side.

import type { Address, Hex } from 'viem';
import type { DebriefDTO, MarketInsightDTO, RoundDTO } from '@bnbplay/shared/dto';
import type { AssetSymbol } from '@bnbplay/shared/assets';
import type { RoundTerms } from '@bnbplay/shared/path';

export type OracleStatus = 'ok' | 'degraded' | 'down';

/** One Supra round for one pair, decoded off-chain. `sec = roundMs / 1000`. */
export interface OracleRound {
  pairId: number;
  roundMs: bigint;
  sec: number;
  tsMs: number;
  price18: bigint;
  proofHash: Hex;
  receivedAtMs: number;
}

export interface PriceHub {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): { status: OracleStatus; lagMsP50: number | null; pairs: Record<number, { ageMs: number }> };
  latest(pairId: number): OracleRound | undefined;
  history(pairId: number, limit: number): OracleRound[];
  /** Raw 5-pair proof whose rounds include `sec`, if it was captured. */
  proofForSecond(sec: number): { proof: Hex; proofHash: Hex } | undefined;
  /** Resolves when the round for `sec` has been observed, or rejects on timeout. */
  waitForSecond(pairId: number, sec: number, timeoutMs: number): Promise<OracleRound>;
}

export type TxKey = 'relayer' | 'recorder' | 'ops';

export type TxKind = 'open' | 'cashout' | 'withdraw' | 'record' | 'record_settle' | 'settle' | 'void' | 'faucet' | 'admin';

export interface TxJob {
  key: TxKey;
  kind: TxKind;
  to: Address;
  data: Hex;
  roundId?: bigint;
  intentId?: string;
  /** Higher runs first within a key's queue. */
  priority: number;
  gasPremium?: number;
}

export type TxStep = 'preparing' | 'signing' | 'submitted' | 'confirmed' | 'failed';

export interface TxHandle {
  id: string;
  /** Resolves with the receipt status; rejects only on programming errors. */
  done: Promise<{ status: 'confirmed' | 'failed'; txHash?: Hex; error?: string }>;
}

export interface TxSender {
  key: TxKey;
  address(): Address;
  enqueue(job: TxJob): TxHandle;
  balanceWei(): Promise<bigint>;
}

/** Live view of open rounds, fed by chain events (indexer + receipts). */
export interface RoundState {
  roundId: bigint;
  player: Address;
  assetId: number;
  pairId: number;
  terms: RoundTerms;
  openTx: Hex;
  status: 'open' | 'settled';
}

export interface RoundBook {
  open(): RoundState[];
  get(roundId: bigint): RoundState | undefined;
  activeFor(player: Address): RoundState | undefined;
  toDTO(roundId: bigint): RoundDTO | undefined;
}

export interface ProgressionService {
  /** Idempotent per round; called once the settlement is finalized. */
  onRoundFinalized(roundId: bigint): Promise<void>;
}

export interface PixService {
  insight(asset: AssetSymbol, tier?: number): Promise<MarketInsightDTO>;
  debrief(roundId: bigint): Promise<DebriefDTO>;
  chat(player: Address, messages: { role: 'user' | 'assistant'; content: string }[]): AsyncIterable<string>;
}

export interface ReadinessCheck {
  name: string;
  check(): Promise<{ ok: boolean; detail?: unknown }>;
}
