import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { ActiveTradeRound } from '../types/game';
import { SUPPORTED_ASSETS } from '../types/market';

interface PositionDetailsProps {
  round: ActiveTradeRound;
  onClose: () => void;
  /** Fixed leverage the engine actually uses — see settlementEngine.ts. Not
   * user-selectable; passed in rather than hardcoded so this stays honest
   * if the engine's constant ever changes. */
  leverage: number;
}

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

  const fmt = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

  const rows: [string, string][] = [
    ['Entry Price', fmt(round.entryPrice)],
    ['Current Price', fmt(round.currentPrice)],
    ['Target Price', fmt(round.targetPrice)],
    ['Stop Loss', fmt(round.stopLossPrice)],
    ['Stake', `$${round.stake.toFixed(2)}`],
    ['Leverage', `${leverage}x`],
    ['Est. Liquidation', fmt(liquidationPrice)],
  ];

  return (
    <Sheet onClose={onClose}>
      <div className="px-5 pt-1 pb-4">
        <h2 className="text-[length:var(--text-screen-title)] font-black text-[color:var(--color-text-1)] mb-3">
          Position Details
        </h2>

        <div className="flex items-center justify-between mb-4">
          <div
            className="flex items-center gap-1.5 px-3 h-8 rounded-full font-mono text-[length:var(--text-metadata)] font-bold"
            style={{
              color: isLong ? 'var(--color-long)' : 'var(--color-short)',
              backgroundColor: isLong ? 'rgba(0,232,154,0.12)' : 'rgba(255,59,107,0.12)',
            }}
          >
            {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            <span>{round.direction} · {leverage}x</span>
          </div>
          <div className="text-right font-mono">
            <div
              className="text-[length:var(--text-body)] font-black"
              style={{ color: round.currentPnl >= 0 ? 'var(--color-long)' : 'var(--color-short)' }}
            >
              {round.currentPnl >= 0 ? '+' : '-'}${Math.abs(round.currentPnl).toFixed(2)}
            </div>
            <div className="text-[length:var(--text-micro)] text-[color:var(--color-text-3)]">
              ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-line)] overflow-hidden">
          {rows.map(([label, value], i) => (
            <div
              key={label}
              className={`flex items-center justify-between px-4 h-12 ${
                i > 0 ? 'border-t border-[color:var(--color-line)]' : ''
              }`}
            >
              <span className="text-[length:var(--text-metadata)] text-[color:var(--color-text-2)]">
                {label}
              </span>
              <span className="font-mono text-[length:var(--text-metadata)] font-bold text-[color:var(--color-text-1)]">
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
};
