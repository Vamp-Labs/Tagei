import type { ConfigDTO, TierDTO } from '@bnbplay/shared/dto';
import { describeLane, practiceTiers, tierLabel } from '../../game/lanes';
import { stake18ToUsd } from '../../game/units';
import type { TierLabel } from '../../types/game';
import type { AssetSymbol } from '../../types/market';

export const FIRST_PREVIEW_TIER = 2;

export interface TierOption {
  tier: number;
  label: TierLabel;
  enabled: boolean;
  comingSoon: boolean;
  multiplierBps: number;
  targetPpm: number;
  stopPpm: number;
  feeBps: number;
  durationSec: number;
  minStake: number;
  maxStake: number;
  summary: string | null;
}

function toOption(dto: TierDTO): TierOption | null {
  const comingSoon = !dto.enabled && dto.tier >= FIRST_PREVIEW_TIER;
  if (!dto.enabled && !comingSoon) return null;
  return {
    tier: dto.tier,
    label: dto.label ?? tierLabel(dto.tier),
    enabled: dto.enabled,
    comingSoon,
    multiplierBps: dto.multiplierBps,
    targetPpm: dto.targetPpm,
    stopPpm: dto.stopPpm,
    feeBps: dto.feeBps,
    durationSec: dto.durationSec,
    minStake: stake18ToUsd(dto.minStake),
    maxStake: stake18ToUsd(dto.maxStake),
    summary: dto.enabled ? describeLane(dto) : null,
  };
}

export const tierOptions = (tiers: readonly TierDTO[]): TierOption[] =>
  [...tiers].sort((a, b) => a.tier - b.tier).map(toOption).filter((option): option is TierOption => option !== null);

export const practiceTierOptions = (asset: AssetSymbol): TierOption[] => tierOptions(practiceTiers(asset));

export function liveTierOptions(config: ConfigDTO | null, asset: AssetSymbol): TierOption[] {
  const entry = config?.assets.find((item) => item.symbol === asset);
  return entry && entry.enabled ? tierOptions(entry.tiers) : [];
}

export function pickTier(options: readonly TierOption[], wanted: number): TierOption | null {
  const playable = options.filter((option) => option.enabled);
  return playable.find((option) => option.tier === wanted) ?? playable[0] ?? null;
}

export const STAKE_STEP = 5;

export function clampStake(stake: number, tier: TierOption | null): number {
  if (!tier) return stake;
  return Math.min(tier.maxStake, Math.max(tier.minStake, stake));
}
