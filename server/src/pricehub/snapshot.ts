// Builders for the price payloads A4 serves: the SSE `prices.snapshot` event and
// GET /v1/market/snapshots. Prices are exact Supra rounds; 24 h stats come from the market module.

import type { z } from 'zod';
import { ASSETS, type AssetSymbol } from '@bnbplay/shared/assets';
import type { MarketSnapshotSchema } from '@bnbplay/shared/dto';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { PriceHub } from '../ports.ts';

export interface DayStats {
  open24h: string | null;
  change24hPct: number | null;
  high24h: string | null;
  low24h: string | null;
}

export interface DayStatsSource {
  dayStats(asset: AssetSymbol): DayStats | undefined;
}

const EMPTY: DayStats = { open24h: null, change24hPct: null, high24h: null, low24h: null };

export function buildPricesSnapshot(hub: PriceHub, market?: DayStatsSource, limit = 120): SsePayload<'prices.snapshot'> {
  const assets: SsePayload<'prices.snapshot'>['assets'] = {};
  const stats: SsePayload<'prices.snapshot'>['stats'] = {};
  for (const a of ASSETS) {
    assets[a.symbol] = {
      pairId: a.supraPairId,
      rounds: hub.history(a.supraPairId, limit).map((r) => [r.roundMs.toString(), r.tsMs, r.price18.toString()] as [string, number, string]),
    };
    stats[a.symbol] = market?.dayStats(a.symbol) ?? EMPTY;
  }
  return { assets, stats };
}

export function buildMarketSnapshots(hub: PriceHub, market?: DayStatsSource): z.infer<typeof MarketSnapshotSchema>[] {
  const out: z.infer<typeof MarketSnapshotSchema>[] = [];
  for (const a of ASSETS) {
    const r = hub.latest(a.supraPairId);
    if (!r) continue;
    const s = market?.dayStats(a.symbol) ?? EMPTY;
    out.push({
      asset: a.symbol,
      pairId: a.supraPairId,
      price: r.price18.toString(),
      round: r.roundMs.toString(),
      tsMs: r.tsMs,
      change24hPct: s.change24hPct,
      high24h: s.high24h,
      low24h: s.low24h,
    });
  }
  return out;
}
