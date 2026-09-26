// Exact decimal-string ↔ 18-decimal integer conversion (Binance returns prices as
// decimal strings such as "612.34000000").

export function decimalTo18(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = (m[2] ?? '').slice(0, 18).padEnd(18, '0');
  return (BigInt(whole) * 10n ** 18n + BigInt(frac)).toString();
}

/** An 18-decimal integer as a JS number of whole units (display math only). */
export const from18 = (v: bigint | string): number => Number(BigInt(v)) / 1e18;
