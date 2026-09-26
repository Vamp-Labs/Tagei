import React, { useEffect, useState, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Trophy,
  RefreshCw,
  Home,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Timer,
  HandCoins,
  Target,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { TradeResult, UserProgression } from '../types/game';
import { SUPPORTED_ASSETS } from '../types/market';
import { soundEngine } from '../services/audioHaptics';
import { HERO, MICRO, STANDARD, staggerChildVariants, staggerVariants } from '../ui/motion';

interface ResultPanelProps {
  result: TradeResult;
  progression: UserProgression;
  /** The engine's real, fixed leverage — see settlementEngine.ts. */
  leverage: number;
  /** Whether App.tsx's finalizeRound actually advanced the level for this
   * result — computed once, there, where the before/after values are both
   * in scope; `progression` here already reflects the post-round state. */
  justLeveledUp?: boolean;
  onPlayAgain: () => void;
  onGoHome: () => void;
  onViewDetails: () => void;
  onClose?: () => void;
}

/** Same overshoot pop used for the win banner and the live P&L number. */
const POP_EASE = [0.34, 1.56, 0.64, 1] as const;

/**
 * The outcome drives the icon, label and accent; P&L drives only the number's
 * colour. Keeping the two apart is what stops a profitable cash-out or a
 * profitable timeout from claiming a target hit that never happened — PRD §20:
 * "Do not show a win until the real target condition has been reached."
 * The loss wording is §24's, kept plain rather than punitive (§22). Cashed-out
 * reads neutral rather than borrowing a colour that no longer exists in the
 * palette (cyan is retired) or one already claimed by win/loss.
 */
const OUTCOME = {
  win: { label: 'Trade Closed', Icon: Trophy, accent: 'var(--color-long)' },
  cashed_out: { label: 'Cashed Out', Icon: HandCoins, accent: 'var(--color-text-1)' },
  timeout: { label: 'Time Up', Icon: Timer, accent: 'var(--color-text-3)' },
  loss: { label: 'Round Complete', Icon: Target, accent: 'var(--color-short)' },
} as const;

export const ResultPanel: React.FC<ResultPanelProps> = ({
  result,
  progression,
  leverage,
  justLeveledUp = false,
  onPlayAgain,
  onGoHome,
  onViewDetails,
  onClose,
}) => {
  const reduceMotion = useReducedMotion();
  const outcome = OUTCOME[result.outcome] ?? OUTCOME.loss;
  const isProfit = result.pnl >= 0;
  const dp = SUPPORTED_ASSETS[result.asset].decimals;

  const missionBonus =
    progression.missionCompleted && progression.dailyRoundsPlayed === progression.dailyRoundsGoal
      ? 50
      : 0;
  const [xpDisplay, setXpDisplay] = useState<number>(
    progression.currentXp - result.xpEarned - missionBonus
  );
  const [showLevelUp, setShowLevelUp] = useState<boolean>(false);
  const [pnlDisplay, setPnlDisplay] = useState<number>(0);

  const hasFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (hasFiredRef.current === result.id) return;
    hasFiredRef.current = result.id;

    // A profitable manual cash-out is a real win too — it just never claims
    // the "target hit" label/colour (kept neutral in OUTCOME above, on
    // purpose, to avoid the exact outcome-mislabeling this file's comment
    // already warns about). The confetti is gated on the actual P&L sign,
    // not the outcome string, so that distinction stays intact.
    if (result.outcome === 'win' || (result.outcome === 'cashed_out' && result.pnl >= 0)) {
      // Per docs/UI_UX_SPEC.md §6: "a short glow burst... no endless confetti."
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.65 },
        colors: ['#00E89A', '#F0B90B', '#FFFFFF'],
      });
    }

    // Rolling odometer for P&L (ease-out)
    const rollDuration = 650;
    const startTime = performance.now();
    let lastTickTime = 0;

    const animateCounters = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / rollDuration);
      const ease = 1 - Math.pow(1 - progress, 3);

      setPnlDisplay(result.pnl * ease);

      if (currentTime - lastTickTime > 45 && progress < 0.95) {
        soundEngine.playCountTick();
        lastTickTime = currentTime;
      }

      if (progress < 1) {
        requestAnimationFrame(animateCounters);
      } else {
        setPnlDisplay(result.pnl);
      }
    };

    const counterFrame = requestAnimationFrame(animateCounters);

    // XP count-up (PRD §29)
    const targetXp = progression.currentXp;
    const startXp = progression.currentXp - result.xpEarned - missionBonus;
    const xpDuration = 800;
    const xpStartTime = performance.now();

    const animateXp = (currentTime: number) => {
      const elapsed = currentTime - xpStartTime;
      const progress = Math.min(1, elapsed / xpDuration);
      setXpDisplay(Math.floor(startXp + (targetXp - startXp) * progress));

      if (progress < 1) {
        requestAnimationFrame(animateXp);
      } else if (justLeveledUp) {
        // App.tsx's finalizeRound already advanced level/nextLevelXp for
        // real, so it — not a stale-threshold comparison here — is the
        // source of truth for whether this specific result was the one
        // that crossed it.
        setShowLevelUp(true);
        soundEngine.playLevelUp();
        // Distinct "achievement" palette from the win confetti above, so a
        // level-up reads as its own, bigger moment (§29: it should
        // out-celebrate an ordinary money win).
        confetti({
          particleCount: 55,
          spread: 75,
          origin: { y: 0.6 },
          colors: ['#F0B90B', '#FFD21E', '#FFFFFF'],
        });
      }
    };

    const xpFrame = requestAnimationFrame(animateXp);
    return () => {
      cancelAnimationFrame(counterFrame);
      cancelAnimationFrame(xpFrame);
    };
  }, [
    result.outcome,
    result.id,
    progression.currentXp,
    progression.nextLevelXp,
    result.pnl,
    result.xpEarned,
    missionBonus,
    justLeveledUp,
  ]);

  const handlePlayAgainClick = () => {
    soundEngine.playChipSelect();
    onPlayAgain();
  };

  const handleHomeClick = () => {
    soundEngine.playClick();
    onGoHome();
  };

  const handleCloseClick = () => {
    soundEngine.playClick();
    if (onClose) onClose();
    else onPlayAgain();
  };

  const xpProgressPct = Math.min(100, (xpDisplay / progression.nextLevelXp) * 100);
  const startXp = progression.currentXp - result.xpEarned - missionBonus;

  const remaining = Math.max(0, progression.dailyRoundsGoal - progression.dailyRoundsPlayed);
  // Never references money — PRD §22 bans anything that reads as loss-chasing.
  const missionCopy = remaining === 0 ? 'Daily goal done' : `${remaining} more → +50 XP`;

  const OutcomeIcon = outcome.Icon;

  // TradeResult carries only the completion timestamp, not a round-start
  // time, so a true "Duration" row (per the docs mock) isn't available
  // without a frozen-type change. "Direction" substitutes — real data
  // over a fabricated duration.
  const rows: [string, string][] = [
    ['Direction', `${result.direction} · ${leverage}x`],
    ['Entry', `$${result.entryPrice.toFixed(dp)}`],
    ['Exit', `$${result.exitPrice.toFixed(dp)}`],
    ['P&L', `${result.pnl >= 0 ? '+' : '-'}$${Math.abs(result.pnl).toFixed(2)}`],
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      /* Light scrim: PRD §24/§26 require the game world to stay visible.
         Contrast comes from the card's own near-opaque background instead. */
      onClick={handleCloseClick}
      className="absolute inset-0 z-40 flex items-end justify-center px-3 pointer-events-auto"
      style={{
        paddingTop: 'calc(var(--sa-top) + 0.75rem)',
        paddingBottom: 'calc(var(--sa-bottom) + 0.75rem)',
        background:
          'radial-gradient(130% 78% at 50% 108%, rgba(5,8,20,0.90) 0%, rgba(5,8,20,0.66) 40%, rgba(5,8,20,0.20) 72%, rgba(5,8,20,0) 100%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 48, scale: 0.96 }}
        transition={HERO}
        drag="y"
        dragSnapToOrigin
        dragDirectionLock
        dragElastic={{ top: 0, bottom: 0.4 }}
        dragConstraints={{ top: 0, bottom: 0 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) handleCloseClick();
        }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-[var(--radius-xl)] border shadow-2xl flex flex-col bg-[color:var(--color-panel)] backdrop-blur-xl"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0 cursor-grab active:cursor-grabbing">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <motion.div
          variants={reduceMotion ? undefined : staggerVariants}
          initial={reduceMotion ? undefined : 'hidden'}
          animate={reduceMotion ? undefined : 'visible'}
          className="px-5 pt-1 pb-2 flex flex-col items-center"
        >
          <motion.div
            variants={reduceMotion ? undefined : staggerChildVariants}
            className="flex items-center gap-1.5"
            style={{ color: outcome.accent }}
          >
            <OutcomeIcon className="w-4 h-4" />
            {/* §35 bans colour-only encoding, so one text label always stays. */}
            <span className="text-[length:var(--text-metadata)] font-bold uppercase tracking-wide">
              {outcome.label}
            </span>
          </motion.div>

          <motion.div
            variants={reduceMotion ? undefined : staggerChildVariants}
            className={`text-[length:var(--text-hero-price)] font-black font-mono tracking-tight mt-1 ${
              isProfit ? 'text-glow-green' : 'text-glow-magenta'
            }`}
            style={{ color: isProfit ? 'var(--color-long)' : 'var(--color-short)' }}
          >
            {Math.abs(result.pnl) < 0.005 ? '' : result.pnl < 0 ? '-' : '+'}$
            {Math.abs(pnlDisplay).toFixed(2)}
          </motion.div>

          {/* docs/UI_UX_SPEC.md §6/§7 table: Duration / Entry / Exit / P&L */}
          <motion.div
            variants={reduceMotion ? undefined : staggerChildVariants}
            className="w-full mt-4 rounded-[var(--radius-md)] border border-[color:var(--color-line)] overflow-hidden"
          >
            {rows.map(([label, value], i) => (
              <div
                key={label}
                className={`flex items-center justify-between px-4 h-11 ${
                  i > 0 ? 'border-t border-[color:var(--color-line)]' : ''
                }`}
              >
                <span className="text-[length:var(--text-metadata)] text-[color:var(--color-text-2)]">
                  {label}
                </span>
                <span className="font-mono text-[length:var(--text-metadata)] font-bold text-[color:var(--color-text-1)]">
                  {value}
                </span>
              </div>
            ))}
          </motion.div>

          <motion.div
            variants={reduceMotion ? undefined : staggerChildVariants}
            className="w-full mt-3 rounded-[var(--radius-md)] bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] px-3 py-2"
          >
            {showLevelUp ? (
              /* §29: a level-up should out-celebrate an ordinary money win.
                 It replaces the row rather than adding a block. */
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Sparkles className="w-4 h-4 text-[color:var(--color-bnb-yellow)] shrink-0" />
                  <span className="text-[length:var(--text-metadata)] font-black text-[color:var(--color-bnb-yellow)] truncate">
                    LVL {progression.level} · {progression.title}
                  </span>
                </div>
                <span className="text-[length:var(--text-micro)] font-mono font-bold text-[color:var(--color-text-2)] shrink-0">
                  {startXp}→{progression.currentXp}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: progression.dailyRoundsGoal }).map((_, i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          i < progression.dailyRoundsPlayed ? 'var(--color-long)' : 'rgba(255,255,255,0.15)',
                      }}
                    />
                  ))}
                  <span className="ml-1 text-[length:var(--text-micro)] font-mono font-bold text-[color:var(--color-text-2)]">
                    LVL {progression.level}
                  </span>
                </div>
                <motion.span
                  initial={reduceMotion ? undefined : { opacity: 0, scale: 0.6, y: 4 }}
                  animate={reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: POP_EASE, delay: 0.15 }}
                  className="text-[length:var(--text-micro)] font-mono font-black"
                  style={{ color: 'var(--color-long)' }}
                >
                  +{result.xpEarned} XP
                </motion.span>
              </div>
            )}

            <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden mt-1.5">
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${xpProgressPct}%`, backgroundColor: 'var(--color-bnb-yellow)' }}
              />
            </div>
          </motion.div>

          <motion.div
            variants={reduceMotion ? undefined : staggerChildVariants}
            className="w-full mt-3"
          >
            <motion.button
              onClick={handlePlayAgainClick}
              whileTap={{ scale: 0.97 }}
              transition={MICRO}
              className={`group w-full h-[var(--tap-primary)] rounded-[var(--radius-lg)] bg-[color:var(--color-bnb-yellow)] text-black flex flex-col items-center justify-center cursor-pointer ${
                reduceMotion ? '' : 'pulse-glow-cta'
              }`}
            >
              <span className="flex items-center gap-2 font-black text-[length:var(--text-cta)] tracking-wide">
                <RefreshCw className="w-4.5 h-4.5 stroke-[2.5]" />
                Trade Again
                <ArrowRight className="w-4.5 h-4.5 stroke-[2.5] transition-transform group-hover:translate-x-1" />
              </span>
              <span className="text-[length:var(--text-micro)] font-mono font-bold tracking-wide opacity-70">
                {missionCopy}
              </span>
            </motion.button>

            <button
              onClick={onViewDetails}
              className="w-full mt-2 text-center text-[length:var(--text-metadata)] font-semibold text-[color:var(--color-text-2)] hover:text-[color:var(--color-text-1)] transition-colors cursor-pointer"
            >
              View details
            </button>
          </motion.div>
        </motion.div>

        {/* Everything that is not the next move shrinks to an icon. */}
        <div className="shrink-0 flex items-center justify-between px-5 pb-3 pt-0.5">
          <button
            onClick={handleHomeClick}
            aria-label="Back to home"
            className="w-11 h-11 -ml-2 rounded-[var(--radius-sm)] flex items-center justify-center text-[color:var(--color-text-2)] hover:text-[color:var(--color-text-1)] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <Home className="w-4.5 h-4.5" />
          </button>

          {result.txHash && (
            <a
              href={`https://bscscan.com/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View settlement on BscScan"
              title="Settled on BNB Chain — view on BscScan"
              className="w-11 h-11 -mr-2 rounded-[var(--radius-sm)] flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer"
              style={{ color: 'var(--color-long)' }}
            >
              <ShieldCheck className="w-4.5 h-4.5" />
            </a>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
