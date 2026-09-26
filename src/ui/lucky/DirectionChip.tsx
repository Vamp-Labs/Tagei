import React from 'react';
import { cn } from '../cn';
import { formatLeverage } from './format';
import { Icon } from './Icon';

export interface DirectionChipProps {
  direction: 'LONG' | 'SHORT';
  leverage?: number;
  size?: 'sm' | 'md';
  className?: string;
}

export const DirectionChip: React.FC<DirectionChipProps> = ({ direction, leverage, size = 'md', className }) => (
  <span data-direction={direction} className={cn('lg-dir', size === 'sm' && 'lg-dir--sm', className)}>
    <Icon name={direction === 'LONG' ? 'tri-up' : 'tri-down'} size={size === 'sm' ? 12 : 14} />
    <span>{direction}</span>
    {leverage != null && <span className="lg-dir-lev">· {formatLeverage(leverage)}</span>}
  </span>
);
