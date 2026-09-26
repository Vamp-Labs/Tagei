import React from 'react';
import type { AssetSymbol } from '../../types/market';
import { cn } from '../cn';
import { CURRENCY } from './assets';
import { readableInk, TOKENS } from './palette';

export interface AssetDiscProps {
  symbol: AssetSymbol;
  size?: number;
  className?: string;
}

export const AssetDisc: React.FC<AssetDiscProps> = ({ symbol, size = 40, className }) => {
  const box = { width: size, height: size };
  if (symbol === 'BTC') {
    return (
      <span className={cn('lg-disc', className)} style={box}>
        <img src={CURRENCY.btc.src} alt="" width={size} height={size} />
      </span>
    );
  }
  const isBnb = symbol === 'BNB';
  return (
    <span
      className={cn('lg-disc', className)}
      style={{
        ...box,
        backgroundColor: isBnb ? TOKENS.gold.css : TOKENS.control.css,
        color: isBnb ? readableInk(TOKENS.gold).css : TOKENS.inkSecondary.css,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden="true"
    >
      {symbol.charAt(0)}
    </span>
  );
};
