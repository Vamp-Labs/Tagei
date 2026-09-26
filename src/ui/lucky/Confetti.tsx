import React, { useCallback, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { cn } from '../cn';
import { useMotionPref } from '../motion';
import { CONFETTI, type ConfettiKind } from './palette';

type ConfettiOptions = Omit<confetti.Options, 'colors'>;

export const CONFETTI_PRESETS: Record<ConfettiKind, ConfettiOptions> = {
  connect: { particleCount: 24, spread: 45, origin: { y: 0.72 } },
  win: { particleCount: 40, spread: 60, origin: { y: 0.65 } },
  levelUp: { particleCount: 55, spread: 75, origin: { y: 0.6 } },
  mission: { particleCount: 30, spread: 60, origin: { y: 0.15 } },
};

let layerInstance: confetti.CreateTypes | null = null;

const isSuppressed = () => {
  if (typeof document === 'undefined') return true;
  const { sceneFreeze, sceneFx, motion } = document.documentElement.dataset;
  return sceneFreeze === '1' || sceneFx === '0' || motion === 'reduce';
};

export const ConfettiLayer: React.FC<{ className?: string }> = ({ className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const instance = confetti.create(canvas, { resize: true, useWorker: false, disableForReducedMotion: true });
    layerInstance = instance;
    return () => {
      instance.reset();
      if (layerInstance === instance) layerInstance = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 z-[45] h-full w-full', className)}
    />
  );
};

export const useConfetti = () => {
  const reduced = useMotionPref();

  const burst = useCallback(
    (kind: ConfettiKind, opts: ConfettiOptions = {}) => {
      if (reduced || isSuppressed()) return;
      const fire = layerInstance ?? confetti;
      void fire({
        ...CONFETTI_PRESETS[kind],
        ...opts,
        colors: [...CONFETTI[kind]],
        disableForReducedMotion: true,
      });
    },
    [reduced]
  );

  return { burst };
};
