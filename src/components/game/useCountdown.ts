import { useEffect, useState } from 'react';

const REFRESH_MS = 250;

export const secondsLeft = (endMs: number, nowMs: number): number => Math.max(0, Math.ceil((endMs - nowMs) / 1000));

export function useCountdown(endMs: number | null, now: () => number): number | null {
  const [left, setLeft] = useState<number | null>(() => (endMs === null ? null : secondsLeft(endMs, now())));

  useEffect(() => {
    if (endMs === null) {
      setLeft(null);
      return;
    }
    const update = () => setLeft(secondsLeft(endMs, now()));
    update();
    const timer = window.setInterval(update, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [endMs, now]);

  return left;
}
