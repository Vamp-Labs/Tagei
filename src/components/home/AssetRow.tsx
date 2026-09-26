import React from 'react';
import { SUPPORTED_ASSETS, type AssetSymbol } from '../../types/market';
import { cn } from '../../ui/cn';
import { AssetDisc, WalletRow, formatPct, formatPrice, signOf } from '../../ui/lucky';

export interface AssetRowProps {
  symbol: AssetSymbol;
  price: number;
  change: number | null;
  selected: boolean;
  focusable: boolean;
  onSelect: () => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
}

export const AssetRow = React.forwardRef<HTMLButtonElement, AssetRowProps>(
  ({ symbol, price, change, selected, focusable, onSelect, onKeyDown, onFocus }, ref) => {
    const info = SUPPORTED_ASSETS[symbol];
    const changeLabel = change === null ? 'no live change' : `${formatPct(change)} today`;
    return (
      <WalletRow
        ref={ref}
        mode="radio"
        compact
        selected={selected}
        onSelect={onSelect}
        aria-label={`${info.name}, ${symbol}, ${formatPrice(price, { unit: 'USDT' })}, ${changeLabel}`}
        tabIndex={focusable ? 0 : -1}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        icon={<AssetDisc symbol={symbol} size={40} />}
        amount={<span className="block truncate text-label text-ink">{info.name}</span>}
        bonus={<span className="text-micro font-semibold uppercase tracking-[0.08em]">{symbol}</span>}
        bonusTone="muted"
        trailing={
          <span className="flex flex-col items-end gap-0.5">
            <span className="text-caption font-bold text-ink">{formatPrice(price, { unit: 'USDT' })}</span>
            {change === null ? (
              <span className="text-micro font-semibold text-ink-muted">—</span>
            ) : (
              <span className={cn('text-micro font-semibold', signOf(change) < 0 ? 'text-loss' : 'text-profit')}>
                {formatPct(change)}
              </span>
            )}
          </span>
        }
      />
    );
  }
);
AssetRow.displayName = 'AssetRow';
