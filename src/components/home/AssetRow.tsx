import React from 'react';
import { SUPPORTED_ASSETS, type AssetSymbol } from '../../types/market';
import { cn } from '../../ui/cn';
import { AssetDisc, Icon, formatPct, formatPrice, signOf } from '../../ui/lucky';

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
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={`${info.name}, ${symbol}, ${formatPrice(price, { unit: 'USDT' })}, ${changeLabel}`}
        tabIndex={focusable ? 0 : -1}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={cn('lg-wallet lg-wallet--compact', selected && 'is-on')}
      >
        <span className="lg-wallet-icon">
          <AssetDisc symbol={symbol} size={40} />
        </span>
        <span className="lg-wallet-text">
          <span className="text-label text-ink truncate">{info.name}</span>
          <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">{symbol}</span>
        </span>
        <span className="lg-wallet-trailing gap-0.5">
          <span className="text-caption font-bold text-ink">{formatPrice(price, { unit: 'USDT' })}</span>
          {change === null ? (
            <span className="text-micro font-semibold text-ink-muted">—</span>
          ) : (
            <span className={cn('text-micro font-semibold', signOf(change) < 0 ? 'text-loss' : 'text-profit')}>
              {formatPct(change)}
            </span>
          )}
        </span>
        <span className="lg-radio" aria-hidden="true">
          {selected && <Icon name="check" size={12} strokeWidth={3.4} />}
        </span>
      </button>
    );
  }
);
AssetRow.displayName = 'AssetRow';
