import React, { useRef, useState } from 'react';
import { cn } from '../cn';

export interface SegmentedTabsItem<T extends string> {
  value: T;
  label: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'long' | 'short';
}

export interface SegmentedTabsProps<T extends string> {
  items: readonly SegmentedTabsItem<T>[];
  value?: T | null;
  onChange?: (value: T) => void;
  surface?: 'lobby' | 'sheet';
  size?: 'md' | 'sm';
  role?: 'tablist' | 'radiogroup';
  ariaLabel: string;
  className?: string;
}

const STEP_KEYS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  surface = 'lobby',
  size = 'md',
  role = 'tablist',
  ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  const [uncontrolled, setUncontrolled] = useState<T | null>(items[0]?.value ?? null);
  const selected = value === undefined ? uncontrolled : value;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isRadio = role === 'radiogroup';
  const focusIndex = Math.max(0, items.findIndex((item) => item.value === selected));

  const choose = (next: T) => {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = STEP_KEYS[event.key];
    if (!step || items.length === 0) return;
    event.preventDefault();
    const nextIndex = (index + step + items.length) % items.length;
    refs.current[nextIndex]?.focus();
    choose(items[nextIndex].value);
  };

  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={cn('lg-tabs', surface === 'sheet' && 'lg-tabs--sheet', size === 'sm' && 'lg-tabs--sm', className)}
    >
      {items.map((item, index) => {
        const on = item.value === selected;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={isRadio ? 'radio' : 'tab'}
            aria-checked={isRadio ? on : undefined}
            aria-selected={isRadio ? undefined : on}
            tabIndex={index === focusIndex ? 0 : -1}
            data-tone={item.tone ?? 'default'}
            className={cn('lg-tab', on && 'is-on')}
            onClick={() => choose(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="lg-tab-bar" aria-hidden="true" />
            {item.eyebrow && <span className="lg-tab-eyebrow">{item.eyebrow}</span>}
            <span className="lg-tab-main">
              {item.icon && <span className="lg-tab-icon inline-flex">{item.icon}</span>}
              <span className="lg-tab-label">{item.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
