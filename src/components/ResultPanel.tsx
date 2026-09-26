import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { explorerTxUrl } from '@bnbplay/shared/chain';
import { DAILY_MISSIONS } from '@bnbplay/shared/progression';
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
import {
  buttonClass,
  Button,
  Scrim,
  SignedAmount,
  StatTable,
  type StatRow,
  Panel,
  ProgressBar,
  Pill,
  Icon,
  DirectionChip,
  useConfetti,
  formatAmount,
  formatPrice,
  formatXp,
  signOf,
} from '../ui/lucky';
import { cn } from '../ui/cn';
import { OutcomeArt } from './outcome/OutcomeArt';
import { useResultCounters } from './outcome/useResultCounters';
import { POP, POP_SECONDS } from './outcome/tokens';
import type { XpView } from './game/liveRoundController';
import { pilotTitle } from './game/progression';
import {
  LEGACY_LEVERAGE,
  PRACTICE_PILL,
  RESULT_HEADLINE,
  VOID_COPY,
  durationText,
  isLaneRound,
  leverageText,
  resultKind,
} from './game/roundDisplay';

interface ResultPanelProps {
  result: TradeResult;
  progression: UserProgression;
  justLeveledUp?: boolean;
  xp?: XpView | null;
  xpPending?: boolean;
  onPlayAgain: () => void;
  onGoHome: () => void;
  onViewDetails: () => void;
  onClose?: () => void;
}

const ACCENT = {
  win: 'text-lucky',
  cashed_out: 'text-ink',
  timeout: 'text-ink-soft',
  loss: 'text-ink-soft',
  voided: 'text-ink',
} as const;

const STATUS_LINE: Partial<Record<keyof typeof ACCENT, string>> = {
  timeout: 'time up',
  voided: VOID_COPY,
};

const MISSION_BONUS_XP = DAILY_MISSIONS[0].xp;
const XP_PILL_DELAY_SECONDS = 0.15;
const LEVEL_COIN_PX = 32;
const HERO_ART_PX = 60;
const LEVEL_GLOW_REST_OPACITY = 0.6;
const FOOTER_GLYPH_PX = 22;

export const ResultPanel: React.FC<ResultPanelProps> = ({
  result,
  progression,
  justLeveledUp = false,
  xp = null,
  xpPending = false,
  onPlayAgain,
  onGoHome,
  onViewDetails,
  onClose,
}) => {
  const reduced = useMotionPref();
  const { burst } = useConfetti();
  const kind = resultKind(result);
  const voided = kind === 'voided';
  const practice = result.mode === 'practice';
  const live = result.mode === 'live';
  const pnlSign = signOf(result.pnl);
  const isProfit = pnlSign >= 0;
  const dp = SUPPORTED_ASSETS[result.asset].decimals;
  const leveledUp = justLeveledUp || (xp?.leveledUp ?? false);

  const missionBonus =
    progression.missionCompleted && progression.dailyRoundsPlayed === progression.dailyRoundsGoal
      ? MISSION_BONUS_XP
      : 0;
  const legacyStartXp = progression.currentXp - result.xpEarned - missionBonus;
  const startXp = live ? (xp?.before ?? progression.currentXp) : practice ? progression.currentXp : legacyStartXp;
  const targetXp = live ? (xp?.after ?? progression.currentXp) : progression.currentXp;
  const gainedXp = live ? (xp?.gained ?? null) : practice ? null : result.xpEarned;

  const [showLevelUp, setShowLevelUp] = useState<boolean>(reduced && leveledUp);
  const celebratedRef = useRef<string | null>(null);
  const leveledUpRef = useRef<string | null>(null);

  useEffect(() => {
    if (celebratedRef.current === result.id) return;
    celebratedRef.current = result.id;
    if (kind === 'win') burst('win');
  }, [result.id, kind, burst]);

  const { pnlDisplay, xpDisplay } = useResultCounters({
    resultId: result.id,
    pnl: result.pnl,
    startXp,
    targetXp,
    reduced,
    onComplete: () => {
      if (!leveledUp) return;
      setShowLevelUp(true);
      if (leveledUpRef.current === result.id) return;
      leveledUpRef.current = result.id;
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
  const missionCopy = practice
    ? 'Practice rounds earn no XP'
    : !isProfit
    ? `${progression.dailyRoundsPlayed}/${progression.dailyRoundsGoal} rounds today`
    : remaining === 0
      ? 'Daily goal done'
      : `${remaining} more ${remaining === 1 ? 'round' : 'rounds'} · +${MISSION_BONUS_XP} XP`;

  const art = kind === 'win' ? 'reward-crown' : kind === 'cashed_out' && isProfit ? 'reward-clover' : null;
  const childVariants = reduced ? undefined : staggerChildVariants;
  const nextLevel = progression.level + 1;
  const price = (value: number) => formatPrice(value, { unit: 'USDT', decimals: dp });
  const lane = isLaneRound(result);
  const duration = durationText(result.durationSec);
  const txUrl = !practice && result.txHash ? (result.explorerUrl ?? explorerTxUrl(result.txHash)) : null;

  const rows: StatRow[] = [
    {
      label: 'Direction',
      value: lane ? (
        <span className="inline-flex items-center gap-2">
          <DirectionChip direction={result.direction} size="sm" />
          <span className="tabular-nums">{leverageText(result)}</span>
        </span>
      ) : (
        <DirectionChip direction={result.direction} leverage={LEGACY_LEVERAGE} size="sm" />
      ),
    },
    { label: 'Entry', value: result.entryPrice > 0 ? price(result.entryPrice) : '—' },
  ];
  if (voided) {
    rows.push({ label: 'Stake returned', value: formatAmount(result.payout ?? result.stake, 'USDT', { sign: 'never' }) });
  } else {
    rows.push(
      { label: 'Exit', value: price(result.exitPrice) },
      { label: 'P&L', value: formatAmount(result.pnl), tone: isProfit ? 'profit' : 'loss' },
    );
  }
  if (duration) rows.push({ label: 'Duration', value: duration });

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
            {art && <OutcomeArt name={art} height={HERO_ART_PX} />}
            {/* §35 bans colour-only encoding, so one text label always stays. */}
            <h2 className={cn('text-label font-extrabold uppercase tracking-[0.08em]', ACCENT[kind])}>
              {RESULT_HEADLINE[kind]}
            </h2>
            {practice && <Pill size="sm">{PRACTICE_PILL}</Pill>}
          </motion.div>

          <motion.p variants={childVariants} className="mt-1">
            <SignedAmount
              value={pnlDisplay}
              tone="ink"
              className={cn('text-display', voided ? 'text-ink' : isProfit ? 'text-profit' : 'text-loss')}
            />
          </motion.p>
          {STATUS_LINE[kind] && (
            <motion.p variants={childVariants} className="mt-1 max-w-[280px] text-caption text-ink-soft">
              {STATUS_LINE[kind]}
            </motion.p>
          )}

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
                    <span className="relative inline-grid shrink-0 rounded-full">
                      <motion.span
                        aria-hidden="true"
                        initial={reduced ? false : { opacity: 0 }}
                        animate={{ opacity: reduced ? LEVEL_GLOW_REST_OPACITY : [0, 1, LEVEL_GLOW_REST_OPACITY] }}
                        transition={reduced ? { duration: 0 } : { duration: POP_SECONDS, times: [0, 0.5, 1], ease: 'easeOut' }}
                        className="absolute inset-0 rounded-full shadow-glow-gold"
                      />
                      <OutcomeArt name="coin" height={LEVEL_COIN_PX} className="relative rounded-full" />
                    </span>
                    <span className="text-label font-extrabold uppercase tracking-[0.08em] text-gold">LEVEL UP</span>
                  </motion.div>
                ) : null}
                <span className="min-w-0 truncate text-caption">
                  <span className="font-bold text-ink">LVL {progression.level}</span>
                  {!showLevelUp && <span className="text-ink-muted"> · {pilotTitle(progression)}</span>}
                </span>
                {!showLevelUp && gainedXp !== null && (
                  <motion.span
                    key={gainedXp}
                    initial={reduced ? undefined : { opacity: 0, scale: 0.6, y: 4 }}
                    animate={reduced ? undefined : { opacity: 1, scale: 1, y: 0 }}
                    transition={{ ...POP, delay: XP_PILL_DELAY_SECONDS }}
                    className="shrink-0"
                  >
                    <Pill tone="lucky" size="sm">
                      {formatXp(gainedXp, { sign: 'always' })}
                    </Pill>
                  </motion.span>
                )}
                {!showLevelUp && live && gainedXp === null && xpPending && (
                  <Pill size="sm" className="shrink-0">
                    <span role="status">XP pending</span>
                  </Pill>
                )}
              </div>
              <ProgressBar
                className="mt-2"
                size="sm"
                tone={showLevelUp ? 'gold' : 'lucky'}
                value={xpDisplay}
                max={progression.nextLevelXp}
                label={`XP toward level ${nextLevel}`}
                next={`LVL ${nextLevel}`}
              />
              <p className="mt-2 flex items-center gap-1 text-micro tabular-nums text-ink-muted">
                <span>{startXp}</span>
                <Icon name="back" size={13} strokeWidth={2.6} className="rotate-180" />
                <span className="sr-only">to</span>
                <span className="font-semibold text-ink-soft">{formatXp(targetXp)}</span>
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
            icon={<Icon name="home" size={FOOTER_GLYPH_PX} />}
          />

          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View settlement on BscScan testnet"
              title="Settled on BNB Chain testnet — view on BscScan"
              className={cn(buttonClass('icon', 'md'), 'text-ink-secondary')}
            >
              <Icon name="shield-check" size={FOOTER_GLYPH_PX} />
            </a>
          )}
        </div>
      </motion.div>
    </Scrim>
  );
};
