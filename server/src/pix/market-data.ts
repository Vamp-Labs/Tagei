// Binance data-api client for display and PIX features (24 h ticker, 1 m klines).
// Cached, time-boxed, never throws into request paths. Settlement never reads it.

import { assetBySymbol, type AssetSymbol } from '@bnbplay/shared/assets';
import type { Kline, MarketData, Ticker24h } from '../api/deps.ts';
import { silentLogger, type Logger } from '../api/log.ts';

export interface BinanceMarketDataOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: Logger;
  tickerTtlMs?: number;
  klineTtlMs?: number;
  timeoutMs?: number;
}

export function createBinanceMarketData(opts: BinanceMarketDataOptions): MarketData {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? silentLogger;
  const tickers = new Map<AssetSymbol, Ticker24h>();
  const klines = new Map<string, { at: number; rows: Kline[] }>();
  const inflight = new Map<string, Promise<unknown>>();

  const get = async (path: string): Promise<unknown> => {
    const res = await f(`${opts.baseUrl.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 1_500) });
    if (!res.ok) throw new Error(`binance ${res.status}`);
    return res.json();
  };
  const once = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const p = (inflight.get(key) as Promise<T> | undefined) ?? fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  return {
    cachedTicker24h: (asset) => tickers.get(asset),
    async ticker24h(asset) {
      const cached = tickers.get(asset);
      if (cached && now() - cached.fetchedAtMs < (opts.tickerTtlMs ?? 30_000)) return cached;
      return once(`t:${asset}`, async () => {
        try {
          const j = (await get(`/api/v3/ticker/24hr?symbol=${assetBySymbol(asset).binanceSymbol}`)) as Record<string, string>;
          const t: Ticker24h = {
            lastPrice: String(j.lastPrice),
            openPrice: String(j.openPrice),
            highPrice: String(j.highPrice),
            lowPrice: String(j.lowPrice),
            changePct: Number(j.priceChangePercent),
            fetchedAtMs: now(),
          };
          if (!Number.isFinite(t.changePct)) throw new Error('bad ticker');
          tickers.set(asset, t);
          return t;
        } catch (err) {
          log.debug('binance ticker failed', { asset, err: String(err) });
          return cached;
        }
      });
    },
    async klines1m(asset, limit) {
      const key = `${asset}:${limit}`;
      const cached = klines.get(key);
      if (cached && now() - cached.at < (opts.klineTtlMs ?? 60_000)) return cached.rows;
      return once(`k:${key}`, async () => {
        try {
          const rows = (await get(`/api/v3/klines?symbol=${assetBySymbol(asset).binanceSymbol}&interval=1m&limit=${limit}`)) as unknown[][];
          const out = rows.map(
            (r): Kline => ({
              openTimeMs: Number(r[0]),
              open: Number(r[1]),
              high: Number(r[2]),
              low: Number(r[3]),
              close: Number(r[4]),
              volume: Number(r[5]),
              takerBuyVolume: Number(r[9]),
            }),
          );
          klines.set(key, { at: now(), rows: out });
          return out;
        } catch (err) {
          log.debug('binance klines failed', { asset, err: String(err) });
          return cached?.rows;
        }
      });
    },
  };
}

/** No network: every read is empty (tests, offline dev). */
export const nullMarketData: MarketData = {
  cachedTicker24h: () => undefined,
  ticker24h: async () => undefined,
  klines1m: async () => undefined,
};
