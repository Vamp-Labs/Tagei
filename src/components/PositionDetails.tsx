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
  formatLeverage,
  formatPct,
  formatPrice,
  signOf,
  type StatTone,
} from '../ui/lucky';

interface PositionDetailsProps {
  round: ActiveTradeRound;
  onClose: () => void;
  /** Fixed leverage the engine actually uses — see settlementEngine.ts. Not
   * user-selectable; passed in rather than hardcoded so this stays honest
   * if the engine's constant ever changes. */
  leverage: number;
}

const ROW_TONE: Record<string, StatTone> = {
  'Target Price': 'profit',
  'Stop Loss': 'loss',
};

/**
 * docs/UI_UX_SPEC.md §8. Every row except "Est. Liquidation" comes straight
 * off ActiveTradeRound — a real screen, not a mock. Liquidation has no
 * field on the frozen type, so it's computed here from the same leverage
 * the settlement engine uses and labelled "Est." rather than presented as
 * settlement-grade data.
 */
export const PositionDetails: React.FC<PositionDetailsProps> = ({ round, onClose, leverage }) => {
  const dp = SUPPORTED_ASSETS[round.asset].decimals;
  const isLong = round.direction === 'LONG';
  const pct = (round.currentPnl / round.stake) * 100;

  // Standard leveraged-liquidation approximation: the price move that would
  // wipe the full stake at this leverage, off the real entry price.
  const liquidationPrice = isLong
    ? round.entryPrice * (1 - 1 / leverage)
    : round.entryPrice * (1 + 1 / leverage);

  const fmt = (v: number) => formatPrice(v, { unit: 'USDT', decimals: dp });

  const rows: [string, string][] = [
    ['Entry Price', fmt(round.entryPrice)],
    ['Current Price', fmt(round.currentPrice)],
    ['Target Price', fmt(round.targetPrice)],
    ['Stop Loss', fmt(round.stopLossPrice)],
    ['Stake', formatAmount(round.stake, 'USDT', { sign: 'never' })],
    ['Leverage', formatLeverage(leverage)],
    ['Est. Liquidation', fmt(liquidationPrice)],
  ];

  const status = round.outcome ? 'closed' : 'live';

  return (
    <Sheet onClose={onClose}>
      <SheetHeader
        title="Position Details"
        subtitle={`${status} · ${round.asset}/USDT`}
        action={<DirectionChip direction={round.direction} size="sm" />}
      />

      <div className="flex flex-col gap-3 px-6 pb-3">
        <div className="flex flex-col items-center gap-1 py-4 rounded-lg bg-panel">
          <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">P&amp;L</span>
          <SignedAmount value={round.currentPnl} className="text-display" />
          <span
            className={cn(
              'text-caption font-semibold tabular-nums',
              signOf(pct, 1) < 0 ? 'text-loss' : 'text-profit'
            )}
          >
            {formatPct(pct, { decimals: 1 })}
          </span>
        </div>

        <StatTable rows={rows.map(([label, value]) => ({ label, value, tone: ROW_TONE[label] }))} />
      </div>
    </Sheet>
  );
};
