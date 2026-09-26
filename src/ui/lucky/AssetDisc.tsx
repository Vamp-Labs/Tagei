import React from 'react';
import { SUPPORTED_ASSETS, type AssetSymbol } from '../../types/market';
import { cn } from '../cn';
import { CURRENCY } from './assets';
import { readableInk, TOKENS, type Hex } from './palette';

export interface AssetDiscProps {
  symbol: AssetSymbol;
  size?: number;
  className?: string;
}

const discColor = (symbol: AssetSymbol): Hex =>
  symbol === 'BNB' ? TOKENS.gold.hex : (SUPPORTED_ASSETS[symbol].color as Hex);

export const AssetDisc: React.FC<AssetDiscProps> = ({ symbol, size = 40, className }) => {
  const box = { width: size, height: size };
  if (symbol === 'BTC') {
    return (
      <span className={cn('lg-disc', className)} style={box}>
        <img src={CURRENCY.btc.src} alt="" width={size} height={size} />
      </span>
    );
  }
  const fill = discColor(symbol);
  return (
    <span
      className={cn('lg-disc', className)}
      style={{ ...box, backgroundColor: fill, color: readableInk(fill).css, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {symbol.charAt(0)}
    </span>
  );
};
