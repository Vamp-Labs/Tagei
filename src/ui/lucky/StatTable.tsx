import React from 'react';
import { cn } from '../cn';

export type StatTone = 'ink' | 'profit' | 'loss' | 'long' | 'short' | 'muted';

export interface StatRow {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: StatTone;
}

export interface StatTableProps {
  rows: readonly StatRow[];
  className?: string;
}

export const StatTable: React.FC<StatTableProps> = ({ rows, className }) => (
  <dl className={cn('lg-statrows', className)}>
    {rows.map((row, index) => (
      <div key={index} className="lg-statrow">
        <dt>{row.label}</dt>
        <dd data-tone={row.tone ?? 'ink'}>{row.value}</dd>
      </div>
    ))}
  </dl>
);
