import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Trophy, ShieldAlert } from 'lucide-react';
import { GameStage } from '../types/game';
import { HERO, MICRO } from '../ui/motion';

interface OutcomeBannerOverlayProps {
  gameStage: GameStage;
  pnl: number;
  multiplier: number;
}

/** Punchy overshoot pop — same ease LiveTradeOverlay's P&L "juice" uses. */
const POP_EASE = [0.34, 1.56, 0.64, 1] as const;

const winChildVariants = {
  hidden: { opacity: 0, y: 10, scale: 0.85 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: POP_EASE } },
};

export const OutcomeBannerOverlay: React.FC<OutcomeBannerOverlayProps> = ({
  gameStage,
  pnl,
  multiplier,
}) => {
  const isVisible = gameStage === 'TARGET_HIT' || gameStage === 'LOSS_HIT';
  const isWin = gameStage === 'TARGET_HIT';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={gameStage}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: MICRO }}
          exit={{ opacity: 0, transition: MICRO }}
          className="absolute inset-0 z-35 flex flex-col items-center justify-center pointer-events-none"
        >
          {isWin ? (
            <motion.div
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0, scale: 1.08, transition: MICRO }}
              variants={{
                hidden: { opacity: 0, scale: 0.7, y: 24 },
                visible: {
                  opacity: 1,
                  scale: 1,
                  y: 0,
                  transition: { ...HERO, staggerChildren: 0.07, delayChildren: 0.05 },
                },
              }}
              className="relative flex flex-col items-center text-center"
            >
              {/* A momentary bloom behind the whole badge stack — separate
                  from the badge's own steady .glow-green box-shadow, and
                  from the canvas's own radial flash underneath the DOM
                  layer, so this reads as one continuation of that flash
                  rather than a second, competing burst. */}
              <motion.div
                aria-hidden="true"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0.55, 0.22], scale: [0.6, 1.25, 1.05] }}
                transition={{ duration: 0.55, times: [0, 0.35, 1], ease: 'easeOut' }}
                className="absolute -inset-10 rounded-full pointer-events-none"
                style={{
                  background:
                    'radial-gradient(circle, var(--color-long) 0%, transparent 70%)',
                  filter: 'blur(18px)',
                }}
              />

              {/* Opaque card behind the badge/number/subtext — the canvas's
                  own win flash (MarketTrackCanvas boomRef) peaks near-white
                  at 95% alpha in the same hue as this text, so a same-color
                  glow alone doesn't hold contrast. This reuses the exact
                  --color-panel + backdrop-blur pattern LiveTradeOverlay's
                  HUD pills, ResultPanel, and SettlementOverlay already use
                  for legibility over the canvas — sized to its content, not
                  the full screen, so the rocket/market track stay visible
                  around it (PRD §20: "avoid covering the entire UI"). */}
              <div className="relative glass-panel rounded-[var(--radius-xl)] px-8 py-6 flex flex-col items-center">
                {/* Glowing Target Hit Badge */}
                <motion.div
                  variants={winChildVariants}
                  className="relative flex items-center gap-2 px-5 py-2 rounded-full border-2 glow-green mb-2"
                  style={{
                    backgroundColor: 'rgba(0,232,154,0.18)',
                    borderColor: 'var(--color-long)',
                  }}
                >
                  <Trophy className="w-5 h-5" style={{ color: 'var(--color-long)' }} />
                  <span
                    className="text-sm font-black tracking-widest uppercase font-mono"
                    style={{ color: 'var(--color-long)' }}
                  >
                    TARGET HIT! WIN
                  </span>
                </motion.div>

                <motion.div
                  variants={winChildVariants}
                  className="relative text-5xl font-black font-mono text-glow-green tracking-tight"
                  style={{ color: 'var(--color-long)' }}
                >
                  +${pnl.toFixed(2)}
                </motion.div>
                <motion.div
                  variants={winChildVariants}
                  className="relative text-sm font-black font-mono text-white mt-1"
                >
                  +{multiplier.toFixed(1)}x PAYOUT
                </motion.div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: HERO }}
              exit={{ opacity: 0, scale: 0.96, transition: MICRO }}
              className="flex flex-col items-center text-center"
            >
              {/* Same legibility card as the win branch (see its comment) —
                  the loss subtext previously had zero shadow/backdrop at
                  all, the least protected text in the component. */}
              <div className="glass-panel rounded-[var(--radius-xl)] px-8 py-6 flex flex-col items-center">
                {/* Gentle Round Complete Badge — restrained per PRD §22, no
                    bounce/glow-pulse; a clear, dignified outcome, not a
                    bigger effect than the win state. */}
                <div
                  className="flex items-center gap-2 px-5 py-2 rounded-full border glow-magenta-sm mb-2"
                  style={{
                    backgroundColor: 'rgba(255,59,107,0.14)',
                    borderColor: 'var(--color-short)',
                  }}
                >
                  <ShieldAlert className="w-5 h-5" style={{ color: 'var(--color-short)' }} />
                  <span
                    className="text-sm font-black tracking-widest uppercase font-mono"
                    style={{ color: 'var(--color-short)' }}
                  >
                    ROUND COMPLETE
                  </span>
                </div>

                <div
                  className="text-4xl font-black font-mono text-glow-magenta tracking-tight"
                  style={{ color: 'var(--color-short)' }}
                >
                  -${Math.abs(pnl).toFixed(2)}
                </div>
                <div className="text-xs font-semibold mt-1 font-mono text-[color:var(--color-text-3)]">
                  Stop Loss Threshold Honored
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
