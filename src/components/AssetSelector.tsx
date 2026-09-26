import { useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { AssetSymbol, SUPPORTED_ASSETS, PriceTick } from '../types/market';

interface AssetSelectorProps {
  currentAsset: AssetSymbol;
  latestTick: PriceTick | null;
  onSelect: (asset: AssetSymbol) => void;
  onClose: () => void;
}

/**
 * docs/UI_UX_SPEC.md §9. Real data: every row comes from SUPPORTED_ASSETS,
 * which already carries symbol/name/color for all five assets this app
 * supports. "Crypto" is the only category, since it's the only one that
 * exists — the [All] [Crypto] [FX] [Commodities] row from the mock is
 * reduced to what's actually backed by data, not a fake multi-market list.
 */
export const AssetSelector: React.FC<AssetSelectorProps> = ({
  currentAsset,
  latestTick,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');

  const assets = (Object.keys(SUPPORTED_ASSETS) as AssetSymbol[]).filter((symbol) => {
    const info = SUPPORTED_ASSETS[symbol];
    const q = query.trim().toLowerCase();
    return !q || symbol.toLowerCase().includes(q) || info.name.toLowerCase().includes(q);
  });

  return (
    <Sheet onClose={onClose}>
      <div className="px-5 pt-1 pb-2">
        <h2 className="text-[length:var(--text-screen-title)] font-black text-[color:var(--color-text-1)]">
          Select Asset
        </h2>
      </div>

      <div className="px-5 pb-3">
        <div className="flex items-center gap-2 h-[var(--tap-min)] px-3 rounded-[var(--radius-md)] bg-[color:var(--color-bg-1)] border border-[color:var(--color-line)]">
          <Search className="w-4 h-4 text-[color:var(--color-text-3)] shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search asset…"
            className="flex-1 bg-transparent text-[length:var(--text-body)] text-[color:var(--color-text-1)] placeholder:text-[color:var(--color-text-3)] outline-none"
          />
        </div>
      </div>

      <div className="px-5 pb-3">
        <span className="inline-flex items-center px-3 h-8 rounded-full bg-[color:var(--color-bnb-yellow)]/15 border border-[color:var(--color-bnb-yellow)]/40 text-[length:var(--text-micro)] font-bold uppercase tracking-wide text-[color:var(--color-bnb-yellow)]">
          Crypto
        </span>
      </div>

      <div className="flex flex-col pb-4">
        {assets.map((symbol) => {
          const info = SUPPORTED_ASSETS[symbol];
          const isSelected = symbol === currentAsset;
          const isCurrent = symbol === currentAsset;
          const price = isCurrent && latestTick ? latestTick.price : info.basePrice;
          const change = isCurrent && latestTick ? latestTick.change24h : 0;

          return (
            <button
              key={symbol}
              onClick={() => onSelect(symbol)}
              className="flex items-center justify-between gap-3 px-5 h-14 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black text-black"
                  style={{ backgroundColor: info.color }}
                >
                  {symbol.slice(0, 1)}
                </span>
                <div className="min-w-0 text-left">
                  <div className="text-[length:var(--text-body)] font-bold text-[color:var(--color-text-1)] truncate">
                    {info.name}
                  </div>
                  <div className="text-[length:var(--text-micro)] text-[color:var(--color-text-3)] uppercase tracking-wide">
                    {symbol}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right font-mono">
                  <div className="text-[length:var(--text-metadata)] font-bold text-[color:var(--color-text-1)]">
                    ${price.toLocaleString(undefined, { maximumFractionDigits: info.decimals })}
                  </div>
                  <div
                    className="text-[length:var(--text-micro)] font-semibold"
                    style={{ color: change >= 0 ? 'var(--color-long)' : 'var(--color-short)' }}
                  >
                    {change >= 0 ? '+' : ''}
                    {change.toFixed(2)}%
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-[color:var(--color-bnb-yellow)]" />}
              </div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
};
