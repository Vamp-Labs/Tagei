import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { ActiveTradeRound } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { EASE_OUT, MICRO, POP_EASE, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { Button, DirectionChip, Icon, Pill, ROLE, formatAmount, formatPrice, formatTimer, signOf } from '../ui/lucky';
import type { CashOutView } from './game/liveRoundController';
import { LEGACY_LEVERAGE, isLaneRound, leverageText } from './game/roundDisplay';
import { useCountdown } from './game/useCountdown';

interface LiveTradeOverlayProps {
  round: ActiveTradeRound;
  targetProgressPct: number;
  autoResolveEnabled?: boolean;
  onCashOut: () => void;
  onOpenPositionDetails: () => void;
  endMs: number | null;
  now: () => number;
  cashOut?: CashOutView;
}

const TIMER_WARN_SECONDS = 5;
const NEAR_TARGET_PCT = [98, 90, 75] as const;
const NEAR_TARGET_INTENSITY: Record<(typeof NEAR_TARGET_PCT)[number], number> = { 98: 1, 90: 1, 75: 0.6 };
const IDLE_CASH_OUT: CashOutView = { phase: 'none', snapshotPnl: null, snapshotPrice: null, exitPrice: null };
const pnlTone = (value: number) => (signOf(value) < 0 ? ROLE.loss.css : ROLE.profit.css);

export const LiveTradeOverlay: React.FC<LiveTradeOverlayProps> = ({
  round,
  targetProgressPct,
  autoResolveEnabled = true,
  onCashOut,
  onOpenPositionDetails,
  endMs,
  now,
  cashOut = IDLE_CASH_OUT,
}) => {
  const reduced = useMotionPref();
  const timeLeft = useCountdown(autoResolveEnabled ? endMs : null, now);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [pulseOnMount] = useState(() => round.currentPnl >= 0);
  const frozen = cashOut.phase !== 'none';
  const shownPnl = frozen && cashOut.snapshotPnl !== null ? cashOut.snapshotPnl : round.currentPnl;

  const pnlMV = useMotionValue(shownPnl);
  const pnlText = useTransform(pnlMV, (v) => formatAmount(v, null));
  const pnlColor = useTransform(pnlMV, pnlTone);
  const scaleMV = useMotionValue(1);

  const popIdRef = useRef(0);
  const lastPopAtRef = useRef(0);
  const [deltaPops, setDeltaPops] = useState<{ id: number; delta: number }[]>([]);

  const prevPnlRef = useRef(shownPnl);

  useEffect(() => {
    const delta = shownPnl - prevPnlRef.current;
    prevPnlRef.current = shownPnl;

    if (reduced || frozen) {
      pnlMV.set(shownPnl);
    } else {
      animate(pnlMV, shownPnl, { type: 'spring', stiffness: 260, damping: 26, mass: 0.6 });
    }

    const MEANINGFUL_DELTA = 0.05;
    if (frozen || Math.abs(delta) < MEANINGFUL_DELTA) return;

    const at = performance.now();
    if (at - lastPopAtRef.current < 400) return;
    lastPopAtRef.current = at;

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
  }, [shownPnl, frozen, reduced, pnlMV, scaleMV]);

  useEffect(() => {
    setStage(document.getElementById('track-stage'));
  }, []);

  const cueRef = useRef(0);
  useEffect(() => {
    const reached = NEAR_TARGET_PCT.find((pct) => targetProgressPct >= pct) ?? 0;
    if (reached > cueRef.current) soundEngine.playNearTargetTone(NEAR_TARGET_INTENSITY[reached as keyof typeof NEAR_TARGET_INTENSITY]);
    cueRef.current = reached;
  }, [targetProgressPct]);

  const timerWarn = timeLeft !== null && timeLeft <= TIMER_WARN_SECONDS;
  const timerText = timeLeft === null ? '∞' : formatTimer(timeLeft);
  const lane = isLaneRound(round);
  const cashOutLabel =
    cashOut.phase === 'locked' ? 'EXIT LOCKED' : cashOut.phase === 'none' ? 'HOLD TO CASH OUT!' : 'CASHING OUT…';
  const cashOutNote =
    cashOut.phase === 'locked' && cashOut.exitPrice !== null
      ? `EXIT LOCKED ${formatPrice(cashOut.exitPrice, { unit: 'USDT' })}`
      : cashOut.phase === 'requested'
        ? 'cash-out requested · exit locks at the next oracle round'
        : cashOut.phase === 'pending'
          ? 'signing your cash-out'
          : null;

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

      <span role="timer" aria-label={timeLeft === null ? 'No time limit' : `Time left ${timerText}`}>
        <Pill
          className={cn('bg-panel', timerWarn ? 'text-ink font-bold' : 'text-ink-soft font-semibold')}
          icon={<Icon name="clock" size={14} className={timerWarn ? 'text-ink' : 'text-ink-muted'} />}
        >
          {timerText}
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
              {frozen && (
                <span className="text-section font-bold">
                  <span aria-hidden="true">≈</span>
                  <span className="sr-only">about</span>
                </span>
              )}
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

          {lane ? (
            <span className="flex flex-col items-end gap-1 shrink-0">
              <DirectionChip direction={round.direction} />
              <span className="text-micro font-bold tracking-[0.08em] text-ink-muted tabular-nums">{leverageText(round)}</span>
            </span>
          ) : (
            <DirectionChip direction={round.direction} leverage={LEGACY_LEVERAGE} className="shrink-0" />
          )}
        </div>

        {cashOutNote && (
          <p role="status" aria-live="polite" className="-mt-2 mb-3 text-micro font-semibold tabular-nums text-ink-soft">
            {cashOutNote}
          </p>
        )}

        <HoldButton
          variant="hot"
          onCommit={onCashOut}
          disabled={frozen}
          ariaLabel={frozen ? cashOutLabel : 'Hold to cash out'}
          holdingLabel={<span>HOLDING…</span>}
          className={cn('h-14', pulseOnMount && !reduced && !frozen && 'lg-pulse-hot')}
        >
          <span>{cashOutLabel}</span>
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
