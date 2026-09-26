import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Clock } from 'lucide-react';
import { ActiveTradeRound } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { EASE_OUT, MICRO, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { Button, DirectionChip, Icon, Pill, ROLE, formatAmount, formatTimer, signOf } from '../ui/lucky';

interface LiveTradeOverlayProps {
  round: ActiveTradeRound;
  targetProgressPct: number;
  autoResolveEnabled?: boolean;
  onCashOut: () => void;
  onTimeout: () => void;
  onOpenPositionDetails: () => void;
  /** The engine's real, fixed leverage — see settlementEngine.ts. */
  leverage: number;
}

const POP_EASE = [0.34, 1.56, 0.64, 1] as const;
const TIMER_WARN_SECONDS = 5;
const pnlTone = (value: number) => (signOf(value) < 0 ? ROLE.loss.css : ROLE.profit.css);

/**
 * docs/UI_UX_SPEC.md §4. Show only LIVE state, countdown, entry point (via
 * the canvas track, not this panel), current P&L, direction+leverage, and
 * the cash-out CTA. Full entry price, target, stop, liquidation, stake and
 * raw multiplier are hidden by default — they live behind "Position details".
 */
export const LiveTradeOverlay: React.FC<LiveTradeOverlayProps> = ({
  round,
  targetProgressPct,
  autoResolveEnabled = true,
  onCashOut,
  onTimeout,
  onOpenPositionDetails,
  leverage,
}) => {
  const reduced = useMotionPref();
  const [timeLeft, setTimeLeft] = useState<number>(round.durationSeconds);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [pulseOnMount] = useState(() => round.currentPnl >= 0);

  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const timeoutFiredRef = useRef(false);

  // --- P&L "juice" ---------------------------------------------------
  // The number glides (a spring-tweened MotionValue rendered straight into
  // the DOM, never through React state), pops on meaningful moves, and
  // throws off a brief floating "+0.12"/"−0.08" beside itself.
  const pnlMV = useMotionValue(round.currentPnl);
  const pnlText = useTransform(pnlMV, (v) => formatAmount(v, null));
  const pnlColor = useTransform(pnlMV, pnlTone);
  const scaleMV = useMotionValue(1);

  const prevPnlRef = useRef(round.currentPnl);
  const popIdRef = useRef(0);
  const lastPopAtRef = useRef(0);
  const [deltaPops, setDeltaPops] = useState<{ id: number; delta: number }[]>([]);

  useEffect(() => {
    const delta = round.currentPnl - prevPnlRef.current;
    prevPnlRef.current = round.currentPnl;

    if (reduced) {
      pnlMV.set(round.currentPnl);
    } else {
      animate(pnlMV, round.currentPnl, { type: 'spring', stiffness: 260, damping: 26, mass: 0.6 });
    }

    // Gate the rest (pop, floating delta, haptic) on a meaningful move — the
    // mock feed ticks ~4x/sec and most deltas are a few cents; without a
    // floor this would spawn combat text and buzz haptics constantly.
    const MEANINGFUL_DELTA = 0.05;
    if (Math.abs(delta) < MEANINGFUL_DELTA) return;

    // A cooldown on top of the delta floor — otherwise a volatile stretch
    // (several qualifying ticks within a couple hundred ms) throws off a
    // new pop on nearly every one, and they read as a pile-up rather than
    // individually legible events.
    const now = performance.now();
    if (now - lastPopAtRef.current < 400) return;
    lastPopAtRef.current = now;

    const gained = delta > 0;
    if (!reduced) {
      animate(scaleMV, [1, gained ? 1.1 : 1.05, 1], {
        duration: 0.32,
        ease: gained ? POP_EASE : EASE_OUT,
      });
    }

    const id = ++popIdRef.current;
    setDeltaPops((prev) => [...prev.slice(-2), { id, delta }]);
    window.setTimeout(() => {
      setDeltaPops((prev) => prev.filter((p) => p.id !== id));
    }, 700);

    soundEngine.hapticLight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.currentPnl]);

  // Aura intensity scales with position size — capped so a huge swing
  // doesn't overwhelm the panel, floored so a fresh 0.00 round isn't dark.

  // The flight HUD belongs at the top of the track, but the timer that drives
  // it lives here. A portal keeps one instance — and therefore one countdown —
  // while placing the markup in the glanceable tier.
  useEffect(() => {
    setStage(document.getElementById('track-stage'));
  }, []);

  // Countdown timer (PRD §25): the updater only decrements, because StrictMode double-invokes updaters.
  useEffect(() => {
    if (!autoResolveEnabled) return;
    const timer = window.setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoResolveEnabled]);

  useEffect(() => {
    if (!autoResolveEnabled || timeLeft > 0 || timeoutFiredRef.current) return;
    timeoutFiredRef.current = true;
    onTimeoutRef.current();
  }, [timeLeft, autoResolveEnabled]);

  // Near target sound cues at 75% and 90% (PRD §19)
  useEffect(() => {
    if (targetProgressPct >= 90) {
      soundEngine.playNearTargetTone(1.0);
    } else if (targetProgressPct >= 75) {
      soundEngine.playNearTargetTone(0.6);
    }
  }, [targetProgressPct]);

  const timerWarn = autoResolveEnabled && timeLeft <= TIMER_WARN_SECONDS;

  const flightHud = (
    <div className="absolute top-3 left-6 right-6 z-20 flex items-center justify-between pointer-events-none max-w-md mx-auto">
      <Pill
        className="bg-panel text-ink font-extrabold"
        icon={
          <span
            aria-hidden="true"
            className={cn('lg-pill-dot text-lucky', !reduced && 'lg-pill-dot--pulse')}
          />
        }
      >
        {round.asset} · LIVE
      </Pill>

      <span role="timer" aria-label={autoResolveEnabled ? `Time left ${formatTimer(timeLeft)}` : 'No time limit'}>
        <Pill
          className={cn('bg-panel', timerWarn ? 'text-ink font-bold' : 'text-ink-soft font-semibold')}
          icon={<Clock aria-hidden="true" className={cn('w-3.5 h-3.5', timerWarn ? 'text-ink' : 'text-ink-muted')} />}
        >
          {autoResolveEnabled ? formatTimer(timeLeft) : '∞'}
        </Pill>
      </span>
    </div>
  );

  return (
    <>
      {stage && createPortal(flightHud, stage)}

      <div className="w-full flex flex-col select-none pt-1 pb-3">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="relative">
            <motion.div
              className="relative flex items-baseline gap-1.5 whitespace-nowrap tabular-nums"
              style={{ color: pnlColor, scale: scaleMV }}
            >
              <motion.span className="text-display">{pnlText}</motion.span>
              <span className="text-label font-bold">USDT</span>
            </motion.div>

            <div className="absolute top-0 left-full ml-2 pointer-events-none">
              <AnimatePresence>
                {deltaPops.map((pop) => (
                  <motion.span
                    key={pop.id}
                    initial={{ opacity: 0, y: 4, x: -4 }}
                    // Quick pop in (MICRO), then it sits at rest — how long
                    // it's visible is governed by the 700ms removal timeout.
                    animate={{ opacity: 1, y: -14, x: 0, transition: MICRO }}
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    className={cn(
                      'absolute top-0 left-0 whitespace-nowrap text-micro font-bold tabular-nums',
                      pop.delta > 0 ? 'text-profit' : 'text-loss'
                    )}
                  >
                    {formatAmount(pop.delta, null)}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <DirectionChip direction={round.direction} leverage={leverage} className="shrink-0" />
        </div>

        <HoldButton
          variant="hot"
          onCommit={onCashOut}
          ariaLabel="Hold to cash out"
          holdingLabel={<span>HOLDING…</span>}
          className={cn('h-14', pulseOnMount && !reduced && 'lg-pulse-hot')}
        >
          <span>HOLD TO CASH OUT!</span>
        </HoldButton>

        <Button
          variant="ghost"
          size="md"
          onClick={onOpenPositionDetails}
          className="mt-1 self-center gap-1"
        >
          Position details
          <Icon name="chevron-right" size={18} />
        </Button>
      </div>
    </>
  );
};
