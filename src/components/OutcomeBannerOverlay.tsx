import React from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { GameStage } from '../types/game';
import { HERO, MICRO, useMotionPref } from '../ui/motion';
import { SignedAmount, formatMultiplier } from '../ui/lucky';
import { OutcomeArt } from './outcome/OutcomeArt';
import { POP, REDUCED_FADE } from './outcome/tokens';

interface OutcomeBannerOverlayProps {
  gameStage: GameStage;
  pnl: number;
  multiplier: number;
}

const WIN_STAGGER_SECONDS = 0.07;
const WIN_DELAY_SECONDS = 0.05;
const BLOOM_SECONDS = 0.55;

const winCardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.7, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { ...HERO, staggerChildren: WIN_STAGGER_SECONDS, delayChildren: WIN_DELAY_SECONDS },
  },
};

const winChildVariants: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.85 },
  visible: { opacity: 1, y: 0, scale: 1, transition: POP },
};

const CARD_CLASS = 'lg-card relative flex flex-col items-center bg-sheet shadow-lift px-8 py-6 text-center';

export const OutcomeBannerOverlay: React.FC<OutcomeBannerOverlayProps> = ({
  gameStage,
  pnl,
  multiplier,
}) => {
  const reduced = useMotionPref();
  const isVisible = gameStage === 'TARGET_HIT' || gameStage === 'LOSS_HIT';
  const isWin = gameStage === 'TARGET_HIT';
  const childVariants = reduced ? undefined : winChildVariants;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={gameStage}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: reduced ? REDUCED_FADE : MICRO }}
          exit={{ opacity: 0, transition: MICRO }}
          className="absolute inset-0 z-35 flex flex-col items-center justify-center px-6 pointer-events-none"
        >
          {isWin ? (
            <motion.div
              role="status"
              initial={reduced ? { opacity: 0 } : 'hidden'}
              animate={reduced ? { opacity: 1, transition: REDUCED_FADE } : 'visible'}
              exit={{ opacity: 0, scale: reduced ? 1 : 1.08, transition: MICRO }}
              variants={reduced ? undefined : winCardVariants}
              className="relative flex flex-col items-center"
            >
              {!reduced && (
                <motion.div
                  aria-hidden="true"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: [0, 0.55, 0.22], scale: [0.6, 1.25, 1.05] }}
                  transition={{ duration: BLOOM_SECONDS, times: [0, 0.35, 1], ease: 'easeOut' }}
                  className="absolute -inset-10 rounded-full pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle, var(--color-lucky) 0%, transparent 70%)',
                    filter: 'blur(18px)',
                  }}
                />
              )}

              <div className={CARD_CLASS}>
                <motion.div variants={childVariants}>
                  <OutcomeArt name="reward-crown" />
                </motion.div>
                <motion.p
                  variants={childVariants}
                  className="mt-3 text-label font-extrabold uppercase tracking-[0.08em] text-lucky"
                >
                  TARGET HIT
                </motion.p>
                <motion.p variants={childVariants} className="mt-1">
                  <SignedAmount value={pnl} className="text-display" />
                </motion.p>
                <motion.p variants={childVariants} className="mt-1 text-caption tabular-nums text-ink-soft">
                  {formatMultiplier(multiplier)} payout
                </motion.p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              role="status"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={reduced ? { opacity: 1, transition: REDUCED_FADE } : { opacity: 1, y: 0, transition: HERO }}
              exit={{ opacity: 0, transition: MICRO }}
              className={CARD_CLASS}
            >
              <p className="text-label font-bold uppercase tracking-[0.08em] text-ink-soft">ROUND COMPLETE</p>
              <p className="mt-1">
                <SignedAmount value={pnl} className="text-display" />
              </p>
              <p className="mt-1 text-caption text-ink-muted">Stop loss reached as planned.</p>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
