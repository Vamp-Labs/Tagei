import React from 'react';
import { cn } from '../../ui/cn';
import { SegmentedTabs, type SegmentedTabsItem } from '../../ui/lucky';

export interface ChoiceRowProps<T extends string> {
  label: string;
  description?: React.ReactNode;
  ariaLabel: string;
  items: readonly SegmentedTabsItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function ChoiceRow<T extends string>({
  label,
  description,
  ariaLabel,
  items,
  value,
  onChange,
  className,
}: ChoiceRowProps<T>) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-md bg-well px-4 py-3', className)}>
      <div className="flex flex-col">
        <span className="text-caption font-semibold text-ink">{label}</span>
        {description && <span className="text-micro text-ink-muted">{description}</span>}
      </div>
      <SegmentedTabs
        role="radiogroup"
        surface="sheet"
        size="sm"
        ariaLabel={ariaLabel}
        items={items}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
