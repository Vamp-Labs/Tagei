import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from 'motion/react';
import type { AnimationPlaybackControls } from 'motion/react';
import { soundEngine } from '../services/audioHaptics';
import { MICRO, POP_EASE, useMotionPref } from './motion';
import { cn } from './cn';
import { buttonClass } from './lucky/Button';
import { rgba, TOKENS } from './lucky/palette';

interface HoldButtonProps {
  onCommit: () => void;
  children: React.ReactNode;
  /** Shown while the hold is in progress, in place of `children`. */
  holdingLabel?: React.ReactNode;
  disabled?: boolean;
  holdMs?: number;
  className?: string;
  /** Tailwind text-* class; the progress ring is drawn in currentColor. */
  ringClassName?: string;
  ariaLabel?: string;
  /** 'bare' (default) renders exactly as before; 'hot' is the Lucky hot CTA. */
  variant?: 'bare' | 'hot';
}

/** Distance the pointer may wander before the hold is treated as a cancel. */
const SLIP_TOLERANCE = 24;
const HINT_MS = 1400;
const BURST_MS = 320;
const HOLD_HINT_LABEL = 'HOLD TO CONFIRM';

const roundedRectPerimeter = (w: number, h: number, r: number) =>
  2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;

/**
 * A commit button that requires a deliberate press-and-hold rather than a tap.
 * It guards money actions (LAUNCH, CASH OUT) against a mis-fire from a thumb
 * stretching for the arc, and it calls exactly the same callback a click would.
 */
export const HoldButton: React.FC<HoldButtonProps> = ({
  onCommit,
  children,
  holdingLabel,
  disabled = false,
  holdMs = 700,
  className,
  ringClassName,
  ariaLabel,
  variant = 'bare',
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const progress = useMotionValue(0);
  const playbackRef = useRef<AnimationPlaybackControls | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const milestoneRef = useRef(0);
  const reduceMotion = useMotionPref();
  const isHot = variant === 'hot';

  const [box, setBox] = useState({ w: 0, h: 0, r: 16 });
  const [isHolding, setIsHolding] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // A one-shot "release" pulse on commit — id-keyed so AnimatePresence
  // retriggers even on back-to-back commits, auto-cleared after its own
  // animation duration.
  const [burst, setBurst] = useState(0);
  const burstIdRef = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
      setBox({ w: rect.width, h: rect.height, r: Math.min(radius, rect.height / 2) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const perimeter = roundedRectPerimeter(box.w, box.h, box.r) || 1;
  const dashOffset = useTransform(progress, (value) => perimeter * (1 - value));
  // Escalating "charging up" glow behind the ring stroke — grows with hold
  // progress rather than snapping on, so the build reads continuously. A
  // fixed white glow rather than currentColor: ringClassName sets a dark
  // *contrast* color for the stroke against a bright button (e.g. black on
  // yellow), and a glow in that same dark tone would just look like a
  // shadow, not energy building.
  const ringGlow = useTransform(
    progress,
    (value) => `drop-shadow(0 0 ${2 + value * 10}px ${rgba(TOKENS.ink, 0.15 + value * 0.55)})`
  );
  // A faint scale creep on the whole button, same read.
  const pressScale = useTransform(progress, [0, 1], [1, 1.015]);
  const ringOpacity = useMotionValue(0);

  useEffect(() => {
    ringOpacity.set(isHolding ? 1 : 0);
  }, [isHolding, ringOpacity]);

  // Audio/haptic ramp: reel clicks at each quarter, then a rising tone just
  // before the action fires so the commit is never a surprise.
  useMotionValueEvent(progress, 'change', (value) => {
    const milestone = Math.floor(value * 4);
    if (milestone > milestoneRef.current && milestone < 4) {
      milestoneRef.current = milestone;
      soundEngine.playCountTick();
      soundEngine.hapticLight();
    }
    if (value >= 0.9 && milestoneRef.current < 4) {
      milestoneRef.current = 4;
      soundEngine.playNearTargetTone(1);
    }
  });

  const stopHold = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, []);

  const cancelHold = useCallback(() => {
    if (!originRef.current) return;
    originRef.current = null;
    milestoneRef.current = 0;
    stopHold();
    setIsHolding(false);
    // A tap that was too short is a real intent, just an under-shot one —
    // say so rather than failing silently.
    if (progress.get() > 0.02 && progress.get() < 1) {
      setShowHint(true);
      window.setTimeout(() => setShowHint(false), HINT_MS);
    }
    animate(progress, 0, { ...MICRO, duration: 0.15 });
  }, [progress, stopHold]);

  const commit = useCallback(() => {
    originRef.current = null;
    milestoneRef.current = 0;
    stopHold();
    setIsHolding(false);
    setShowHint(false);
    progress.set(0);
    soundEngine.hapticMedium();
    // Release burst — fires for both the held (touch) and instant (mouse)
    // paths alike, since both funnel through here. Mouse users get zero
    // hold feedback by design (see handlePointerDown), so this is their
    // only confirmation that the press landed.
    const id = ++burstIdRef.current;
    setBurst(id);
    window.setTimeout(() => setBurst((b) => (b === id ? 0 : b)), BURST_MS);
    onCommit();
  }, [onCommit, progress, stopHold]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    // Holding a mouse button is not a desktop idiom — and the
    // hold exists to guard a thumb stretching for the arc, which a cursor
    // never does. Fine pointers commit immediately.
    if (event.pointerType === 'mouse') {
      commit();
      return;
    }
    try {
      // Capture so a finger that slides off the button still reports moves.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }
    originRef.current = { x: event.clientX, y: event.clientY };
    milestoneRef.current = 0;
    setShowHint(false);
    setIsHolding(true);
    soundEngine.hapticLight();
    progress.set(0);
    playbackRef.current = animate(progress, 1, {
      duration: holdMs / 1000,
      ease: 'linear',
      onComplete: commit,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const origin = originRef.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.hypot(dx, dy) > SLIP_TOLERANCE) cancelHold();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // Keyboard users get an immediate commit; a hold has no meaning here.
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit();
    }
  };

  useEffect(() => stopHold, [stopHold]);

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onLostPointerCapture={cancelHold}
      onKeyDown={handleKeyDown}
      style={{ scale: reduceMotion ? 1 : pressScale }}
      className={cn(
        isHot && buttonClass('hot', 'lg', true),
        'relative overflow-hidden touch-none select-none',
        className
      )}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {isHot && showHint ? HOLD_HINT_LABEL : isHolding && holdingLabel ? holdingLabel : children}
      </span>

      {showHint && !isHot && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-1 z-10 text-micro font-semibold tracking-widest uppercase opacity-70"
        >
          hold to confirm
        </span>
      )}

      <span className="sr-only" aria-live="polite">
        {showHint ? 'Hold to confirm' : ''}
      </span>

      {!reduceMotion && box.w > 0 && (
        <svg
          className={cn('absolute inset-0 pointer-events-none', isHot && 'text-on-hot', ringClassName)}
          width={box.w}
          height={box.h}
          aria-hidden="true"
        >
          <motion.rect
            x={2}
            y={2}
            width={Math.max(0, box.w - 4)}
            height={Math.max(0, box.h - 4)}
            rx={box.r}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={perimeter}
            style={{ strokeDashoffset: dashOffset, opacity: ringOpacity, filter: ringGlow }}
          />
        </svg>
      )}

      {/* Release pulse — the moment a hold (or an instant mouse commit)
          actually lands, so the button answers back even before onCommit's
          own downstream effects (sound/screen change) land. */}
      <AnimatePresence>
        {!reduceMotion && burst > 0 && (
          <motion.span
            key={burst}
            aria-hidden="true"
            initial={{ opacity: 0.6, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: BURST_MS / 1000, ease: POP_EASE }}
            className="absolute inset-0 pointer-events-none"
            // White, not currentColor/ringClassName — that's a dark
            // *contrast* color for the stroke against a bright button, and
            // a dark flash there would read as a press-down, not a release.
            style={{ borderRadius: 'inherit', backgroundColor: TOKENS.ink.css }}
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
};
