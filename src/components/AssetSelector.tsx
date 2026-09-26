import React, { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { AssetSymbol, SUPPORTED_ASSETS, PriceTick } from '../types/market';
import { Button, SheetHeader } from '../ui/lucky';
import { AssetRow } from './home/AssetRow';

interface AssetSelectorProps {
  currentAsset: AssetSymbol;
  latestTick: PriceTick | null;
  onSelect: (asset: AssetSymbol) => void;
  onClose: () => void;
}

const ALL_ASSETS = Object.keys(SUPPORTED_ASSETS) as AssetSymbol[];

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight']);
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft']);

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  currentAsset,
  latestTick,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [focusedSymbol, setFocusedSymbol] = useState<AssetSymbol>(currentAsset);
  const rowRefs = useRef(new Map<AssetSymbol, HTMLButtonElement>());

  const assets = ALL_ASSETS.filter((symbol) => {
    const info = SUPPORTED_ASSETS[symbol];
    const q = query.trim().toLowerCase();
    return !q || symbol.toLowerCase().includes(q) || info.name.toLowerCase().includes(q);
  });

  const tabStop = assets.includes(focusedSymbol)
    ? focusedSymbol
    : assets.includes(currentAsset)
      ? currentAsset
      : assets[0];

  const moveFocus = (from: AssetSymbol, step: number | 'first' | 'last') => {
    const index = assets.indexOf(from);
    const nextIndex =
      step === 'first' ? 0 : step === 'last' ? assets.length - 1 : (index + step + assets.length) % assets.length;
    const next = assets[nextIndex];
    if (!next) return;
    setFocusedSymbol(next);
    rowRefs.current.get(next)?.focus();
  };

  const handleRowKeyDown = (symbol: AssetSymbol) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (NEXT_KEYS.has(event.key)) moveFocus(symbol, 1);
    else if (PREV_KEYS.has(event.key)) moveFocus(symbol, -1);
    else if (event.key === 'Home') moveFocus(symbol, 'first');
    else if (event.key === 'End') moveFocus(symbol, 'last');
    else return;
    event.preventDefault();
  };

  return (
    <Sheet onClose={onClose}>
      <SheetHeader
        title="Select Asset"
        subtitle={`crypto · ${ALL_ASSETS.length} markets`}
        action={<Button variant="icon" size="md" icon="close" aria-label="Close" onClick={onClose} />}
      />

      <div className="px-6 pb-4">
        <label className="flex items-center gap-3 h-12 px-4 rounded-md bg-well focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <Search className="w-5 h-5 text-ink-muted shrink-0" aria-hidden="true" />
          <input
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search asset…"
            aria-label="Search assets"
            className="flex-1 min-w-0 bg-transparent text-caption text-ink placeholder:text-ink-muted outline-none"
          />
        </label>
      </div>

      <div role="radiogroup" aria-label="Markets" className="flex flex-col gap-2 px-6 pb-4">
        {assets.map((symbol) => {
          const info = SUPPORTED_ASSETS[symbol];
          const isCurrent = symbol === currentAsset;
          const hasLiveData = isCurrent && latestTick !== null;

          return (
            <AssetRow
              key={symbol}
              ref={(node) => {
                if (node) rowRefs.current.set(symbol, node);
                else rowRefs.current.delete(symbol);
              }}
              symbol={symbol}
              price={hasLiveData ? latestTick.price : info.basePrice}
              change={hasLiveData ? latestTick.change24h : null}
              selected={isCurrent}
              focusable={symbol === tabStop}
              onSelect={() => onSelect(symbol)}
              onKeyDown={handleRowKeyDown(symbol)}
              onFocus={() => setFocusedSymbol(symbol)}
            />
          );
        })}
      </div>
    </Sheet>
  );
};
