import { useCallback, useEffect, useState } from 'react';

export type Hand = 'left' | 'right';

const STORAGE_KEY = 'bnbplay.hand';

const readStored = (): Hand => {
  if (typeof window === 'undefined') return 'right';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
};

/**
 * Handedness lives outside UserSettings on purpose: the app applies it as a
 * `data-hand` attribute on <html> and the whole mirror is driven from CSS
 * (`--hand-dir`), so no component needs to thread it through props.
 */
export const useHandedness = (): [Hand, (next: Hand) => void, () => void] => {
  const [hand, setHandState] = useState<Hand>(readStored);

  useEffect(() => {
    document.documentElement.dataset.hand = hand;
    try {
      window.localStorage.setItem(STORAGE_KEY, hand);
    } catch {
      /* private mode — the attribute is still applied for this session */
    }
  }, [hand]);

  const setHand = useCallback((next: Hand) => setHandState(next), []);
  const toggleHand = useCallback(
    () => setHandState((prev) => (prev === 'right' ? 'left' : 'right')),
    []
  );

  return [hand, setHand, toggleHand];
};
