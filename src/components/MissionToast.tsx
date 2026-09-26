import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { soundEngine } from '../services/audioHaptics';
import { MICRO, STANDARD, useMotionPref } from '../ui/motion';
import { Badge, formatXp } from '../ui/lucky';
import { OutcomeArt } from './outcome/OutcomeArt';

interface MissionToastProps {
  isOpen: boolean;
  roundsPlayed: number;
  roundsGoal: number;
  xpBonus?: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3200;
const SWIPE_DISMISS_PX = 48;
const SWIPE_DISMISS_VELOCITY = 500;
const CHECK_POP_DELAY_SECONDS = 0.15;
const GIFT_PX = 44;

export const MissionToast: React.FC<MissionToastProps> = ({
  isOpen,
  roundsPlayed,
  roundsGoal,
  xpBonus = 50,
  onDismiss,
}) => {
  const reduced = useMotionPref();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      hasFiredRef.current = false;
      return;
    }

    if (!hasFiredRef.current) {
      hasFiredRef.current = true;
      soundEngine.playLevelUp();
    }

    const timer = setTimeout(() => {
      onDismissRef.current();
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="mission-toast"
          role="status"
          initial={{ opacity: 0, x: '-50%', y: -28, scale: 0.95 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, x: '-50%', y: -28, scale: 0.95 }}
          transition={STANDARD}
          drag="y"
          dragSnapToOrigin
          dragElastic={0.2}
          dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_, info) => {
            if (info.offset.y < -SWIPE_DISMISS_PX || info.velocity.y < -SWIPE_DISMISS_VELOCITY) onDismiss();
          }}
          className="fixed left-1/2 z-50 pointer-events-auto max-w-sm w-[92%] cursor-grab active:cursor-grabbing"
          style={{ top: 'calc(var(--sa-top) + 0.5rem)' }}
        >
          <div className="lg-card rounded-lg flex items-center gap-3 p-3 pr-4">
            <OutcomeArt name="reward-gift" height={GIFT_PX} />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-bold uppercase tracking-[0.08em] text-lucky">DAILY MISSION</p>
              <p className="text-label font-bold text-ink">Mission Complete</p>
              <p className="text-micro tabular-nums text-ink-muted">
                {roundsPlayed}/{roundsGoal} rounds ·{' '}
                <span className="font-bold text-lucky">{formatXp(xpBonus, { sign: 'always' })} bonus</span>
              </p>
            </div>
            <motion.span
              initial={reduced ? undefined : { scale: 0, opacity: 0 }}
              animate={reduced ? undefined : { scale: 1, opacity: 1 }}
              transition={{ ...MICRO, delay: CHECK_POP_DELAY_SECONDS }}
              className="shrink-0 inline-flex"
            >
              <Badge tone="check" label="Mission complete" className="w-7 h-7" />
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
