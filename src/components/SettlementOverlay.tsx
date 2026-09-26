import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { explorerTxUrl } from '@bnbplay/shared/chain';
import { STANDARD, MICRO, useMotionPref } from '../ui/motion';
import { SettlementStep } from '../services/web3Service';
import { Scrim, Icon, Pill, SignedAmount, formatHash, formatPrice, type IconName } from '../ui/lucky';
import { cn } from '../ui/cn';
import type { SettleReason } from './game/liveRoundController';
import { PRACTICE_PILL, PRACTICE_SETTLE_COPY, SETTLE_FAILED_BODY, SETTLE_FAILED_TITLE, TIME_UP_COPY } from './game/roundDisplay';

interface SettlementOverlayProps {
  step: SettlementStep;
  txHash?: string;
  pnl: number;
  variant?: 'live' | 'practice';
  estimate?: boolean;
  reason?: SettleReason;
  exitPrice?: number | null;
}

const STEP_ORDER: SettlementStep[] = ['preparing', 'signing', 'submitted', 'confirmed'];

const STEP_GLYPH_SIZE = 28;

const STEP_META: Record<SettlementStep, { icon: IconName; caption: string; index: number }> = {
  idle: { icon: 'bolt', caption: 'Preparing', index: 0 },
  preparing: { icon: 'bolt', caption: 'Preparing', index: 0 },
  signing: { icon: 'key', caption: 'Signing', index: 1 },
  submitted: { icon: 'broadcast', caption: 'Broadcasting', index: 2 },
  confirmed: { icon: 'check', caption: 'Confirmed', index: 3 },
  failed: { icon: 'close', caption: 'Not confirmed', index: 2 },
};

const RING_SIZE = 104;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CAPTION_RISE_PX = 8;

function reasonLine(reason: SettleReason | undefined, exitPrice: number | null | undefined): string | null {
  if (reason === 'time') return TIME_UP_COPY;
  if (reason === 'exit' && exitPrice) return `EXIT LOCKED ${formatPrice(exitPrice, { unit: 'USDT' })}`;
  if (reason === 'target') return 'TARGET HIT · settling the payout';
  if (reason === 'stop') return 'STOP REACHED · settling the round';
  return null;
}

export const SettlementOverlay: React.FC<SettlementOverlayProps> = ({
  step,
  txHash,
  pnl,
  variant = 'live',
  estimate = false,
  reason,
  exitPrice,
}) => {
  const reduced = useMotionPref();
  const practice = variant === 'practice';
  const failed = step === 'failed';
  const meta = STEP_META[step];
  const isConfirmed = step === 'confirmed';
  const progress = isConfirmed ? 1 : meta.index / (STEP_ORDER.length - 1);
  const tone = failed ? 'loss' : isConfirmed ? 'lucky' : 'gold';
  const context = practice ? null : reasonLine(reason, exitPrice);

  const title = failed
    ? SETTLE_FAILED_TITLE
    : practice
      ? isConfirmed
        ? 'Practice round complete'
        : 'Closing practice round…'
      : isConfirmed
        ? 'Confirmed on BNB Chain'
        : 'Settling on BNB Chain…';

  return (
    <Scrim
      tone="dim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 pointer-events-auto"
    >
      <div className="lg-card w-full max-w-sm p-6 flex flex-col items-center text-center">
        {practice && (
          <Pill size="sm" className="mb-4">
            {PRACTICE_PILL}
          </Pill>
        )}
        {context && <p className="mb-4 text-micro font-bold uppercase tracking-[0.08em] text-ink-soft tabular-nums">{context}</p>}

        <div className="relative mb-4" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden="true">
            <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} strokeWidth={RING_STROKE} fill="none" className="stroke-well" />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              className={cn(tone === 'lucky' && 'stroke-lucky-bar', tone === 'gold' && 'stroke-gold', tone === 'loss' && 'stroke-loss')}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={false}
              animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress) }}
              transition={reduced ? { duration: 0 } : STANDARD}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: 0, transition: STANDARD }}
                exit={{ opacity: 0, scale: reduced ? 1 : 0.6, transition: MICRO }}
                className={cn(
                  'w-14 h-14 rounded-md flex items-center justify-center',
                  tone === 'lucky' && 'bg-lucky-bar text-on-lucky',
                  tone === 'gold' && 'bg-gold text-on-gold shadow-glow-gold',
                  tone === 'loss' && 'bg-well text-loss ring-2 ring-inset ring-loss',
                )}
              >
                <Icon name={meta.icon} size={STEP_GLYPH_SIZE} strokeWidth={isConfirmed ? 3 : 2.4} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.span
            key={step}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: CAPTION_RISE_PX }}
            animate={{ opacity: 1, y: 0, transition: MICRO }}
            exit={{ opacity: 0, transition: MICRO }}
            className={cn(
              'text-micro font-bold uppercase tracking-[0.08em] mb-3',
              tone === 'lucky' && 'text-lucky',
              tone === 'gold' && 'text-gold',
              tone === 'loss' && 'text-loss',
            )}
          >
            {meta.caption}
          </motion.span>
        </AnimatePresence>

        <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
          {STEP_ORDER.map((s, idx) => {
            const filled = idx <= meta.index || isConfirmed;
            return (
              <span
                key={s}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-colors duration-300',
                  !filled && 'bg-control-ring',
                  filled && tone === 'lucky' && 'bg-lucky-bar',
                  filled && tone === 'gold' && 'bg-gold',
                  filled && tone === 'loss' && 'bg-loss',
                )}
              />
            );
          })}
        </div>

        <h3 className="text-section text-ink mb-1" aria-live="polite">
          {title}
        </h3>

        {failed ? (
          <div className="mb-5 flex flex-col gap-1">
            <p className="text-caption text-ink-soft">{SETTLE_FAILED_BODY}</p>
            <p className="text-micro text-ink-muted">retrying… the round stays open until it settles</p>
          </div>
        ) : (
          <p className="text-caption text-ink-muted mb-5">
            {practice ? `${PRACTICE_SETTLE_COPY} · ` : 'Outcome '}
            {estimate && <span aria-hidden="true">≈ </span>}
            {estimate && <span className="sr-only">about </span>}
            <SignedAmount value={pnl} className="font-bold" />
          </p>
        )}

        {!practice && txHash && (
          <a
            href={explorerTxUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction ${formatHash(txHash)} on BscScan testnet`}
            className="w-full min-h-12 flex items-center justify-between gap-3 px-4 rounded-md bg-well text-caption"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-ink-muted">Tx</span>
              <span className="tabular-nums font-semibold text-ink-secondary truncate">{formatHash(txHash)}</span>
            </span>
            <span className="flex items-center gap-1.5 font-bold text-ink-secondary shrink-0">
              BscScan
              <Icon name="external" size={16} />
            </span>
          </a>
        )}
      </div>
    </Scrim>
  );
};
