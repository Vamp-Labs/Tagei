export const MINUS = '−';

export type SignMode = 'always' | 'auto' | 'never';

const GROUPING = new Map<number, Intl.NumberFormat>();

const grouped = (value: number, decimals: number) => {
  let formatter = GROUPING.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    GROUPING.set(decimals, formatter);
  }
  return formatter.format(value);
};

const roundTo = (value: number, decimals: number) => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const signOf = (value: number, decimals = 2): -1 | 0 | 1 => {
  const rounded = roundTo(value, decimals);
  return rounded > 0 ? 1 : rounded < 0 ? -1 : 0;
};

const signed = (value: number, decimals: number, sign: SignMode) => {
  const rounded = roundTo(value, decimals);
  const body = grouped(Math.abs(rounded), decimals);
  if (rounded === 0 || sign === 'never') return body;
  if (rounded < 0) return `${MINUS}${body}`;
  return sign === 'always' ? `+${body}` : body;
};

const withUnit = (text: string, unit?: string | null) => (unit ? `${text} ${unit}` : text);

export interface AmountOptions {
  sign?: SignMode;
  decimals?: number;
}

export const formatAmount = (
  value: number,
  unit: string | null = 'USDT',
  { sign = 'always', decimals = 2 }: AmountOptions = {}
) => withUnit(signed(value, decimals, sign), unit);

export interface PriceOptions {
  unit?: string;
  decimals?: number;
}

const defaultPriceDecimals = (value: number) => (Math.abs(value) < 1 ? 4 : 2);

export const formatPrice = (value: number, { unit, decimals }: PriceOptions = {}) => {
  const places = decimals ?? defaultPriceDecimals(value);
  return withUnit(signed(value, places, 'auto'), unit);
};

export const formatPct = (value: number, { sign = 'always', decimals = 2 }: AmountOptions = {}) =>
  `${signed(value, decimals, sign)}%`;

export const formatMultiplier = (value: number, decimals = 2) => `${grouped(Math.abs(roundTo(value, decimals)), decimals)}x`;

export const formatLeverage = (value: number) => `${Math.round(value)}x`;

export const formatXp = (value: number, { sign = 'auto' }: { sign?: SignMode } = {}) =>
  `${signed(Math.round(value), 0, sign)} XP`;

const pad2 = (n: number) => String(n).padStart(2, '0');

export const formatTimer = (totalSeconds: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0 ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
};

export const formatHash = (hash: string, head = 6, tail = 4) =>
  hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
