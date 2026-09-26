import { useEffect, useRef, useState } from 'react';

const BLINK_MIN_MS = 3000;
const BLINK_MAX_MS = 6000;
const BLINK_DURATION_MS = 140;

export const useBlink = (enabled: boolean): boolean => {
  const [blinking, setBlinking] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBlinking(false);
      return;
    }

    let cancelled = false;

    const clear = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };

    const scheduleNext = () => {
      const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      timerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);
        timerRef.current = window.setTimeout(() => {
          if (cancelled) return;
          setBlinking(false);
          scheduleNext();
        }, BLINK_DURATION_MS);
      }, delay);
    };

    scheduleNext();
    return () => {
      cancelled = true;
      clear();
    };
  }, [enabled]);

  return blinking;
};
