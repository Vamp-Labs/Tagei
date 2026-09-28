import { DEFAULT_CONFIG } from '../../services/settlementEngine';
import type { ActiveTradeRound, TierLabel, TradeResult } from '../../types/game';
import { formatAmount, formatLeverage, formatPrice } from '../../ui/lucky/format';

const BPS = 10_000;

type LaneFields = Pick<ActiveTradeRound, 'multiplierBps' | 'tierLabel'>;

export const isLaneRound = (round: LaneFields): round is LaneFields & { multiplierBps: number } =>
  round.multiplierBps !== undefined;

export const laneMultiple = (multiplierBps: number): number => multiplierBps / BPS;

export const multipleText = (multiplierBps: number): string => `${Number(laneMultiple(multiplierBps).toFixed(2))}x`;

export const tierText = (label: TierLabel | undefined, multiplierBps: number): string =>
  `${label ?? 'CRUISE'} ${multipleText(multiplierBps)}`;

export const LEGACY_LEVERAGE = Math.round(DEFAULT_CONFIG.multiplierLeverage);

export function leverageText(round: LaneFields): string {
  return isLaneRound(round) ? tierText(round.tierLabel, round.multiplierBps) : formatLeverage(LEGACY_LEVERAGE);
}

export function targetPayout(round: Pick<ActiveTradeRound, 'stake' | 'maxPayout' | 'multiplierBps' | 'targetPct'>): number {
  if (round.maxPayout !== undefined) return round.maxPayout;
  if (round.multiplierBps !== undefined) return (round.stake * round.multiplierBps) / BPS;
  return round.stake + round.stake * (round.targetPct / 100) * DEFAULT_CONFIG.multiplierLeverage;
}

export function stopPnl(round: Pick<ActiveTradeRound, 'stake' | 'multiplierBps' | 'stopLossPct'>): number {
  if (round.multiplierBps !== undefined) return -round.stake;
  return -Math.min(round.stake, round.stake * (round.stopLossPct / 100) * DEFAULT_CONFIG.multiplierLeverage);
}

export const targetPnl = (round: Parameters<typeof targetPayout>[0]): number => targetPayout(round) - round.stake;

export interface RoundMarkerLabels {
  target: string;
  stop: string;
}

export function markerLabels(round: ActiveTradeRound): RoundMarkerLabels {
  return {
    target: `TARGET ${formatAmount(targetPnl(round))} · ${formatPrice(round.targetPrice)}`,
    stop: `STOP ${formatAmount(stopPnl(round))} · ${formatPrice(round.stopLossPrice)}`,
  };
}

export function roundEndMs(round: Pick<ActiveTradeRound, 'mode' | 'endSec' | 'startTime' | 'durationSeconds'>): number {
  if (round.mode === 'live' && round.endSec !== undefined) return round.endSec * 1000;
  return round.startTime + round.durationSeconds * 1000;
}

export function feeText(feeBps: number | undefined): string {
  if (!feeBps) return 'None';
  const pct = feeBps / 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2)}% on cash-out and timeout`;
}

export function durationText(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds)) return null;
  return `${Math.max(0, Math.round(seconds))} s`;
}

export type ResultKind = 'win' | 'loss' | 'cashed_out' | 'timeout' | 'voided';

export const resultKind = (result: Pick<TradeResult, 'outcome' | 'voided'>): ResultKind =>
  result.voided ? 'voided' : result.outcome;

export const RESULT_HEADLINE: Record<ResultKind, string> = {
  win: 'TARGET HIT',
  loss: 'ROUND COMPLETE',
  timeout: 'ROUND COMPLETE',
  cashed_out: 'CASHED OUT',
  voided: 'ROUND VOIDED',
};

export const VOID_COPY = 'Oracle data was incomplete. Your stake was returned.';
export const SETTLE_FAILED_TITLE = 'TRANSACTION NOT CONFIRMED';
export const SETTLE_FAILED_BODY = 'Your position was not settled.';
export const TIME_UP_COPY = 'TIME UP · locking final price';
export const PRACTICE_PILL = 'PRACTICE · NOT ON-CHAIN';
export const PRACTICE_SETTLE_COPY = 'Practice round · not settled on-chain';

export function splitNotice(copy: string): { title: string; body: string } {
  const at = copy.indexOf(' · ');
  return at < 0 ? { title: copy, body: '' } : { title: copy.slice(0, at), body: copy.slice(at + 3) };
}

const SHARE_APP_URL = 'https://bnb-play.vercel.app';

export function shareText(result: Pick<TradeResult, 'asset' | 'pnl' | 'outcome' | 'voided'>): string {
  const kind = resultKind(result);
  const pnl = formatAmount(result.pnl);
  const line =
    kind === 'voided'
      ? `Round voided on ${result.asset} — stake returned, settled on-chain.`
      : kind === 'win'
        ? `Target hit on ${result.asset} — ${pnl}, settled on-chain.`
        : kind === 'cashed_out'
          ? `Cashed out ${pnl} on ${result.asset}, settled on-chain.`
          : `Round complete on ${result.asset}, ${pnl}, settled on-chain.`;
  return `${line} Playing Tagei, a market game settled on BNB Chain.`;
}

export function shareTweetUrl(result: Pick<TradeResult, 'asset' | 'pnl' | 'outcome' | 'voided'>): string {
  const params = new URLSearchParams({ text: shareText(result), url: SHARE_APP_URL });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}
