export const SPAN_FLOOR_FRACTION = 0.0003;

export function priceSpan(minPrice: number, maxPrice: number): number {
  return Math.max(minPrice * SPAN_FLOOR_FRACTION, maxPrice - minPrice);
}

export function exitTickIndex(history: readonly { timestamp: number }[], exitAtMs: number): number {
  const count = history.length;
  if (count === 0) return -1;
  if (exitAtMs <= history[0].timestamp) return 0;
  if (exitAtMs >= history[count - 1].timestamp) return count - 1;
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (history[mid].timestamp <= exitAtMs) low = mid;
    else high = mid;
  }
  return exitAtMs - history[low].timestamp <= history[high].timestamp - exitAtMs ? low : high;
}
