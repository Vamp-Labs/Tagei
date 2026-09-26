import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Target, Sparkles, CheckCircle2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundEngine } from '../services/audioHaptics';
import { STANDARD } from '../ui/motion';

interface MissionToastProps {
  isOpen: boolean;
  roundsPlayed: number;
  roundsGoal: number;
  xpBonus?: number;
  onDismiss: () => void;
}

export const MissionToast: React.FC<MissionToastProps> = ({
  isOpen,
  roundsPlayed,
  roundsGoal,
  xpBonus = 50,
  onDismiss,
}) => {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      hasFiredRef.current = false;
      return;
    }

    // Only fire confetti and sound once when opened
    if (!hasFiredRef.current) {
      hasFiredRef.current = true;
      soundEngine.playLevelUp();

      // Mini gold coin & emerald spark confetti burst (strictly once)
      confetti({
        particleCount: 30,
        spread: 60,
        origin: { y: 0.15 },
        colors: ['#F0B90B', '#00FFA3', '#FFFFFF'],
      });
    }

    const timer = setTimeout(() => {
      onDismissRef.current();
    }, 3200);

    return () => clearTimeout(timer);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="mission-toast"
          initial={{ opacity: 0, x: '-50%', y: -28, scale: 0.95 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, x: '-50%', y: -28, scale: 0.95 }}
          transition={STANDARD}
          drag="y"
          dragSnapToOrigin
          dragElastic={0.2}
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_, info) => {
            if (info.offset.y < -48 || info.velocity.y < -500) onDismiss();
          }}
          className="fixed left-1/2 z-50 pointer-events-auto max-w-sm w-[92%] cursor-grab active:cursor-grabbing"
          style={{ top: 'calc(var(--sa-top) + 4.75rem)' }}
        >
      <div className="px-4 py-3 rounded-2xl bg-[#070b19]/90 border border-[#F0B90B]/50 backdrop-blur-xl shadow-[0_0_25px_rgba(240,185,11,0.35)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#F0B90B] to-[#FFD700] flex items-center justify-center text-black shadow-md flex-shrink-0">
            <Target className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black tracking-wider text-[#F0B90B] uppercase font-mono">
                MISSION COMPLETE!
              </span>
              <Sparkles className="w-3 h-3 text-[#00FFA3] animate-pulse" />
            </div>
            <div className="text-[11px] font-bold text-gray-300">
              Completed {roundsPlayed}/{roundsGoal} Rounds •{' '}
              <span className="text-[#00FFA3]">+{xpBonus} XP Bonus</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[#00FFA3] text-xs font-mono font-bold flex-shrink-0">
          <CheckCircle2 className="w-4 h-4" />
          <span>DONE</span>
        </div>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
