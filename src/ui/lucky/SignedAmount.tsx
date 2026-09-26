import React from 'react';
import { cn } from '../cn';
import { formatAmount, signOf } from './format';

export interface SignedAmountProps {
  value: number;
  unit?: string | null;
  decimals?: number;
  sign?: 'always' | 'auto';
  tone?: 'auto' | 'ink';
  className?: string;
}

export const SignedAmount: React.FC<SignedAmountProps> = ({
  value,
  unit = 'USDT',
  decimals = 2,
  sign = 'always',
  tone = 'auto',
  className,
}) => {
  const toneClass = tone === 'ink' ? 'text-ink' : signOf(value, decimals) < 0 ? 'text-loss' : 'text-profit';
  return (
    <span className={cn('tabular-nums whitespace-nowrap', toneClass, className)}>
      {formatAmount(value, unit, { sign, decimals })}
    </span>
  );
};
