// Interfaces A4 needs beyond the frozen ports.ts. Each has an A4 default
// implementation; A0 may swap in an A3-backed one without touching A4 code.
// (Requested as additions to ports.ts in the A4 report.)

import type { Address } from 'viem';
import type { AssetSymbol } from '@bnbplay/shared/assets';
import type { ConfigDTO, RoundDTO } from '@bnbplay/shared/dto';

export type AssetConfigDTO = ConfigDTO['assets'][number];
export type TierDTO = AssetConfigDTO['tiers'][number];
export type ContractsDTO = NonNullable<ConfigDTO['contracts']>;

/** Lanes as the Arena reports them (or the F1e base table before F2 lands). */
export interface LaneSnapshot {
  assets: AssetConfigDTO[];
  activeOracleIdx: number;
  oracleTrusted: boolean;
  source: 'chain' | 'fixture';
  fetchedAtMs: number;
}

export interface LaneSource {
  snapshot(): Promise<LaneSnapshot>;
  /** Drop any cache (e.g. on LaneConfigured / ActiveOracleSet). */
  invalidate(): void;
}

/** Arena ledger reads (`balanceOf`). */
export interface LedgerReader {
  balanceOf(player: Address): Promise<bigint>;
}

/** Binance 24 h ticker, raw decimal strings as returned by data-api.binance.vision. */
export interface Ticker24h {
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  changePct: number;
  fetchedAtMs: number;
}

export interface Kline {
  openTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number;
}

/** Display / PIX features only; settlement never reads these. */
export interface MarketData {
  ticker24h(asset: AssetSymbol): Promise<Ticker24h | undefined>;
  /** Last cached ticker without any I/O (used on hot paths such as SSE connect). */
  cachedTicker24h(asset: AssetSymbol): Ticker24h | undefined;
  klines1m(asset: AssetSymbol, limit: number): Promise<Kline[] | undefined>;
}

/** Settled rounds of a player, newest first. Default: A4's progression store. */
export interface RoundHistory {
  listForPlayer(player: Address, opts: { beforeRoundId?: bigint; limit: number }): Promise<RoundDTO[]>;
  get(roundId: bigint): Promise<RoundDTO | undefined>;
}
