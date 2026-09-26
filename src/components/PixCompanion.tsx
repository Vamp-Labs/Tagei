import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { GameStage, PositionDirection } from '../types/game';
import { MICRO } from '../ui/motion';

interface PixCompanionProps {
  gameStage: GameStage;
  targetProgressPct: number;
  currentPnl: number;
  selectedDirection: PositionDirection | null;
  onTap: () => void;
}

/**
 * docs/DESIGN_TOKENS.md's PIX bubble rule: "max 1-2 lines, disappears
 * automatically, use only for meaningful events, avoid constant chatter."
 * The old version had a line for every GameStage with a default fallback,
 * so something showed at all times the app was mounted. This version only
 * speaks on discrete events — direction picked, target approaching,
 * resolved — and auto-dismisses, using the same setTimeout pattern already
 * proven in MissionToast.tsx.
 */
export const PixCompanion: React.FC<PixCompanionProps> = ({
  gameStage,
  targetProgressPct,
  currentPnl,
  selectedDirection,
  onTap,
}) => {
  const [speech, setSpeech] = useState<string | null>(null);
  const lastEventRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  const say = (line: string, key: string, ms = 3200) => {
    if (lastEventRef.current === key) return;
    lastEventRef.current = key;
    setSpeech(line);
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => setSpeech(null), ms);
  };

  useEffect(() => {
    if (gameStage === 'PRE_TRADE' && selectedDirection === 'LONG') {
      say('LONG chosen — momentum looks prime.', 'dir-long');
    } else if (gameStage === 'PRE_TRADE' && selectedDirection === 'SHORT') {
      say('SHORT locked — riding the downside.', 'dir-short');
    } else if (gameStage === 'LIVE_TRADE' && targetProgressPct >= 90) {
      say('Almost there!', 'near-target', 2000);
    } else if (gameStage === 'LIVE_TRADE' && currentPnl <= -6) {
      say('Approaching stop loss.', 'near-stop', 2400);
    } else if (gameStage === 'TARGET_HIT') {
      say('Nice landing! 🎯', 'target-hit', 2400);
    } else if (gameStage === 'LOSS_HIT') {
      say('Stop honored. Good risk control.', 'loss-hit', 2400);
    } else if (gameStage === 'RESULT') {
      say(currentPnl >= 0 ? 'Nice landing!' : "Let's review the tape.", 'result', 2800);
    }

    if (gameStage === 'HOME' || gameStage === 'PRE_TRADE') {
      // Leaving these stages without a direction picked clears the memory of
      // the direction event, so re-entering PRE_TRADE can speak again.
      if (gameStage === 'HOME') lastEventRef.current = null;
    }
  }, [gameStage, targetProgressPct, currentPnl, selectedDirection]);

  useEffect(() => () => {
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
  }, []);

  const eyes = currentPnl >= 4 ? '★‿★' : currentPnl < -2.5 ? '•︵•' : '•‿•';

  return (
    <button
      onClick={onTap}
      aria-label="Open PIX AI"
      className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-auto select-none cursor-pointer"
    >
      <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[color:var(--color-panel)] border border-[color:var(--color-line)] flex items-center justify-center">
        <span className="font-mono text-[10px] font-bold text-[color:var(--color-text-1)]">{eyes}</span>
      </div>

      <AnimatePresence mode="wait">
        {speech && (
          <motion.div
            key={speech}
            initial={{ opacity: 0, y: -4, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.94 }}
            transition={MICRO}
            className="max-w-[200px] px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[color:var(--color-panel)] border border-[color:var(--color-line)]"
          >
            <p className="text-[length:var(--text-micro)] font-medium text-[color:var(--color-text-1)] leading-tight">
              {speech}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
};
