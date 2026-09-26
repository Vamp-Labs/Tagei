import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLink, Key, Radio, Zap } from 'lucide-react';
import { STANDARD, MICRO, useMotionPref } from '../ui/motion';
import { SettlementStep } from '../services/web3Service';
import { Scrim } from '../ui/lucky/Scrim';
import { Icon } from '../ui/lucky/Icon';
import { SignedAmount } from '../ui/lucky/SignedAmount';
import { formatHash } from '../ui/lucky/format';
import { cn } from '../ui/cn';
import { GLYPH_STROKE } from './outcome/tokens';

interface SettlementOverlayProps {
  step: SettlementStep;
  txHash?: string;
  pnl: number;
}

const STEP_ORDER: SettlementStep[] = ['preparing', 'signing', 'submitted', 'confirmed'];

const STEP_GLYPH_SIZE = 28;

const stepMeta = (s: SettlementStep) => {
  switch (s) {
    case 'signing':
      return { icon: <Key size={STEP_GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />, caption: 'Signing', index: 1 };
    case 'submitted':
      return { icon: <Radio size={STEP_GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />, caption: 'Broadcasting', index: 2 };
    case 'confirmed':
      return { icon: <Icon name="check" size={STEP_GLYPH_SIZE} strokeWidth={3} />, caption: 'Confirmed', index: 3 };
    case 'preparing':
    default:
      return { icon: <Zap size={STEP_GLYPH_SIZE} strokeWidth={GLYPH_STROKE} aria-hidden="true" />, caption: 'Preparing', index: 0 };
  }
};

const RING_SIZE = 104;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CAPTION_RISE_PX = 8;

export const SettlementOverlay: React.FC<SettlementOverlayProps> = ({ step, txHash, pnl }) => {
  const reduced = useMotionPref();
  const meta = stepMeta(step);
  const isConfirmed = step === 'confirmed';
  const progress = isConfirmed ? 1 : meta.index / (STEP_ORDER.length - 1);

  return (
    <Scrim
      tone="dim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 pointer-events-auto"
    >
      <div className="lg-card w-full max-w-sm p-6 flex flex-col items-center text-center">
        <div className="relative mb-4" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden="true">
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              className="stroke-well"
            />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              className={isConfirmed ? 'stroke-lucky-bar' : 'stroke-gold'}
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
                  isConfirmed ? 'bg-lucky-bar text-on-lucky' : 'bg-gold text-on-gold shadow-glow-gold'
                )}
              >
                {meta.icon}
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
              isConfirmed ? 'text-lucky' : 'text-gold'
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
                  filled && (isConfirmed ? 'bg-lucky-bar' : 'bg-gold')
                )}
              />
            );
          })}
        </div>

        <h3 className="text-section text-ink mb-1" aria-live="polite">
          {isConfirmed ? 'Confirmed on BNB Chain' : 'Settling on BNB Chain…'}
        </h3>

        <p className="text-caption text-ink-muted mb-5">
          Outcome <SignedAmount value={pnl} className="font-bold" />
        </p>

        {txHash && (
          <a
            href={`https://bscscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction ${formatHash(txHash)} on BscScan`}
            className="w-full min-h-12 flex items-center justify-between gap-3 px-4 rounded-md bg-well text-caption"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-ink-muted">Tx</span>
              <span className="tabular-nums font-semibold text-ink-secondary truncate">{formatHash(txHash)}</span>
            </span>
            <span className="flex items-center gap-1.5 font-bold text-info shrink-0">
              BscScan
              <ExternalLink size={16} strokeWidth={GLYPH_STROKE} aria-hidden="true" />
            </span>
          </a>
        )}
      </div>
    </Scrim>
  );
};
