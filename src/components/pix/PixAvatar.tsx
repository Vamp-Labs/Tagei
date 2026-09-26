import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { useMotionPref } from '../../ui/motion';
import type { PixMood } from './mood';

export interface PixAvatarProps {
  mood: PixMood;
  size?: number;
  className?: string;
}

const BLINK_CYCLE_SECONDS = 4.2;
const BLINK_KEYFRAMES = [1, 1, 0.1, 1];
const BLINK_TIMES = [0, 0.93, 0.965, 1];

const RING_CLASS: Record<PixMood, string> = {
  happy: 'ring-lucky',
  neutral: 'ring-line',
  concerned: 'ring-amber',
};

const MOUTH_PATH: Record<PixMood, string> = {
  happy: 'M13 23.5Q20 31 27 23.5',
  neutral: 'M14.5 25Q20 28.5 25.5 25',
  concerned: 'M14.5 27.5Q20 23.5 25.5 27.5',
};

const Eyes: React.FC<{ mood: PixMood }> = ({ mood }) =>
  mood === 'happy' ? (
    <>
      <path d="M11.5 18.5Q14 14.5 16.5 18.5" />
      <path d="M23.5 18.5Q26 14.5 28.5 18.5" />
    </>
  ) : (
    <>
      <circle cx="14" cy="17" r="2.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="17" r="2.4" fill="currentColor" stroke="none" />
    </>
  );

export const PixAvatar: React.FC<PixAvatarProps> = ({ mood, size = 40, className }) => {
  const reduced = useMotionPref();

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-tile ring-2 text-ink', RING_CLASS[mood], className)}
      style={{ width: size, height: size }}
      data-mood={mood}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={reduced ? { scaleY: 1 } : { scaleY: BLINK_KEYFRAMES }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: BLINK_CYCLE_SECONDS, times: BLINK_TIMES, repeat: Infinity, ease: 'easeInOut' }
          }
        >
          <Eyes mood={mood} />
        </motion.g>
        <path d={MOUTH_PATH[mood]} />
      </svg>
    </span>
  );
};
