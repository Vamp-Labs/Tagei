import { DEFAULT_DURATION_SEC, MAX_BARRIER_PPM, MIN_BARRIER_PPM } from '@bnbplay/shared/constants';
import { validateLane, type LaneParams } from '@bnbplay/shared/lane';
import type { AssetSymbol } from '@bnbplay/shared/assets';
import type { TierDTO } from '@bnbplay/shared/dto';
import { SUPPORTED_ASSETS } from '../types/market';
import type { TierLabel } from '../types/game';

export const TIER_LABELS: readonly TierLabel[] = ['CRUISE', 'BOOST', 'HYPER', 'WARP'];

export const tierLabel = (tier: number): TierLabel => TIER_LABELS[tier] ?? 'CRUISE';

export interface BaseAssetLanes {
  sigma1sPpm: number;
  gapMarginPpm: number;
  maxJumpPpm: number;
  tiers: readonly { tier: number; multiplierBps: number; targetPpm: number; stopPpm: number; enabled: boolean }[];
}

const DISABLED_HIGH_TIERS = [
  { tier: 2, multiplierBps: 30_000, targetPpm: 0, stopPpm: 0, enabled: false },
  { tier: 3, multiplierBps: 50_000, targetPpm: 0, stopPpm: 0, enabled: false },
] as const;

export const BASE_LANES: Record<AssetSymbol, BaseAssetLanes> = {
  BNB: {
    sigma1sPpm: 63.55,
    gapMarginPpm: 38,
    maxJumpPpm: 15_000,
    tiers: [
      { tier: 0, multiplierBps: 15_000, targetPpm: 226, stopPpm: 434, enabled: true },
      { tier: 1, multiplierBps: 20_000, targetPpm: 291, stopPpm: 262, enabled: true },
      ...DISABLED_HIGH_TIERS,
    ],
  },
  BTC: {
    sigma1sPpm: 52.67,
    gapMarginPpm: 31,
    maxJumpPpm: 10_000,
    tiers: [
      { tier: 0, multiplierBps: 15_000, targetPpm: 207, stopPpm: 397, enabled: true },
      { tier: 1, multiplierBps: 20_000, targetPpm: 0, stopPpm: 0, enabled: false },
      ...DISABLED_HIGH_TIERS,
    ],
  },
  ETH: {
    sigma1sPpm: 78.19,
    gapMarginPpm: 46,
    maxJumpPpm: 15_000,
    tiers: [
      { tier: 0, multiplierBps: 15_000, targetPpm: 265, stopPpm: 507, enabled: true },
      { tier: 1, multiplierBps: 20_000, targetPpm: 358, stopPpm: 323, enabled: true },
      ...DISABLED_HIGH_TIERS,
    ],
  },
  SOL: {
    sigma1sPpm: 111.65,
    gapMarginPpm: 66,
    maxJumpPpm: 20_000,
    tiers: [
      { tier: 0, multiplierBps: 15_000, targetPpm: 240, stopPpm: 461, enabled: true },
      { tier: 1, multiplierBps: 20_000, targetPpm: 511, stopPpm: 461, enabled: true },
      ...DISABLED_HIGH_TIERS,
    ],
  },
  DOGE: {
    sigma1sPpm: 173.71,
    gapMarginPpm: 102,
    maxJumpPpm: 40_000,
    tiers: [
      { tier: 0, multiplierBps: 15_000, targetPpm: 374, stopPpm: 717, enabled: true },
      { tier: 1, multiplierBps: 20_000, targetPpm: 794, stopPpm: 717, enabled: true },
      ...DISABLED_HIGH_TIERS,
    ],
  },
};

export const LANE_FEE_BPS = 100;
export const LANE_MIN_STAKE = 5n * 10n ** 18n;
export const LANE_MAX_STAKE = 50n * 10n ** 18n;

const MOCK_STEPS_PER_SEC = 4;
const MOCK_MOMENTUM_DECAY = 0.94;
const MOCK_NOISE_SCALE = 0.6;
const UNIFORM_VARIANCE = 1 / 12;

export function mockSigma1sPpm(volatility: number): number {
  const rho = MOCK_MOMENTUM_DECAY;
  const stepVariance = (UNIFORM_VARIANCE * (MOCK_NOISE_SCALE * volatility) ** 2) / (1 - rho * rho);
  let covarianceSum = 0;
  for (let lag = 1; lag < MOCK_STEPS_PER_SEC; lag++) covarianceSum += (MOCK_STEPS_PER_SEC - lag) * rho ** lag;
  const oneSecondVariance = stepVariance * (MOCK_STEPS_PER_SEC + 2 * covarianceSum);
  return Math.sqrt(oneSecondVariance) * 1_000_000;
}

const clampBarrier = (ppm: number): number => Math.min(MAX_BARRIER_PPM, Math.max(MIN_BARRIER_PPM, Math.round(ppm)));

export interface PracticeLane extends LaneParams {
  asset: AssetSymbol;
  tier: number;
  label: TierLabel;
  scale: number;
}

export function practiceLane(asset: AssetSymbol, tier = 0): PracticeLane | null {
  const base = BASE_LANES[asset];
  const lane = base.tiers.find((entry) => entry.tier === tier);
  if (!lane || !lane.enabled) return null;
  const scale = mockSigma1sPpm(SUPPORTED_ASSETS[asset].volatility) / base.sigma1sPpm;
  const candidate: PracticeLane = {
    asset,
    tier,
    label: tierLabel(tier),
    scale,
    targetPpm: clampBarrier(lane.targetPpm * scale),
    stopPpm: clampBarrier(lane.stopPpm * scale),
    multiplierBps: lane.multiplierBps,
    feeBps: LANE_FEE_BPS,
    durationSec: DEFAULT_DURATION_SEC,
    enabled: true,
    minStake: LANE_MIN_STAKE,
    maxStake: LANE_MAX_STAKE,
  };
  return validateLane(candidate, Math.ceil(base.gapMarginPpm * scale)).length === 0 ? candidate : null;
}

export function practiceTiers(asset: AssetSymbol): TierDTO[] {
  return BASE_LANES[asset].tiers.map((entry) => {
    const lane = practiceLane(asset, entry.tier);
    return {
      tier: entry.tier,
      label: tierLabel(entry.tier),
      laneVersion: 0,
      multiplierBps: entry.multiplierBps,
      targetPpm: lane?.targetPpm ?? 0,
      stopPpm: lane?.stopPpm ?? 0,
      feeBps: LANE_FEE_BPS,
      durationSec: DEFAULT_DURATION_SEC,
      minStake: LANE_MIN_STAKE.toString(),
      maxStake: LANE_MAX_STAKE.toString(),
      enabled: lane !== null,
    };
  });
}

export function describeLane(lane: Pick<LaneParams, 'targetPpm' | 'stopPpm' | 'multiplierBps'>): string {
  const pct = (ppm: number) => `${(ppm / 10_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
  const multiple = (lane.multiplierBps / 10_000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `Target +${pct(lane.targetPpm)} · Stop −${pct(lane.stopPpm)} · ${multiple}x`;
}
