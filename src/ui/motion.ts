import { useSyncExternalStore } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import type { Transition, Variants } from 'motion/react';

export const useMotionPref = () => !!useReducedMotionConfig();

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const readReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCE_QUERY).matches;

export const usePrefersReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);

/**
 * Spring tokens mapped onto the PRD §32 motion tiers. Every DOM animation
 * in the app picks one of these three rather than inventing a duration.
 */

/** 100–200 ms — button presses, number changes, chip selections. */
export const MICRO: Transition = { type: 'spring', stiffness: 700, damping: 30, mass: 0.5 };

/** 250–450 ms — panel transitions, asset change, Long/Short selection. */
export const STANDARD: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

/** 600–1200 ms — rocket launch, target hit, result reveal, level up. */
export const HERO: Transition = { type: 'spring', stiffness: 180, damping: 22, mass: 1.1 };

/** Matches the cubic-bezier already used by the hand-written keyframes. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const scrimVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** Modal cards: rise and scale in, fall away on exit. */
export const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 24 },
};

/** Staggered container for hero content. */
export const staggerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const staggerChildVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

/** Distance and velocity past which a drag counts as a dismissal. */
export const DISMISS_OFFSET = 120;
export const DISMISS_VELOCITY = 500;
