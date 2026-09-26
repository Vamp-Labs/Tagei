import React, { useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { explorerTxUrl } from '@bnbplay/shared/chain';
import { EASE_OUT, MICRO, STANDARD, cardVariants, useMotionPref } from '../ui/motion';
import { SettlementStep } from '../services/web3Service';
import { Scrim, Icon, Pill, SignedAmount, formatHash, formatPrice } from '../ui/lucky';
import type { SettleReason } from './game/liveRoundController';
import { PRACTICE_PILL, PRACTICE_SETTLE_COPY, SETTLE_FAILED_BODY, SETTLE_FAILED_TITLE, TIME_UP_COPY } from './game/roundDisplay';
import { ChainRing } from './outcome/settlement/ChainRing';
import { ChainStepper } from './outcome/settlement/ChainStepper';
import { failedFallbackIndex, phaseOf, runningIndex, stepDescription, stepsFor } from './outcome/settlement/steps';

interface SettlementOverlayProps {
  step: SettlementStep;
  txHash?: string;
  pnl: number;
  variant?: 'live' | 'practice';
  estimate?: boolean;
  reason?: SettleReason;
  exitPrice?: number | null;
}

const CHILD_STAGGER = 0.04;
const CHILD_RISE_PX = 8;
const HASH_REVEAL_DELAY = 0.08;
const HASH_REVEAL_SECONDS = 0.32;
const EXTERNAL_ICON_SIZE = 16;

const REDUCED_CARD: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1 } };
const CHILD: Variants = { hidden: { opacity: 0, y: CHILD_RISE_PX }, visible: { opacity: 1, y: 0 } };
const REDUCED_CHILD: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1 } };

function reasonLine(reason: SettleReason | undefined, exitPrice: number | null | undefined): string | null {
  if (reason === 'time') return TIME_UP_COPY;
  if (reason === 'exit' && exitPrice) return `EXIT LOCKED ${formatPrice(exitPrice, { unit: 'USDT' })}`;
  if (reason === 'target') return 'TARGET HIT · settling the payout';
  if (reason === 'stop') return 'STOP REACHED · settling the round';
  return null;
}

function titleFor(failed: boolean, practice: boolean, confirmed: boolean): string {
  if (failed) return SETTLE_FAILED_TITLE;
  if (practice) return confirmed ? 'Practice round complete' : 'Closing practice round…';
  return confirmed ? 'Confirmed on BNB Chain' : 'Settling on BNB Chain…';
}

function useActiveIndex(step: SettlementStep, variant: 'live' | 'practice'): number {
  const running = runningIndex(step, variant);
  const [lastRunning, setLastRunning] = useState(running ?? failedFallbackIndex(variant));
  if (running !== null && running !== lastRunning) setLastRunning(running);
  const steps = stepsFor(variant).length;
  return running ?? Math.min(lastRunning, steps - 1);
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
  const steps = stepsFor(variant);
  const phase = phaseOf(step);
  const failed = phase === 'failed';
  const confirmed = phase === 'confirmed';
  const activeIndex = useActiveIndex(step, variant);
  const context = practice ? null : reasonLine(reason, exitPrice);
  const title = titleFor(failed, practice, confirmed);
  const child = reduced ? REDUCED_CHILD : CHILD;
  const showTx = !practice && !!txHash;
  const announcement = stepDescription(steps, activeIndex, phase);

  return (
    <Scrim
      tone="dim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center px-4 py-6 pointer-events-auto"
    >
      <motion.div
        variants={reduced ? REDUCED_CARD : cardVariants}
        initial="hidden"
        animate="visible"
        exit={{ opacity: 0, transition: MICRO }}
        transition={{ ...STANDARD, staggerChildren: CHILD_STAGGER }}
        className="lg-card w-full max-w-sm px-5 py-6 flex flex-col items-center text-center"
      >
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {practice && (
          <motion.div variants={child} transition={STANDARD} className="mb-4">
            <Pill size="sm">{PRACTICE_PILL}</Pill>
          </motion.div>
        )}
        {context && (
          <motion.p
            variants={child}
            transition={STANDARD}
            className="mb-4 text-micro font-bold uppercase tracking-[0.08em] text-ink-soft tabular-nums"
          >
            {context}
          </motion.p>
        )}

        <motion.div variants={child} transition={STANDARD} className="mb-5">
          <ChainRing steps={steps} activeIndex={activeIndex} phase={phase} reduced={reduced} />
        </motion.div>

        <motion.div variants={child} transition={STANDARD} className="w-full mb-5">
          <ChainStepper steps={steps} activeIndex={activeIndex} phase={phase} reduced={reduced} />
        </motion.div>

        <motion.h3 variants={child} transition={STANDARD} className="grid text-section text-ink mb-1" aria-live="polite">
          <AnimatePresence initial={false}>
            <motion.span
              key={title}
              className="[grid-area:1/1]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MICRO}
            >
              {title}
            </motion.span>
          </AnimatePresence>
        </motion.h3>

        <motion.div variants={child} transition={STANDARD}>
          {failed ? (
            <div className="flex flex-col gap-1">
              <p className="text-caption text-ink-soft">{SETTLE_FAILED_BODY}</p>
              <p className="text-micro text-ink-muted">retrying… the round stays open until it settles</p>
            </div>
          ) : (
            <p className="text-caption text-ink-muted tabular-nums">
              {practice ? `${PRACTICE_SETTLE_COPY} · ` : 'Outcome '}
              {estimate && <span aria-hidden="true">≈ </span>}
              {estimate && <span className="sr-only">about </span>}
              <SignedAmount value={pnl} className="font-bold" />
            </p>
          )}
        </motion.div>

        <motion.div variants={child} transition={STANDARD} className="w-full">
          <AnimatePresence initial={false}>
            {showTx && (
              <motion.div
                key="tx"
                className="-mx-1 -mb-1 overflow-hidden px-1 pb-1"
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: reduced ? 'auto' : 0 }}
                transition={MICRO}
              >
                <a
                  href={explorerTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View transaction ${formatHash(txHash)} on BscScan testnet`}
                  className="mt-5 w-full min-h-12 flex items-center justify-between gap-3 px-4 rounded-md bg-well text-caption"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-ink-muted">Tx</span>
                    <span className="relative min-w-0 truncate tabular-nums font-semibold text-ink-secondary">
                      {formatHash(txHash)}
                      {!reduced && (
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-0 origin-right bg-well"
                          initial={{ scaleX: 1 }}
                          animate={{ scaleX: 0 }}
                          transition={{ delay: HASH_REVEAL_DELAY, duration: HASH_REVEAL_SECONDS, ease: EASE_OUT }}
                        />
                      )}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 font-bold text-ink-secondary shrink-0">
                    BscScan
                    <Icon name="external" size={EXTERNAL_ICON_SIZE} />
                  </span>
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </Scrim>
  );
};
