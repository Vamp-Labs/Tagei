import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { STANDARD, useMotionPref } from '../ui/motion';
import { soundEngine } from '../services/audioHaptics';
import type { PositionDirection } from '../types/game';
import { DirectionChip, Icon, formatPrice } from '../ui/lucky';
import { cn } from '../ui/cn';
import type { LaunchPhase, LaunchView } from './game/liveRoundController';

type LaunchCountdownProps =
  | { variant: 'practice'; entryPrice: number; direction: PositionDirection; onLaunchComplete: () => void }
  | { variant: 'live'; launch: LaunchView; now: () => number };

const PHASE_LABEL: Record<LaunchPhase, string> = {
  locking: 'LOCKING ENTRY…',
  charging: 'IGNITION SEQUENCE',
  liftoff: 'LIFTOFF',
};

const REDUCED_LABEL = 'ENTRY LOCKED';
const PRACTICE_BEATS_MS = { charging: 280, liftoff: 550, done: 780 } as const;
const SLOW_LOCK_MS = 3_000;
const ELAPSED_REFRESH_MS = 500;

function usePracticeTimeline(active: boolean, onDone: () => void): LaunchPhase {
  const [phase, setPhase] = useState<LaunchPhase>('locking');
  useEffect(() => {
    if (!active) return;
    const timers = [
      setTimeout(() => setPhase('charging'), PRACTICE_BEATS_MS.charging),
      setTimeout(() => setPhase('liftoff'), PRACTICE_BEATS_MS.liftoff),
      setTimeout(onDone, PRACTICE_BEATS_MS.done),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, onDone]);
  return phase;
}

function useElapsedSeconds(startedAtMs: number | null, now: () => number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAtMs === null) return;
    const update = () => setElapsed(Math.max(0, now() - startedAtMs));
    update();
    const timer = window.setInterval(update, ELAPSED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [startedAtMs, now]);
  return elapsed;
}

function liveStatus(launch: LaunchView, elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const suffix = elapsedMs >= SLOW_LOCK_MS ? ` · ${seconds} s` : '';
  if (launch.entryPrice !== null) return 'entry price from the on-chain oracle';
  if (!launch.opened) return `${launch.phase === 'locking' ? 'signing and sending your round' : 'relayer is opening your round'}${suffix}`;
  return `round opened · entry locks at the next oracle round${suffix}`;
}

const NOOP = () => undefined;

export const LaunchCountdown: React.FC<LaunchCountdownProps> = (props) => {
  const reduced = useMotionPref();
  const isLive = props.variant === 'live';
  const practicePhase = usePracticeTimeline(!isLive, isLive ? NOOP : props.onLaunchComplete);
  const phase = isLive ? props.launch.phase : practicePhase;
  const direction = isLive ? props.launch.direction : props.direction;
  const elapsed = useElapsedSeconds(isLive ? props.launch.startedAtMs : null, isLive ? props.now : Date.now);

  const lockedPrice = isLive ? props.launch.entryPrice : props.entryPrice;
  const predicted = isLive ? props.launch.predictedEntry : null;
  const shownPrice = lockedPrice ?? predicted;
  const locked = lockedPrice !== null;

  useEffect(() => {
    soundEngine.playLaunchIgnition();
  }, []);

  useEffect(() => {
    if (phase === 'liftoff') soundEngine.startEngineHum();
  }, [phase]);

  const label = isLive
    ? locked
      ? REDUCED_LABEL
      : PHASE_LABEL[phase]
    : reduced
      ? REDUCED_LABEL
      : PHASE_LABEL[phase];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={STANDARD}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none bg-canvas/25"
    >
      <div className="relative flex items-center justify-center">
        {!reduced && (phase === 'liftoff' || !isLive) && (
          <div className="absolute w-36 h-36 rounded-full border-2 border-control-ring animate-ring-expand" />
        )}

        <div
          role="status"
          aria-live="polite"
          className="relative flex flex-col items-center gap-2 px-6 py-4 rounded-lg bg-panel shadow-lift"
        >
          <div className="flex items-center gap-2 text-micro font-extrabold uppercase tracking-[0.08em] text-lucky">
            <Icon name="rocket" size={16} />
            <span>{label}</span>
          </div>

          {shownPrice !== null && (
            <div className={cn('flex items-center gap-1.5 text-numeral tabular-nums', locked ? 'text-ink' : 'text-ink-muted')}>
              <span className="text-ink-muted inline-flex">
                {locked ? <Icon name="lock" size={18} /> : <span aria-hidden="true">≈</span>}
              </span>
              <span>
                {!locked && <span className="sr-only">predicted entry about </span>}
                {formatPrice(shownPrice, { unit: 'USDT' })}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <DirectionChip direction={direction} size="sm" />
            <span>{locked ? 'position engaged' : 'predicted entry'}</span>
          </div>

          {isLive && <p className="text-micro tabular-nums text-ink-muted">{liveStatus(props.launch, elapsed)}</p>}
        </div>
      </div>
    </motion.div>
  );
};
