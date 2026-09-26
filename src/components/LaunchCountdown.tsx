import { motion } from 'motion/react';
import { STANDARD } from '../ui/motion';
import React, { useEffect, useState } from 'react';
import { Lock, Rocket } from 'lucide-react';
import { soundEngine } from '../services/audioHaptics';

interface LaunchCountdownProps {
  entryPrice: number;
  direction: string;
  onLaunchComplete: () => void;
}

export const LaunchCountdown: React.FC<LaunchCountdownProps> = ({
  entryPrice,
  direction,
  onLaunchComplete,
}) => {
  const [phase, setPhase] = useState<'locking' | 'charging' | 'liftoff'>('locking');

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
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none bg-black/25 backdrop-blur-[2px]"
    >
      {/* Shockwave expanding ring (PRD §15) */}
      <div className="relative flex items-center justify-center">
        <div className="absolute w-36 h-36 rounded-full border-2 border-[#00FFA3] animate-ring-expand" />
        <div className="absolute w-48 h-48 rounded-full border border-[#00F0FF]/60 animate-ping opacity-40" />

        {/* Center Launch Badge */}
        <div className="relative glass-panel px-6 py-4 rounded-3xl border border-white/20 flex flex-col items-center gap-1.5 shadow-[0_0_40px_rgba(0,255,163,0.35)]">
          <div className="flex items-center gap-2 text-xs font-black tracking-widest text-[#00FFA3] uppercase">
            <Rocket className="w-4 h-4 animate-bounce" />
            <span>
              {phase === 'locking'
                ? 'LOCKING ENTRY...'
                : phase === 'charging'
                ? 'IGNITION SEQUENCE'
                : 'LIFTOFF!'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-xl font-black text-white">
            <Lock className="w-4 h-4 text-[#00F0FF]" />
            <span>${entryPrice.toFixed(2)}</span>
          </div>

          <span className="text-[11px] font-bold text-[#F0B90B] tracking-wider uppercase">
            {direction} POSITION ENGAGED
          </span>
        </div>
      </div>
    </motion.div>
  );
};
