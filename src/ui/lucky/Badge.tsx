import React from 'react';
import { cn } from '../cn';
import { Icon } from './Icon';

export interface BadgeProps {
  tone?: 'pro' | 'count' | 'check';
  label?: string;
  children?: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'count', label, children, className }) => {
  if (tone === 'check') {
    return (
      <span className={cn('lg-badge lg-badge-check', className)} role="img" aria-label={label ?? 'Claimed'}>
        <Icon name="check" size={14} strokeWidth={3.2} />
      </span>
    );
  }
  return (
    <span className={cn('lg-badge', `lg-badge-${tone}`, className)} aria-label={label}>
      {children}
    </span>
  );
};
