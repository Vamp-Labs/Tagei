import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { MICRO, useMotionPref } from '../../ui/motion';
import type { PositionDirection } from '../../types/game';
import { FoxFace } from './FoxFace';
import type { PixExpression } from './expressions';
import type { PixMood } from './mood';

export interface PixAvatarProps {
  mood: PixMood;
  size?: number;
  className?: string;
  expression?: PixExpression;
  direction?: PositionDirection | null;
}

const RING_CLASS: Record<PixMood, string> = {
  happy: 'ring-lucky',
  neutral: 'ring-line',
  concerned: 'ring-loss',
};

const DEFAULT_EXPRESSION: Record<PixMood, PixExpression> = {
  happy: 'happy',
  neutral: 'idle',
  concerned: 'concerned',
};

export const PixAvatar: React.FC<PixAvatarProps> = ({ mood, size = 40, className, expression, direction }) => {
  const reduced = useMotionPref();
  const resolvedExpression = expression ?? DEFAULT_EXPRESSION[mood];

  return (
    <motion.span
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-tile ring-2', RING_CLASS[mood], className)}
      style={{ width: size, height: size }}
      data-mood={mood}
      data-expression={resolvedExpression}
      aria-hidden="true"
      whileTap={reduced ? undefined : { scale: 0.94 }}
      transition={MICRO}
    >
      <FoxFace expression={resolvedExpression} direction={direction} />
    </motion.span>
  );
};
