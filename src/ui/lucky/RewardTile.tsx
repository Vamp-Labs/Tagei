import React from 'react';
import { cn } from '../cn';
import { Badge } from './Badge';

export interface RewardTileProps {
  state?: 'default' | 'claimed' | 'selected' | 'locked' | 'pro';
  art?: string;
  name?: string;
  timer?: string;
  progress?: number;
  progressTone?: 'amber' | 'lucky';
  label?: string;
  onClick?: () => void;
  className?: string;
}

const BAR_MAX_PX = 28;

export const RewardTile: React.FC<RewardTileProps> = ({
  state = 'default',
  art,
  name,
  timer,
  progress,
  progressTone = 'amber',
  label,
  onClick,
  className,
}) => (
  <button
    type="button"
    className={cn('lg-tile', `lg-tile-${state}`, className)}
    onClick={onClick}
    aria-pressed={state === 'selected'}
    aria-label={name ? undefined : label ?? state}
  >
    {state === 'claimed' && <Badge tone="check" className="lg-tile-check" />}
    {art && <img className="lg-tile-art" src={art} alt="" />}
    {name && <span className="lg-tile-name">{name}</span>}
    {timer && <span className="lg-tile-timer">{timer}</span>}
    {state === 'pro' && <span className="lg-tile-prolabel">pro</span>}
    {progress != null && (
      <span
        className={cn('lg-tile-bar', progressTone === 'lucky' ? 'is-lucky' : 'is-amber')}
        style={{ width: `${(Math.max(8, Math.min(100, progress)) / 100) * BAR_MAX_PX}px` }}
      />
    )}
  </button>
);
