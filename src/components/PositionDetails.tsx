import { Sheet } from '../ui/Sheet';
import { cn } from '../ui/cn';
import { ActiveTradeRound } from '../types/game';
import { SUPPORTED_ASSETS } from '../types/market';
import {
  DirectionChip,
  SheetHeader,
  SignedAmount,
  StatTable,
  formatAmount,
  formatPct,
  formatPrice,
  formatTimer,
  signOf,
  type StatRow,
} from '../ui/lucky';
import { LEGACY_LEVERAGE, feeText, isLaneRound, leverageText, roundEndMs, targetPayout } from './game/roundDisplay';
import { useCountdown } from './game/useCountdown';

interface PositionDetailsProps {
  round: ActiveTradeRound;
  onClose: () => void;
  now: () => number;
}

export const PositionDetails: React.FC<PositionDetailsProps> = ({ round, onClose, now }) => {
  const dp = SUPPORTED_ASSETS[round.asset].decimals;
  const pct = round.stake > 0 ? (round.currentPnl / round.stake) * 100 : 0;
  const closed = round.outcome !== undefined;
  const secondsLeft = useCountdown(closed ? null : roundEndMs(round), now);
  const lane = isLaneRound(round);

  const price = (v: number) => formatPrice(v, { unit: 'USDT', decimals: dp });
  const usdt = (v: number) => formatAmount(v, 'USDT', { sign: 'never' });

  const rows: StatRow[] = [
    { label: lane ? 'Tier' : 'Leverage', value: lane ? leverageText(round) : `${LEGACY_LEVERAGE}x` },
    { label: 'Entry Price', value: price(round.entryPrice) },
    { label: closed ? 'Exit Price' : 'Current Price', value: price(round.exitPrice ?? round.currentPrice) },
    { label: 'Target Price', value: price(round.targetPrice), tone: 'profit' },
    { label: 'Stop Loss', value: price(round.stopLossPrice), tone: 'loss' },
    { label: 'Stake', value: usdt(round.stake) },
    { label: 'Payout at target', value: usdt(targetPayout(round)), tone: 'profit' },
    { label: closed ? 'Payout' : 'Cash-out now', value: usdt(Math.max(0, round.stake + round.currentPnl)) },
  ];
  if (lane) rows.push({ label: 'Fee', value: feeText(round.feeBps), tone: 'muted' });
  rows.push({ label: 'Ends in', value: closed || secondsLeft === null ? 'closed' : formatTimer(secondsLeft) });

  return (
    <Sheet onClose={onClose}>
      <SheetHeader
        title="Position Details"
        subtitle={`${closed ? 'closed' : 'live'} · ${round.asset}/USDT${round.mode === 'practice' ? ' · practice' : ''}`}
        action={<DirectionChip direction={round.direction} size="sm" />}
      />

      <div className="flex flex-col gap-3 px-6 pb-3">
        <div className="flex flex-col items-center gap-1 py-4 rounded-lg bg-well">
          <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">P&amp;L</span>
          <SignedAmount value={round.currentPnl} className="text-display" />
          <span className={cn('text-caption font-semibold tabular-nums', signOf(pct, 1) < 0 ? 'text-loss' : 'text-profit')}>
            {formatPct(pct, { decimals: 1 })}
          </span>
        </div>

        <StatTable rows={rows} />
      </div>
    </Sheet>
  );
};
