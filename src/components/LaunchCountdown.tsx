import { motion } from 'motion/react';
import { STANDARD, useMotionPref } from '../ui/motion';
import React, { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import { soundEngine } from '../services/audioHaptics';
import { DirectionChip, Icon, formatPrice } from '../ui/lucky';

interface LaunchCountdownProps {
  entryPrice: number;
  direction: string;
  onLaunchComplete: () => void;
}

const PHASE_LABEL = {
  locking: 'LOCKING ENTRY…',
  charging: 'IGNITION SEQUENCE',
  liftoff: 'LIFTOFF',
} as const;

const REDUCED_LABEL = 'ENTRY LOCKED';

export const LaunchCountdown: React.FC<LaunchCountdownProps> = ({
  entryPrice,
  direction,
  onLaunchComplete,
}) => {
  const reduced = useMotionPref();
  const [phase, setPhase] = useState<'locking' | 'charging' | 'liftoff'>('locking');
  const chipDirection = direction === 'LONG' || direction === 'SHORT' ? direction : null;

  useEffect(() => {
    soundEngine.playLaunchIgnition();

    const t1 = setTimeout(() => {
      setPhase('charging');
    }, 280);

    const t2 = setTimeout(() => {
      setPhase('liftoff');
      soundEngine.startEngineHum();
    }, 550);

    const t3 = setTimeout(() => {
      onLaunchComplete();
    }, 780);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onLaunchComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={STANDARD}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none bg-canvas/25"
    >
      {/* Shockwave expanding ring (PRD §15) */}
      <div className="relative flex items-center justify-center">
        {!reduced && (
          <div className="absolute w-36 h-36 rounded-full border-2 border-control-ring animate-ring-expand" />
        )}

        <div
          role="status"
          className="relative flex flex-col items-center gap-2 px-6 py-4 rounded-lg bg-panel shadow-lift"
        >
          <div className="flex items-center gap-2 text-micro font-extrabold uppercase tracking-[0.08em] text-lucky">
            <Rocket aria-hidden="true" className="w-4 h-4" />
            <span>{reduced ? REDUCED_LABEL : PHASE_LABEL[phase]}</span>
          </div>

          <div className="flex items-center gap-1.5 text-numeral tabular-nums text-ink">
            <span className="text-ink-muted inline-flex">
              <Icon name="lock" size={18} />
            </span>
            <span>{formatPrice(entryPrice, { unit: 'USDT' })}</span>
          </div>

          <div className="flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {chipDirection ? <DirectionChip direction={chipDirection} size="sm" /> : <span>{direction}</span>}
            <span>position engaged</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
