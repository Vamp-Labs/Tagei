// Display formatting shared by the PIX templates, the server and the web fallback.
// Amounts are 18-decimal bigints; negatives use the typographic minus (U+2212)
// to match the F1c copy ("ROUND COMPLETE −$x").

export const MINUS = '−';
const E16 = 10n ** 16n;
const E18 = 10n ** 18n;

const withThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Rounds |amount18| half-up to cents. */
function toCents(amount18: bigint): bigint {
  const abs = amount18 < 0n ? -amount18 : amount18;
  return (abs + E16 / 2n) / E16;
}

/**
 * `$612.34`, or with `signed`: `+$2.10` / `−$1.60`. An amount that rounds to zero
 * cents is shown unsigned (`$0.00`) so a dust loss never reads as `−$0.00`.
 */
export function formatUsd18(amount18: bigint, opts: { signed?: boolean } = {}): string {
  const cents = toCents(amount18);
  const body = `$${withThousands((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`;
  if (!opts.signed || cents === 0n) return body;
  return `${amount18 < 0n ? MINUS : '+'}${body}`;
}

/** An 18-decimal price at `decimals` places, e.g. `$64,210.55` or `$0.1234`. */
export function formatPrice18(price18: bigint, decimals = 2): string {
  const d = Math.max(0, Math.min(8, Math.trunc(decimals)));
  const unit = 10n ** BigInt(18 - d);
  const scaled = (price18 + unit / 2n) / unit;
  const div = 10n ** BigInt(d);
  const whole = withThousands((scaled / div).toString());
  return d === 0 ? `$${whole}` : `$${whole}.${(scaled % div).toString().padStart(d, '0')}`;
}

/** `+0.12%` / `−0.08%` (or unsigned with `signed: false`). */
export function formatPct(pct: number, digits = 2, signed = true): string {
  if (!Number.isFinite(pct)) return '—';
  const abs = Math.abs(pct).toFixed(digits);
  if (!signed || Number(abs) === 0) return `${abs}%`;
  return `${pct < 0 ? MINUS : '+'}${abs}%`;
}

/** Share of `whole` as a floored integer percentage (0 when whole is 0). */
export function sharePct(part18: bigint, whole18: bigint): number {
  if (whole18 <= 0n) return 0;
  return Number((part18 * 100n) / whole18);
}

/** payout / stake as a multiple with one decimal, e.g. `2.0x`. */
export function formatMultiple(payout18: bigint, stake18: bigint): string {
  if (stake18 <= 0n) return '0.0x';
  const tenths = (payout18 * 10n + stake18 / 2n) / stake18;
  return `${tenths / 10n}.${tenths % 10n}x`;
}

export const toUsdNumber = (amount18: bigint): number => Number(amount18) / Number(E18);

/** Deterministic variant choice so the same round always reads the same way. */
export function pickVariant<T>(variants: readonly T[], seed = 0): T {
  const i = Math.abs(Math.trunc(seed)) % variants.length;
  return variants[i] as T;
}
