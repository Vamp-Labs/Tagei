import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Home, ShieldCheck } from 'lucide-react';
import { TradeResult, UserProgression } from '../types/game';
import { SUPPORTED_ASSETS } from '../types/market';
import { soundEngine } from '../services/audioHaptics';
import {
  DISMISS_OFFSET,
  DISMISS_VELOCITY,
  HERO,
  MICRO,
  STANDARD,
  staggerChildVariants,
  staggerVariants,
  useMotionPref,
} from '../ui/motion';
import { buttonClass, Button } from '../ui/lucky/Button';
import { Scrim } from '../ui/lucky/Scrim';
import { SignedAmount } from '../ui/lucky/SignedAmount';
import { StatTable, type StatRow } from '../ui/lucky/StatTable';
import { Panel } from '../ui/lucky/Panel';
import { ProgressBar } from '../ui/lucky/ProgressBar';
import { Pill } from '../ui/lucky/Pill';
import { Icon } from '../ui/lucky/Icon';
import { DirectionChip } from '../ui/lucky/DirectionChip';
import { useConfetti } from '../ui/lucky/Confetti';
import { formatAmount, formatPrice, formatXp, signOf } from '../ui/lucky/format';
import { cn } from '../ui/cn';
import { OutcomeArt } from './outcome/OutcomeArt';
import { useResultCounters } from './outcome/useResultCounters';
import { GLYPH_STROKE, POP } from './outcome/tokens';

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

const OUTCOME = {
  win: { label: 'TARGET HIT', accent: 'text-lucky' },
  cashed_out: { label: 'CASHED OUT', accent: 'text-ink' },
  timeout: { label: 'TIME UP', accent: 'text-ink-muted' },
  loss: { label: 'ROUND COMPLETE', accent: 'text-ink-soft' },
} as const;

const MISSION_BONUS_XP = 50;
const XP_PILL_DELAY_SECONDS = 0.15;
const LEVEL_COIN_PX = 32;
const FOOTER_GLYPH_PX = 22;

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
  const reduced = useMotionPref();
  const { burst } = useConfetti();
  const outcome = OUTCOME[result.outcome] ?? OUTCOME.loss;
  const pnlSign = signOf(result.pnl);
  const isProfit = pnlSign >= 0;
  const dp = SUPPORTED_ASSETS[result.asset].decimals;

  const missionBonus =
    progression.missionCompleted && progression.dailyRoundsPlayed === progression.dailyRoundsGoal
      ? MISSION_BONUS_XP
      : 0;
  const startXp = progression.currentXp - result.xpEarned - missionBonus;

  const [showLevelUp, setShowLevelUp] = useState<boolean>(reduced && justLeveledUp);
  const celebratedRef = useRef<string | null>(null);
  const levelUpFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (celebratedRef.current === result.id) return;
    celebratedRef.current = result.id;
    if (result.outcome === 'win') burst('win');
  }, [result.id, result.outcome, burst]);

  const { pnlDisplay, xpDisplay } = useResultCounters({
    resultId: result.id,
    pnl: result.pnl,
    startXp,
    targetXp: progression.currentXp,
    reduced,
    onComplete: () => {
      if (!justLeveledUp) return;
      setShowLevelUp(true);
      if (levelUpFiredRef.current === result.id) return;
      levelUpFiredRef.current = result.id;
      soundEngine.playLevelUp();
      burst('levelUp');
    },
  });

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

  const remaining = Math.max(0, progression.dailyRoundsGoal - progression.dailyRoundsPlayed);
  // Never references money — PRD §22 bans anything that reads as loss-chasing.
  const missionCopy =
    remaining === 0
      ? 'Daily goal done'
      : `${remaining} more ${remaining === 1 ? 'round' : 'rounds'} · +${MISSION_BONUS_XP} XP`;

  const art = result.outcome === 'win' ? 'reward-crown' : result.outcome === 'cashed_out' && isProfit ? 'coin' : null;
  const childVariants = reduced ? undefined : staggerChildVariants;
  const nextLevel = progression.level + 1;

  // TradeResult carries only the completion timestamp, not a round-start
  // time, so a true "Duration" row isn't available without a frozen-type change.
  const rows: StatRow[] = [
    { label: 'Direction', value: <DirectionChip direction={result.direction} leverage={leverage} size="sm" /> },
    { label: 'Entry', value: formatPrice(result.entryPrice, { unit: 'USDT', decimals: dp }) },
    { label: 'Exit', value: formatPrice(result.exitPrice, { unit: 'USDT', decimals: dp }) },
    { label: 'P&L', value: formatAmount(result.pnl), tone: isProfit ? 'profit' : 'loss' },
  ];

  return (
    <Scrim
      tone="game"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      onClick={handleCloseClick}
      className="absolute inset-0 z-40 flex items-end justify-center px-3 pointer-events-auto"
      style={{
        paddingTop: 'calc(var(--sa-top) + 0.75rem)',
        paddingBottom: 'calc(var(--sa-bottom) + 0.75rem)',
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
          if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) handleCloseClick();
        }}
        onClick={(event) => event.stopPropagation()}
        className="lg-card w-full max-w-sm flex flex-col"
      >
        <div className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab active:cursor-grabbing">
          <span className="lg-grabber" />
        </div>

        <motion.div
          variants={reduced ? undefined : staggerVariants}
          initial={reduced ? undefined : 'hidden'}
          animate={reduced ? undefined : 'visible'}
          className="px-5 pb-2 flex flex-col items-center"
        >
          <motion.div variants={childVariants} className="flex flex-col items-center gap-2">
            {art && <OutcomeArt name={art} height={art === 'coin' ? 60 : undefined} />}
            {/* §35 bans colour-only encoding, so one text label always stays. */}
            <h2 className={cn('text-label font-extrabold uppercase tracking-[0.08em]', outcome.accent)}>
              {outcome.label}
            </h2>
          </motion.div>

          <motion.p variants={childVariants} className="mt-1">
            <SignedAmount
              value={pnlDisplay}
              tone="ink"
              className={cn('text-display', isProfit ? 'text-profit' : 'text-loss')}
            />
          </motion.p>

          <motion.div variants={childVariants} className="w-full mt-4">
            <StatTable rows={rows} />
          </motion.div>

          <motion.div variants={childVariants} className="w-full mt-3">
            <Panel as="div" className="p-3">
              <div className="flex items-center justify-between gap-2 min-h-8">
                {showLevelUp ? (
                  <motion.div
                    initial={reduced ? undefined : { opacity: 0, scale: 0.6 }}
                    animate={reduced ? undefined : { opacity: 1, scale: 1 }}
                    transition={POP}
                    className="flex items-center gap-2 shrink-0"
                  >
                    <OutcomeArt name="coin" height={LEVEL_COIN_PX} className="rounded-full shadow-glow-gold" />
                    <span className="text-label font-extrabold uppercase tracking-[0.08em] text-gold">LEVEL UP</span>
                  </motion.div>
                ) : null}
                <span className="min-w-0 truncate text-caption">
                  <span className="font-bold text-ink">LVL {progression.level}</span>
                  {!showLevelUp && <span className="text-ink-muted"> · {progression.title}</span>}
                </span>
                {!showLevelUp && (
                  <motion.span
                    initial={reduced ? undefined : { opacity: 0, scale: 0.6, y: 4 }}
                    animate={reduced ? undefined : { opacity: 1, scale: 1, y: 0 }}
                    transition={{ ...POP, delay: XP_PILL_DELAY_SECONDS }}
                    className="shrink-0"
                  >
                    <Pill tone="lucky" size="sm">
                      {formatXp(result.xpEarned, { sign: 'always' })}
                    </Pill>
                  </motion.span>
                )}
              </div>
              <ProgressBar
                className="mt-2"
                size="sm"
                tone={justLeveledUp ? 'gold' : 'lucky'}
                value={xpDisplay}
                max={progression.nextLevelXp}
                label={`XP toward level ${nextLevel}`}
                next={`LVL ${nextLevel}`}
              />
              <p className="mt-2 flex items-center gap-1 text-micro tabular-nums text-ink-muted">
                <span>{startXp}</span>
                <Icon name="back" size={13} strokeWidth={2.6} className="rotate-180" />
                <span className="sr-only">to</span>
                <span className="font-semibold text-ink-soft">{formatXp(progression.currentXp)}</span>
              </p>
            </Panel>
          </motion.div>

          <motion.div variants={childVariants} className="w-full mt-4 flex flex-col items-center">
            {isProfit ? (
              <motion.button
                type="button"
                onClick={handlePlayAgainClick}
                whileTap={{ scale: 0.97 }}
                transition={MICRO}
                className={cn(buttonClass('hot', 'lg', true), !reduced && pnlSign > 0 && 'lg-pulse-hot')}
              >
                TRADE AGAIN!
              </motion.button>
            ) : (
              <motion.button
                type="button"
                onClick={handlePlayAgainClick}
                whileTap={{ scale: 0.97 }}
                transition={MICRO}
                className={buttonClass('secondary', 'md', true)}
              >
                Trade again
              </motion.button>
            )}
            <p className="mt-2 text-micro tabular-nums text-ink-muted">{missionCopy}</p>
            <Button variant="ghost" size="md" onClick={onViewDetails} className="mt-1">
              {isProfit ? 'View details' : 'Review round'}
            </Button>
          </motion.div>
        </motion.div>

        <div className="shrink-0 flex items-center justify-between px-5 pb-4">
          <Button
            variant="icon"
            size="md"
            aria-label="Back to home"
            onClick={handleHomeClick}
            icon={<Home size={FOOTER_GLYPH_PX} strokeWidth={GLYPH_STROKE} aria-hidden="true" />}
          />

          {result.txHash && (
            <a
              href={`https://bscscan.com/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View settlement on BscScan"
              title="Settled on BNB Chain — view on BscScan"
              className={cn(buttonClass('icon', 'md'), 'text-info')}
            >
              <ShieldCheck size={FOOTER_GLYPH_PX} strokeWidth={GLYPH_STROKE} aria-hidden="true" />
            </a>
          )}
        </div>
      </motion.div>
    </Scrim>
  );
};
