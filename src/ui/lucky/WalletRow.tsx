import React from 'react';
import { cn } from '../cn';
import { Icon } from './Icon';

export type WalletRowMode = 'radio' | 'button' | 'static';

export interface WalletRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'onSelect' | 'role'> {
  icon?: React.ReactNode;
  iconSrc?: string;
  amount: React.ReactNode;
  currency?: string;
  title?: React.ReactNode;
  bonus?: React.ReactNode;
  bonusTone?: 'lucky' | 'info' | 'amber' | 'muted';
  trailing?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  compact?: boolean;
  mode?: WalletRowMode;
  disabled?: boolean;
  className?: string;
}

export const WalletRow = React.forwardRef<HTMLElement, WalletRowProps>(
  (
    {
      icon,
      iconSrc,
      amount,
      currency,
      title,
      bonus,
      bonusTone = 'lucky',
      trailing,
      selected = false,
      onSelect,
      compact = false,
      mode = 'radio',
      disabled,
      className,
      onClick,
      ...rest
    },
    ref
  ) => {
    const iconSize = compact ? 40 : 54;
    const isRadio = mode === 'radio';
    const rowClass = cn(
      'lg-wallet',
      selected && 'is-on',
      compact && 'lg-wallet--compact',
      !isRadio && 'lg-wallet--plain',
      className
    );

    const body = (
      <>
        {iconSrc ? (
          <img className="lg-wallet-icon" src={iconSrc} alt="" width={iconSize} height={iconSize} />
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
        {isRadio && (
          <span className="lg-radio" aria-hidden="true">
            {selected && <Icon name="check" size={12} strokeWidth={3.4} />}
          </span>
        )}
      </>
    );

    if (mode === 'static') {
      return (
        <div ref={ref as React.Ref<HTMLDivElement>} className={rowClass} onClick={onClick} {...rest}>
          {body}
        </div>
      );
    }

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      onSelect?.();
    };

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        role={isRadio ? 'radio' : undefined}
        aria-checked={isRadio ? selected : undefined}
        disabled={disabled}
        className={rowClass}
        onClick={handleClick}
        {...rest}
      >
        {body}
      </button>
    );
  }
);

WalletRow.displayName = 'WalletRow';
