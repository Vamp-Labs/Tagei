import React from 'react';
import { cn } from '../cn';

export interface BalanceHeaderProps {
  brand: React.ReactNode;
  word: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  art?: string;
  className?: string;
}

export const BalanceHeader: React.FC<BalanceHeaderProps> = ({ brand, word, value, unit, art, className }) => (
  <div className={cn('lg-balance', className)}>
    <div className="lg-balance-name">
      <span className="lg-balance-brand">{brand}</span>
      <span>{word}</span>
    </div>
    <div className="lg-balance-value">
      {art && <img className="lg-balance-art" src={art} alt="" width={74} height={74} />}
      <b>
        {value}
        {unit ? ` ${unit}` : ''}
      </b>
    </div>
  </div>
);
