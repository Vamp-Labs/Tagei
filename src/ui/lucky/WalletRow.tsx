import React from 'react';
import { cn } from '../cn';
import { Icon } from './Icon';

export interface WalletRowProps {
  icon?: React.ReactNode | string;
  amount: React.ReactNode;
  currency?: string;
  title?: React.ReactNode;
  bonus?: React.ReactNode;
  bonusTone?: 'lucky' | 'info' | 'amber' | 'muted';
  trailing?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  compact?: boolean;
  className?: string;
}

export const WalletRow: React.FC<WalletRowProps> = ({
  icon,
  amount,
  currency,
  title,
  bonus,
  bonusTone = 'lucky',
  trailing,
  selected = false,
  onSelect,
  compact = false,
  className,
}) => {
  const iconSize = compact ? 40 : 54;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn('lg-wallet', selected && 'is-on', compact && 'lg-wallet--compact', className)}
      onClick={onSelect}
    >
      {typeof icon === 'string' ? (
        <img className="lg-wallet-icon" src={icon} alt="" width={iconSize} height={iconSize} />
      ) : icon ? (
        <span className="lg-wallet-icon">{icon}</span>
      ) : null}
      <span className="lg-wallet-text">
        {title && <span className="lg-wallet-title">{title}</span>}
        <span className="lg-wallet-amount">
          {amount}
          {currency ? ` ${currency}` : ''}
        </span>
        {bonus && <span className={cn('lg-wallet-bonus', `is-${bonusTone}`)}>{bonus}</span>}
      </span>
      {trailing && <span className="lg-wallet-trailing">{trailing}</span>}
      <span className="lg-radio" aria-hidden="true">
        {selected && <Icon name="check" size={12} strokeWidth={3.4} />}
      </span>
    </button>
  );
};
