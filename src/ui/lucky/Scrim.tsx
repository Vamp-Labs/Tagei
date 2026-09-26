import React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '../cn';

export type ScrimProps = HTMLMotionProps<'div'> & {
  tone?: 'dim' | 'game' | 'none';
};

export const Scrim = React.forwardRef<HTMLDivElement, ScrimProps>(({ tone = 'dim', className, ...rest }, ref) => (
  <motion.div
    ref={ref}
    className={cn(tone === 'dim' && 'lg-scrim--dim', tone === 'game' && 'lg-scrim--game', className)}
    {...rest}
  />
));
Scrim.displayName = 'Scrim';
