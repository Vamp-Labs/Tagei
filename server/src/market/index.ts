// Binance market data (data-api.binance.vision): 24 h tickers every 30 s and 1 m klines every
// 60 s for 24 h change, chart seed history and PIX volume features. Context only: settlement and
// P&L never use these prices (PRD §37).

import { ASSETS, type AssetSymbol } from '@bnbplay/shared/assets';
import type { DayStats, DayStatsSource } from '../pricehub/snapshot.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';

export interface Ticker24h {
  asset: AssetSymbol;
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  priceChangePct: number;
  volume: string;
  quoteVolume: string;
  closeTimeMs: number;
  fetchedAtMs: number;
}

export interface Kline1m {
  openTimeMs: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
  trades: number;
  closeTimeMs: number;
}

export interface VolumeFeatures {
  quoteVolume1h: number;
  quoteVolumePrev1h: number;
  volumeChangePct: number | null;
  trades1h: number;
  range1hPct: number | null;
}

export interface MarketData extends DayStatsSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  ticker(asset: AssetSymbol): Ticker24h | undefined;
  change24hPct(asset: AssetSymbol): number | null;
  klines(asset: AssetSymbol, limit?: number): Kline1m[];
  volumeFeatures(asset: AssetSymbol): VolumeFeatures | null;
}

/** "612.34000000" → 612340000000000000000n (18 decimals, truncated). */
export function decimalToPrice18(s: string): bigint {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s.trim());
  if (!m) throw new Error(`not a decimal: ${s}`);
  const frac = (m[3] ?? '').slice(0, 18).padEnd(18, '0');
  const v = BigInt(m[2] || '0') * 10n ** 18n + BigInt(frac || '0');
  return m[1] === '-' ? -v : v;
}

export interface MarketOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  log?: Logger;
  tickerMs?: number;
  klinesMs?: number;
  klineLimit?: number;
}

export function createMarket(o: MarketOptions): MarketData {
  const f = o.fetch ?? fetch;
  const log = o.log ?? silentLogger;
  const base = o.baseUrl.replace(/\/$/, '');
  const tickers = new Map<AssetSymbol, Ticker24h>();
  const klines = new Map<AssetSymbol, Kline1m[]>();
  const limit = o.klineLimit ?? 240;
  const timers: NodeJS.Timeout[] = [];

  async function getJson(url: string): Promise<unknown> {
    const res = await f(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  async function refreshTickers(): Promise<void> {
    const symbols = JSON.stringify(ASSETS.map((a) => a.binanceSymbol));
    try {
      const rows = (await getJson(`${base}/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`)) as Record<string, string | number>[];
      const now = Date.now();
      for (const r of rows) {
        const a = ASSETS.find((x) => x.binanceSymbol === r.symbol);
        if (!a) continue;
        tickers.set(a.symbol, {
          asset: a.symbol,
          symbol: String(r.symbol),
          lastPrice: String(r.lastPrice),
          openPrice: String(r.openPrice),
          highPrice: String(r.highPrice),
          lowPrice: String(r.lowPrice),
          priceChangePct: Number(r.priceChangePercent),
          volume: String(r.volume),
          quoteVolume: String(r.quoteVolume),
          closeTimeMs: Number(r.closeTime),
          fetchedAtMs: now,
        });
      }
    } catch (err) {
      log.warn('binance ticker refresh failed', { error: errorMessage(err) });
    }
  }

  async function refreshKlines(): Promise<void> {
    await Promise.all(
      ASSETS.map(async (a) => {
        try {
          const rows = (await getJson(`${base}/api/v3/klines?symbol=${a.binanceSymbol}&interval=1m&limit=${limit}`)) as unknown[][];
          klines.set(
            a.symbol,
            rows.map((k) => ({
              openTimeMs: Number(k[0]),
              open: String(k[1]),
              high: String(k[2]),
              low: String(k[3]),
              close: String(k[4]),
              volume: String(k[5]),
              closeTimeMs: Number(k[6]),
              quoteVolume: String(k[7]),
              trades: Number(k[8]),
            })),
          );
        } catch (err) {
          log.warn('binance klines refresh failed', { asset: a.symbol, error: errorMessage(err) });
        }
      }),
    );
  }

  const dayStats = (asset: AssetSymbol): DayStats | undefined => {
    const t = tickers.get(asset);
    if (!t) return undefined;
    const p = (s: string) => {
      try {
        return decimalToPrice18(s).toString();
      } catch {
        return null;
      }
    };
    return { open24h: p(t.openPrice), change24hPct: Number.isFinite(t.priceChangePct) ? t.priceChangePct : null, high24h: p(t.highPrice), low24h: p(t.lowPrice) };
  };

  return {
    async start() {
      await Promise.all([refreshTickers(), refreshKlines()]);
      timers.push(setInterval(() => void refreshTickers(), o.tickerMs ?? 30_000));
      timers.push(setInterval(() => void refreshKlines(), o.klinesMs ?? 60_000));
    },
    async stop() {
      for (const t of timers.splice(0)) clearInterval(t);
    },
    ticker: (asset) => tickers.get(asset),
    change24hPct: (asset) => {
      const v = tickers.get(asset)?.priceChangePct;
      return v === undefined || !Number.isFinite(v) ? null : v;
    },
    klines: (asset, n) => {
      const all = klines.get(asset) ?? [];
      return n === undefined ? [...all] : all.slice(-n);
    },
    volumeFeatures: (asset) => {
      const all = klines.get(asset) ?? [];
      if (all.length < 60) return null;
      const last = all.slice(-60);
      const prev = all.slice(-120, -60);
      const sum = (xs: Kline1m[]) => xs.reduce((s, k) => s + Number(k.quoteVolume), 0);
      const q1 = sum(last);
      const q0 = sum(prev);
      const hi = Math.max(...last.map((k) => Number(k.high)));
      const lo = Math.min(...last.map((k) => Number(k.low)));
      return {
        quoteVolume1h: q1,
        quoteVolumePrev1h: q0,
        volumeChangePct: prev.length === 60 && q0 > 0 ? ((q1 - q0) / q0) * 100 : null,
        trades1h: last.reduce((s, k) => s + k.trades, 0),
        range1hPct: lo > 0 ? ((hi - lo) / lo) * 100 : null,
      };
    },
    dayStats,
  };
}

export async function startMarket(o: MarketOptions): Promise<MarketData> {
  const m = createMarket(o);
  await m.start();
  return m;
}
