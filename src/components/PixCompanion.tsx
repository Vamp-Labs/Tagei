import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { GameStage, PositionDirection } from '../types/game';
import { MICRO, useMotionPref } from '../ui/motion';
import { PixAvatar } from './pix/PixAvatar';
import { pixMoodFor } from './pix/mood';

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
      say('LONG set. Watching for momentum.', 'dir-long');
    } else if (gameStage === 'PRE_TRADE' && selectedDirection === 'SHORT') {
      say('SHORT set. Watching the downside.', 'dir-short');
    } else if (gameStage === 'LIVE_TRADE' && targetProgressPct >= 90) {
      say('Almost there.', 'near-target', 2000);
    } else if (gameStage === 'LIVE_TRADE' && currentPnl <= -6) {
      say('Approaching stop loss.', 'near-stop', 2400);
    } else if (gameStage === 'TARGET_HIT') {
      say('Nice landing.', 'target-hit', 2400);
    } else if (gameStage === 'LOSS_HIT') {
      say('Stop honored. Good risk control.', 'loss-hit', 2400);
    } else if (gameStage === 'RESULT') {
      say(currentPnl >= 0 ? 'Nice landing.' : "Let's review the tape.", 'result', 2800);
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

  const reduced = useMotionPref();
  const bubbleHidden = reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.94 };

  return (
    <div className="absolute inset-x-0 top-16 z-20 flex flex-col items-center gap-2 pointer-events-none select-none">
      <button
        type="button"
        onClick={onTap}
        aria-label="Open PIX assistant"
        className="pointer-events-auto flex size-12 items-center justify-center rounded-full cursor-pointer"
      >
        <PixAvatar mood={pixMoodFor(currentPnl)} />
      </button>

      <div role="status" aria-live="polite" className="flex justify-center px-6">
        <AnimatePresence mode="wait">
          {speech && (
            <motion.p
              key={speech}
              initial={bubbleHidden}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={bubbleHidden}
              transition={MICRO}
              onClick={onTap}
              className="pointer-events-auto cursor-pointer max-w-[220px] px-3 py-2 rounded-md bg-panel border border-line text-caption text-ink-soft text-center line-clamp-2"
            >
              {speech}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
