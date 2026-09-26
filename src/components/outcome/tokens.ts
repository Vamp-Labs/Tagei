import type { Transition } from 'motion/react';

export const POP_EASE = [0.34, 1.56, 0.64, 1] as const;
export const POP_SECONDS = 0.32;
export const POP: Transition = { duration: POP_SECONDS, ease: POP_EASE };

export const REDUCED_FADE: Transition = { duration: 0.2, ease: 'easeOut' };

export const GLYPH_STROKE = 2.4;
