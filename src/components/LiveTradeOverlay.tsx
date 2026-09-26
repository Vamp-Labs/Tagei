import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from 'motion/react';
import { PlayCircle, Clock, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { ActiveTradeRound } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { MICRO } from '../ui/motion';

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
  const [timeLeft, setTimeLeft] = useState<number>(round.durationSeconds);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const isPnlPositive = round.currentPnl >= 0;

  // --- P&L "juice" ---------------------------------------------------
  // The number used to just snap to each new tick with zero motion. This
  // makes it glide (a spring-tweened display value), pop on meaningful
  // moves, throw off a brief floating "+$0.12"/"-$0.08" beside itself, and
  // glow harder the deeper the position runs — the live gauge should feel
  // like it's alive, not like a label that occasionally changes.
  const pnlMV = useMotionValue(round.currentPnl);
  const [displayPnl, setDisplayPnl] = useState(round.currentPnl);
  useMotionValueEvent(pnlMV, 'change', (v) => setDisplayPnl(v));

  const scaleMV = useMotionValue(1);
  const [popScale, setPopScale] = useState(1);
  useMotionValueEvent(scaleMV, 'change', (v) => setPopScale(v));

  const prevPnlRef = useRef(round.currentPnl);
  const popIdRef = useRef(0);
  const lastPopAtRef = useRef(0);
  const [deltaPops, setDeltaPops] = useState<{ id: number; delta: number }[]>([]);

  useEffect(() => {
    const delta = round.currentPnl - prevPnlRef.current;
    prevPnlRef.current = round.currentPnl;

    // Always glide toward the new value, even for tiny moves — this alone
    // is most of what makes the number read as "live" rather than static.
    animate(pnlMV, round.currentPnl, { type: 'spring', stiffness: 260, damping: 26, mass: 0.6 });

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
    animate(scaleMV, [1, gained ? 1.1 : 1.05, 1], {
      duration: 0.32,
      ease: [0.34, 1.56, 0.64, 1],
    });

    const id = ++popIdRef.current;
    setDeltaPops((prev) => [...prev.slice(-2), { id, delta }]);
    window.setTimeout(() => {
      setDeltaPops((prev) => prev.filter((p) => p.id !== id));
    }, 700);

    soundEngine.hapticLight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.currentPnl]);

  // Aura intensity scales with position size — capped so a huge swing
  // doesn't overwhelm the panel, floored so a fresh $0 round isn't dark.
  const auraIntensity = Math.min(1, Math.abs(round.currentPnl) / 15);

  // The flight HUD belongs at the top of the track, but the timer that drives
  // it lives here. A portal keeps one instance — and therefore one countdown —
  // while placing the markup in the glanceable tier.
  useEffect(() => {
    setStage(document.getElementById('track-stage'));
  }, []);

  // Countdown timer (PRD §25)
  useEffect(() => {
    if (!autoResolveEnabled) return;

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onTimeout, autoResolveEnabled]);

  // Near target sound cues at 75% and 90% (PRD §19)
  useEffect(() => {
    if (targetProgressPct >= 90) {
      soundEngine.playNearTargetTone(1.0);
    } else if (targetProgressPct >= 75) {
      soundEngine.playNearTargetTone(0.6);
    }
  }, [targetProgressPct]);

  const timerSeconds = timeLeft < 10 ? `0${timeLeft}` : `${timeLeft}`;

  const flightHud = (
    <>
      <div className="absolute top-3 left-4 right-4 z-20 flex items-center justify-between pointer-events-none max-w-md mx-auto">
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[color:var(--color-panel)] border border-[color:var(--color-line)] backdrop-blur-md">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--color-long)' }}
          />
          <span className="text-[length:var(--text-micro)] font-black tracking-widest text-[color:var(--color-text-1)] uppercase font-mono">
            {round.asset} · LIVE
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[color:var(--color-panel)] border border-[color:var(--color-line)] backdrop-blur-md font-mono text-[length:var(--text-micro)] font-bold text-[color:var(--color-text-1)]">
          <Clock className="w-3.5 h-3.5 text-[color:var(--color-bnb-yellow)]" />
          <span>{autoResolveEnabled ? `00:${timerSeconds}` : '∞'}</span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {stage && createPortal(flightHud, stage)}

      <div className="w-full flex flex-col select-none px-5 pt-1 pb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="relative">
            {/* Background aura — grows and warms with position size, so a
                deep run (either direction) reads at a glance, not just from
                the digits. Pure CSS/inline-style, no motion needed since it
                only has to track the render-time value, not animate ticks. */}
            <div
              aria-hidden="true"
              className="absolute -inset-3 rounded-full pointer-events-none transition-[opacity,transform] duration-300"
              style={{
                background: `radial-gradient(circle, ${
                  isPnlPositive ? 'var(--color-long)' : 'var(--color-short)'
                } 0%, transparent 70%)`,
                opacity: 0.08 + auraIntensity * 0.22,
                transform: `scale(${0.85 + auraIntensity * 0.35})`,
              }}
            />

            <motion.div
              // Colour tracks displayPnl (the animating value), not the raw
              // isPnlPositive — both come off the same smoothed number, so
              // the sign and the colour can never briefly disagree while a
              // fast crossing near zero is still mid-spring.
              className={`relative text-[length:var(--text-hero-price)] font-black font-mono tracking-tight ${
                displayPnl >= 0 ? 'text-glow-green' : 'text-glow-magenta'
              }`}
              style={{
                color: displayPnl >= 0 ? 'var(--color-long)' : 'var(--color-short)',
                scale: popScale,
              }}
            >
              {/* Sign sits outside the '$' — the reverse order prints a loss
                  as '$-10.00' instead of '-$10.00'. */}
              {displayPnl < 0 ? '-' : '+'}${Math.abs(displayPnl).toFixed(2)}
            </motion.div>

            {/* Floating delta "combat text" — a brief +$0.12 / -$0.08 that
                pops up beside the number and drifts away on each meaningful
                tick, so a swing reads as an event, not just a new label. */}
            <div className="absolute top-0 left-full ml-2 pointer-events-none">
              <AnimatePresence>
                {deltaPops.map((pop) => (
                  <motion.span
                    key={pop.id}
                    initial={{ opacity: 0, y: 4, x: -4 }}
                    // Quick pop in (MICRO), then it just sits at rest — how
                    // long it's visible is governed entirely by the 700ms
                    // removal timeout below, not by this transition.
                    animate={{ opacity: 1, y: -14, x: 0, transition: MICRO }}
                    // Exit must be fast: this transition object used to be
                    // shared with `animate` via a single top-level prop, so
                    // its 0.55s opacity duration silently governed the EXIT
                    // too — each pop lingered fading for 550ms after being
                    // removed from state, on top of its 700ms lifetime
                    // there, which is what piled several of them on screen
                    // at once during a volatile stretch.
                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    className="absolute top-0 left-0 whitespace-nowrap font-mono text-[length:var(--text-metadata)] font-bold"
                    style={{ color: pop.delta > 0 ? 'var(--color-long)' : 'var(--color-short)' }}
                  >
                    {pop.delta > 0 ? '+' : '-'}${Math.abs(pop.delta).toFixed(2)}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-[length:var(--text-metadata)] font-bold"
            style={{
              color: round.direction === 'LONG' ? 'var(--color-long)' : 'var(--color-short)',
              backgroundColor:
                round.direction === 'LONG' ? 'rgba(0,232,154,0.12)' : 'rgba(255,59,107,0.12)',
            }}
          >
            {round.direction === 'LONG' ? (
              <ArrowUpRight className="w-4 h-4 stroke-[3]" />
            ) : (
              <ArrowDownRight className="w-4 h-4 stroke-[3]" />
            )}
            <span>{round.direction} · {leverage}x</span>
          </div>
        </div>

        <HoldButton
          onCommit={onCashOut}
          ariaLabel="Hold to cash out"
          ringClassName="text-black"
          holdingLabel={
            <>
              <PlayCircle className="w-5 h-5 stroke-[2.5]" />
              <span>Holding…</span>
            </>
          }
          className={`w-full h-[var(--tap-primary)] px-6 rounded-[var(--radius-lg)] font-black text-[length:var(--text-cta)] tracking-wide text-black transition-colors ${
            isPnlPositive
              ? 'bg-[color:var(--color-long)] pulse-glow-cta'
              : 'bg-[color:var(--color-bnb-yellow)]'
          }`}
        >
          <PlayCircle className="w-5 h-5 stroke-[2.5]" />
          <span>Hold to Cash Out</span>
        </HoldButton>

        <button
          onClick={onOpenPositionDetails}
          className="mt-3 mx-auto flex items-center gap-0.5 text-[length:var(--text-metadata)] font-semibold text-[color:var(--color-text-2)] hover:text-[color:var(--color-text-1)] transition-colors cursor-pointer"
        >
          Position details
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
};
