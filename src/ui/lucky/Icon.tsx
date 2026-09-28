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
  | 'tri-down'
  | 'arrow-right'
  | 'send'
  | 'search'
  | 'home'
  | 'external'
  | 'shield-check'
  | 'bolt'
  | 'key'
  | 'broadcast'
  | 'clock'
  | 'rocket'
  | 'x-logo';

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const STROKE_PATHS: Record<Exclude<IconName, 'grid' | 'tri-up' | 'tri-down' | 'x-logo'>, string> = {
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
  'arrow-right': 'M5 12h14m-6-6 6 6-6 6',
  send: 'M21 3 3 10.5l7 3 3 7.5L21 3zM10 13.5 21 3',
  search: 'M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.4-4.4',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  'shield-check': 'M12 3 5 6v5.5c0 4.2 3 7.8 7 9.5 4-1.7 7-5.3 7-9.5V6l-7-3zM9 12l2.2 2.2L15.5 10',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z',
  key: 'M8 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM10.8 12.2 19 4M16 7l2.5 2.5M14 9l2 2',
  broadcast:
    'M12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  clock: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2',
  rocket:
    'M12 3c3 2 4.5 5.5 4.5 9.5L14.5 16h-5l-2-3.5C7.5 8.5 9 5 12 3zM12 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 13l-3 3 3.5.5M16 13l3 3-3.5.5M10.5 18.5 12 21l1.5-2.5',
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

  if (name === 'x-logo') {
    return (
      <svg {...common}>
        <path
          fill="currentColor"
          d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
        />
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
