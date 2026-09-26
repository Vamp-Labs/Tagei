// F1e base lanes (config/97.json, laneVersion 1) — served by /v1/config until the
// Arena is deployed, then replaced by chain reads. Backtest statistics come from
// research/lane-params.json (7 days of Binance 1 s closes); they feed
// /v1/oracle/calibration only and are never shown as win odds.

import type { AssetSymbol } from '@bnbplay/shared/assets';
import type { AssetConfigDTO, LaneSnapshot, LaneSource, TierDTO } from './deps.ts';

const E18 = 10n ** 18n;
const MIN_STAKE = (5n * E18).toString();
const MAX_STAKE = (50n * E18).toString();

export const TIER_LABELS = ['CRUISE', 'BOOST', 'HYPER', 'WARP'] as const;
const TIER_MULTIPLIER_BPS = [15_000, 20_000, 30_000, 50_000] as const;

interface BacktestStats {
  pTP: number;
  pSL: number;
  pTimeout: number;
  houseEdge: number;
  meanResolveSec: number;
}

interface FixtureAsset {
  assetId: number;
  symbol: AssetSymbol;
  pairId: number;
  sigma1sPpm: number;
  sigma1sRobustPpm: number;
  gapMarginPpm: number;
  maxJumpPpm: number;
  /** [targetPpm, stopPpm, enabled, backtest] per tier 0..3. */
  tiers: readonly [number, number, boolean, BacktestStats][];
}

const s = (pTP: number, pSL: number, pTimeout: number, houseEdge: number, meanResolveSec: number): BacktestStats => ({
  pTP,
  pSL,
  pTimeout,
  houseEdge,
  meanResolveSec,
});

export const FIXTURE_ASSETS: readonly FixtureAsset[] = [
  {
    assetId: 0,
    symbol: 'BNB',
    pairId: 49,
    sigma1sPpm: 63.55,
    sigma1sRobustPpm: 44.88,
    gapMarginPpm: 38,
    maxJumpPpm: 15_000,
    tiers: [
      [226, 434, true, s(0.323235, 0.139351, 0.537413, 0.059801, 22.76)],
      [291, 262, true, s(0.246102, 0.275315, 0.478584, 0.028387, 21.78)],
      [718, 276, false, s(0.050086, 0.271666, 0.678248, 0.022878, 25.23)],
      [1526, 276, false, s(0.004555, 0.272434, 0.72301, 0.028282, 25.75)],
    ],
  },
  {
    assetId: 1,
    symbol: 'BTC',
    pairId: 0,
    sigma1sPpm: 52.67,
    sigma1sRobustPpm: 36.11,
    gapMarginPpm: 31,
    maxJumpPpm: 10_000,
    tiers: [
      [207, 397, true, s(0.2599, 0.113656, 0.626444, 0.060093, 24.18)],
      // BTC BOOST disabled at G0: momentum edge −2.7 % at a 3 s entry delay.
      [241, 217, false, s(0.214615, 0.24002, 0.545364, 0.024814, 22.69)],
      [626, 217, false, s(0.047672, 0.251453, 0.700875, 0.02904, 25.4)],
      [1399, 228, false, s(0.00468, 0.24145, 0.753869, 0.03634, 26.15)],
    ],
  },
  {
    assetId: 2,
    symbol: 'ETH',
    pairId: 1,
    sigma1sPpm: 78.19,
    sigma1sRobustPpm: 57.11,
    gapMarginPpm: 46,
    maxJumpPpm: 15_000,
    tiers: [
      [265, 507, true, s(0.318395, 0.140022, 0.541584, 0.058611, 22.68)],
      [358, 323, true, s(0.229466, 0.258655, 0.51188, 0.028939, 22.26)],
      [840, 323, false, s(0.053035, 0.270787, 0.676178, 0.027016, 25.08)],
      [1786, 323, false, s(0.005748, 0.272152, 0.7221, 0.032267, 25.66)],
    ],
  },
  {
    assetId: 3,
    symbol: 'SOL',
    pairId: 10,
    sigma1sPpm: 111.65,
    sigma1sRobustPpm: 86.94,
    gapMarginPpm: 66,
    maxJumpPpm: 20_000,
    tiers: [
      [240, 461, true, s(0.474245, 0.220268, 0.305487, 0.052003, 17.5)],
      [511, 461, true, s(0.228976, 0.249883, 0.52114, 0.025072, 22.77)],
      [1200, 485, false, s(0.043003, 0.256722, 0.700274, 0.028971, 25.66)],
      [2425, 485, false, s(0.004364, 0.257509, 0.738128, 0.020241, 26.11)],
    ],
  },
  {
    assetId: 4,
    symbol: 'DOGE',
    pairId: 3,
    sigma1sPpm: 173.71,
    sigma1sRobustPpm: 141.47,
    gapMarginPpm: 102,
    maxJumpPpm: 40_000,
    tiers: [
      [374, 717, true, s(0.437204, 0.209664, 0.353132, 0.057704, 18.57)],
      [794, 717, true, s(0.213556, 0.237177, 0.549267, 0.027486, 23.17)],
      [1775, 717, false, s(0.048254, 0.246986, 0.70476, 0.027114, 25.7)],
      [3772, 754, false, s(0.004418, 0.236316, 0.759266, 0.024046, 26.45)],
    ],
  },
];

export function fixtureAssets(): AssetConfigDTO[] {
  return FIXTURE_ASSETS.map((a) => ({
    assetId: a.assetId,
    symbol: a.symbol,
    pairId: a.pairId,
    maxJumpPpm: a.maxJumpPpm,
    gapMarginPpm: a.gapMarginPpm,
    enabled: true,
    tiers: a.tiers.map(
      ([targetPpm, stopPpm, enabled], tier): TierDTO => ({
        tier,
        label: TIER_LABELS[tier] ?? 'CRUISE',
        laneVersion: 1,
        multiplierBps: TIER_MULTIPLIER_BPS[tier] ?? 15_000,
        targetPpm,
        stopPpm,
        feeBps: 100,
        durationSec: 30,
        minStake: MIN_STAKE,
        maxStake: MAX_STAKE,
        enabled,
      }),
    ),
  }));
}

export function createFixtureLaneSource(now: () => number = Date.now): LaneSource {
  return {
    snapshot: async (): Promise<LaneSnapshot> => ({
      assets: fixtureAssets(),
      activeOracleIdx: 0,
      oracleTrusted: false,
      source: 'fixture',
      fetchedAtMs: now(),
    }),
    invalidate: () => {},
  };
}

export const baseSigmaPpm = (symbol: AssetSymbol): { plain: number; robust: number } => {
  const a = FIXTURE_ASSETS.find((x) => x.symbol === symbol);
  return a ? { plain: a.sigma1sPpm, robust: a.sigma1sRobustPpm } : { plain: 60, robust: 45 };
};

export const backtestStats = (symbol: AssetSymbol, tier: number): BacktestStats | undefined =>
  FIXTURE_ASSETS.find((x) => x.symbol === symbol)?.tiers[tier]?.[3];
