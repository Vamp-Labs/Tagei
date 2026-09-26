import React from 'react';

export type IconName =
  | 'back'
  | 'grid'
  | 'plus'
  | 'minus'
  | 'check'
  | 'lock'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'tri-up'
  | 'tri-down';

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const STROKE_PATHS: Record<Exclude<IconName, 'grid' | 'tri-up' | 'tri-down'>, string> = {
  back: 'M19 12H5m6-6-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  close: 'M6 6l12 12M18 6 6 18',
  'chevron-left': 'M14.5 6 8.5 12l6 6',
  'chevron-right': 'M9.5 6l6 6-6 6',
  'chevron-up': 'M6 14.5 12 8.5l6 6',
  'chevron-down': 'M6 9.5l6 6 6-6',
};

const TRIANGLES = {
  'tri-up': 'M12 5.5 20 18.5H4z',
  'tri-down': 'M12 18.5 4 5.5h16z',
} as const;

const GRID_CELLS = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col })));

export const Icon: React.FC<IconProps> = ({ name, size = 24, strokeWidth = 2.4, className }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    focusable: false as const,
    className,
  };

  if (name === 'grid') {
    return (
      <svg {...common}>
        {GRID_CELLS.map(({ row, col }) => (
          <rect key={`${row}-${col}`} x={4 + col * 6.5} y={4 + row * 6.5} width={3.5} height={3.5} rx={1} fill="currentColor" />
        ))}
      </svg>
    );
  }

  if (name === 'tri-up' || name === 'tri-down') {
    return (
      <svg {...common}>
        <path d={TRIANGLES[name]} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={STROKE_PATHS[name]} />
    </svg>
  );
};
