import { useEffect, useRef, useState } from 'react';
import { soundEngine } from '../../services/audioHaptics';

const PNL_ROLL_MS = 650;
const XP_COUNT_MS = 800;
const COUNT_TICK_MS = 45;
const TICK_CUTOFF = 0.95;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const progressAt = (elapsed: number, duration: number) => Math.min(1, Math.max(0, elapsed / duration));

export interface ResultCounterInput {
  resultId: string;
  pnl: number;
  startXp: number;
  targetXp: number;
  reduced: boolean;
  onComplete: () => void;
}

export const useResultCounters = ({ resultId, pnl, startXp, targetXp, reduced, onComplete }: ResultCounterInput) => {
  const [pnlDisplay, setPnlDisplay] = useState(reduced ? pnl : 0);
  const [xpDisplay, setXpDisplay] = useState(reduced ? targetXp : startXp);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    if (reduced) {
      setPnlDisplay(pnl);
      return;
    }
    const start = performance.now();
    let lastTick = Number.NEGATIVE_INFINITY;
    let frame = 0;
    const step = (now: number) => {
      const progress = progressAt(now - start, PNL_ROLL_MS);
      setPnlDisplay(progress < 1 ? pnl * easeOutCubic(progress) : pnl);
      if (progress < TICK_CUTOFF && now - lastTick > COUNT_TICK_MS) {
        soundEngine.playCountTick();
        lastTick = now;
      }
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    setPnlDisplay(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [resultId, pnl, reduced]);

  useEffect(() => {
    if (reduced || startXp === targetXp) {
      setXpDisplay(targetXp);
      onCompleteRef.current();
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = progressAt(now - start, XP_COUNT_MS);
      setXpDisplay(progress < 1 ? Math.floor(startXp + (targetXp - startXp) * progress) : targetXp);
      if (progress < 1) frame = requestAnimationFrame(step);
      else onCompleteRef.current();
    };
    setXpDisplay(startXp);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [resultId, startXp, targetXp, reduced]);

  return { pnlDisplay, xpDisplay };
};
