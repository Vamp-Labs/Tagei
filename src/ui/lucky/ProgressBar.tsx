import React from 'react';
import { cn } from '../cn';

export interface ProgressBarProps {
  value: number;
  max?: number;
  next?: React.ReactNode;
  label: string;
  size?: 'lg' | 'sm';
  tone?: 'lucky' | 'gold';
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  next,
  label,
  size = 'lg',
  tone = 'lucky',
  className,
}) => {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(safeMax, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      className={cn('lg-progress', size === 'sm' && 'lg-progress--sm', tone === 'gold' && 'lg-progress--gold', className)}
    >
      <div className="lg-progress-track">
        <div className="lg-progress-fill" style={{ width: `${(clamped / safeMax) * 100}%` }} />
      </div>
      {next != null && <span className="lg-progress-next">{next}</span>}
    </div>
  );
};
