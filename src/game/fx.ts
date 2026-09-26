import type { ActiveTradeRound } from '../types/game';

export const FX_REFERENCE = { stakeUsd: 10, multiplierBps: 28_400, feeBps: 0 } as const;

const BPS = 10_000;
const MAX_KEEP_FEE_BPS = BPS - 1;

export interface FxPnlInput {
  pnl: number;
  stake: number;
  multiplierBps?: number;
  feeBps?: number;
}

function grossOfFee(pnl: number, stake: number, multiplierBps: number, feeBps: number): number {
  const keep = (BPS - Math.min(feeBps, MAX_KEEP_FEE_BPS)) / BPS;
  const maxPayout = (stake * multiplierBps) / BPS;
  return Math.min((pnl + stake) / keep, maxPayout) - stake;
}

export function fxPnl({ pnl, stake, multiplierBps = FX_REFERENCE.multiplierBps, feeBps = FX_REFERENCE.feeBps }: FxPnlInput): number {
  if (!Number.isFinite(pnl) || !Number.isFinite(stake) || stake <= 0) return 0;
  const grossPnl = feeBps > 0 ? grossOfFee(pnl, stake, multiplierBps, feeBps) : pnl;
  const stakeScale = FX_REFERENCE.stakeUsd / stake;
  if (grossPnl < 0) return grossPnl * stakeScale;
  const upsideScale = (FX_REFERENCE.multiplierBps - BPS) / Math.max(1, multiplierBps - BPS);
  return grossPnl * stakeScale * upsideScale;
}

export type FxRoundInput = Pick<ActiveTradeRound, 'currentPnl' | 'stake' | 'multiplierBps' | 'feeBps'>;

export const fxPnlForRound = (round: FxRoundInput): number =>
  fxPnl({ pnl: round.currentPnl, stake: round.stake, multiplierBps: round.multiplierBps, feeBps: round.feeBps });
