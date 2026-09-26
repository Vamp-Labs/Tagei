import React from 'react';
import { cn } from '../cn';

export type PillTone = 'neutral' | 'lucky' | 'gold' | 'info' | 'amber' | 'long' | 'short';

export interface PillProps {
  tone?: PillTone;
  icon?: React.ReactNode;
  dot?: boolean | 'pulse';
  size?: 'sm' | 'md';
  className?: string;
  children?: React.ReactNode;
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', icon, dot = false, size = 'md', className, children }) => (
  <span data-tone={tone} className={cn('lg-pill', size === 'sm' && 'lg-pill--sm', className)}>
    {dot && <span className={cn('lg-pill-dot', dot === 'pulse' && 'lg-pill-dot--pulse')} aria-hidden="true" />}
    {icon}
    {children}
  </span>
);
