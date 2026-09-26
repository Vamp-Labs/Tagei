// Public read endpoints: /config, /market/snapshots and the oracle audit routes.

import { Hono } from 'hono';
import { z } from 'zod';
import { ASSETS, assetBySymbol } from '@bnbplay/shared/assets';
import { bscTestnet } from '@bnbplay/shared/chain';
import { ENTRY_DELAY_SEC, EXIT_DELAY_SEC, PRICE_DECIMALS, STAKE_DECIMALS, STALL_AFTER_SEC } from '@bnbplay/shared/constants';
import { AssetSymbolSchema, ConfigSchema, Hash32, HexString, MarketSnapshotSchema, UintString, type ConfigDTO } from '@bnbplay/shared/dto';
import type { PriceHub } from '../ports.ts';
import type { ContractsDTO, LaneSource, MarketData } from './deps.ts';
import { ApiError } from './errors.ts';
import { parseWith, readQuery, sendJson } from './http.ts';
import { backtestStats, baseSigmaPpm } from './lanes.fixture.ts';
import { decimalTo18 } from './units.ts';

// Local response schemas (requested as additions to shared dto.ts).
export const OracleRoundsSchema = z.array(z.object({ sec: z.number().int(), tsMs: z.number().int(), price: UintString, proofHash: Hash32 }));
export const OracleProofSchema = z.object({ proof: HexString });
export const CalibrationSchema = z.object({
  note: z.string(),
  source: z.string(),
  assets: z.array(
    z.object({
      asset: AssetSymbolSchema,
      pairId: z.number().int(),
      sigma1sPpm: z.object({ backtest: z.number(), backtestRobust: z.number(), live: z.number().nullable() }),
      tiers: z.array(
        z.object({
          tier: z.number().int(),
          label: z.string(),
          enabled: z.boolean(),
          laneVersion: z.number().int(),
          targetPpm: z.number().int(),
          stopPpm: z.number().int(),
          multiplierBps: z.number().int(),
          backtest: z
            .object({ pTP: z.number(), pSL: z.number(), pTimeout: z.number(), houseEdge: z.number(), meanResolveSec: z.number() })
            .nullable(),
        }),
      ),
    }),
  ),
});

const RoundsQuery = z.object({
  asset: AssetSymbolSchema,
  fromSec: z.string().regex(/^\d+$/).transform(Number).optional(),
  toSec: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
});

export interface PublicRouterDeps {
  chainId: number;
  contracts: ContractsDTO | null;
  lanes: LaneSource;
  priceHub: PriceHub;
  marketData?: MarketData;
  features: { pixLlm: () => boolean | Promise<boolean>; faucet: boolean; walletConnect: boolean };
  /** Latest hub σ per asset (from `stats` events), for calibration. */
  liveSigma?: (asset: (typeof ASSETS)[number]['symbol']) => number | null;
}

export function createPublicRouter(deps: PublicRouterDeps): Hono {
  const r = new Hono();

  r.get('/config', async (c) => {
    const snap = await deps.lanes.snapshot();
    const config: ConfigDTO = {
      chainId: deps.chainId,
      explorer: bscTestnet.explorer,
      contracts: deps.contracts,
      activeOracleIdx: snap.activeOracleIdx,
      oracleTrusted: snap.oracleTrusted,
      stakeDecimals: STAKE_DECIMALS,
      priceDecimals: PRICE_DECIMALS,
      entryDelaySec: ENTRY_DELAY_SEC,
      exitDelaySec: EXIT_DELAY_SEC,
      stallAfterSec: STALL_AFTER_SEC,
      assets: snap.assets,
      features: { pixLlm: await deps.features.pixLlm(), faucet: deps.features.faucet, walletConnect: deps.features.walletConnect },
    };
    c.header('Cache-Control', 'public, max-age=5');
    return sendJson(c, ConfigSchema, config);
  });

  r.get('/market/snapshots', (c) => {
    const out = [];
    for (const a of ASSETS) {
      const latest = deps.priceHub.latest(a.supraPairId);
      if (!latest) continue;
      const t = deps.marketData?.cachedTicker24h(a.symbol);
      void deps.marketData?.ticker24h(a.symbol); // refresh in the background
      out.push({
        asset: a.symbol,
        pairId: a.supraPairId,
        price: latest.price18.toString(),
        round: latest.roundMs.toString(),
        tsMs: latest.tsMs,
        change24hPct: t ? t.changePct : null,
        high24h: decimalTo18(t?.highPrice),
        low24h: decimalTo18(t?.lowPrice),
      });
    }
    return sendJson(c, z.array(MarketSnapshotSchema), out);
  });

  r.get('/oracle/rounds', (c) => {
    const q = readQuery(c, RoundsQuery);
    const limit = Math.min(Math.max(q.limit ?? 120, 1), 1800);
    const pair = assetBySymbol(q.asset).supraPairId;
    const rows = [...deps.priceHub.history(pair, 1800)]
      .filter((x) => (q.fromSec === undefined || x.sec >= q.fromSec) && (q.toSec === undefined || x.sec <= q.toSec))
      .sort((a, b) => a.sec - b.sec)
      .slice(-limit)
      .map((x) => ({ sec: x.sec, tsMs: x.tsMs, price: x.price18.toString(), proofHash: x.proofHash }));
    return sendJson(c, OracleRoundsSchema, rows);
  });

  r.get('/oracle/proof/:hash', (c) => {
    const hash = parseWith(Hash32, c.req.param('hash'), 'hash').toLowerCase();
    // The hub keeps ~30 min of rounds in memory; find the second this proof covers.
    for (const a of ASSETS) {
      const hit = deps.priceHub.history(a.supraPairId, 1800).find((x) => x.proofHash.toLowerCase() === hash);
      if (!hit) continue;
      const p = deps.priceHub.proofForSecond(hit.sec);
      if (p && p.proofHash.toLowerCase() === hash) return sendJson(c, OracleProofSchema, { proof: p.proof });
    }
    throw new ApiError('VALIDATION', 'proof not found (only recent proofs are served)', { status: 404 });
  });

  r.get('/oracle/calibration', async (c) => {
    const snap = await deps.lanes.snapshot();
    const assets = snap.assets.map((a) => {
      const sigma = baseSigmaPpm(a.symbol);
      return {
        asset: a.symbol,
        pairId: a.pairId,
        sigma1sPpm: { backtest: sigma.plain, backtestRobust: sigma.robust, live: deps.liveSigma?.(a.symbol) ?? null },
        tiers: a.tiers.map((t) => ({
          tier: t.tier,
          label: t.label,
          enabled: t.enabled,
          laneVersion: t.laneVersion,
          targetPpm: t.targetPpm,
          stopPpm: t.stopPpm,
          multiplierBps: t.multiplierBps,
          backtest: backtestStats(a.symbol, t.tier) ?? null,
        })),
      };
    });
    c.header('Cache-Control', 'no-store');
    return sendJson(c, CalibrationSchema, {
      note: 'Ops calibration only. Backtest touch rates are never shown to players as win odds.',
      source: 'research/lane-params.json (Binance 1 s closes, 7 days) + live hub sigma',
      assets,
    });
  });

  return r;
}
