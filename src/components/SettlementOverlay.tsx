import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STANDARD, MICRO } from '../ui/motion';
import { CheckCircle2, ExternalLink, ShieldCheck, Zap, Key, Radio } from 'lucide-react';
import { SettlementStep } from '../services/web3Service';

interface SettlementOverlayProps {
  step: SettlementStep;
  txHash?: string;
  pnl: number;
}

const STEP_ORDER: SettlementStep[] = ['preparing', 'signing', 'submitted', 'confirmed'];

/** Icon + one-line caption per step — the "signing" moment now has its own
 * glyph (Key) rather than being one label among four always-visible ones. */
const stepMeta = (s: SettlementStep) => {
  switch (s) {
    case 'signing':
      return { icon: <Key className="w-7 h-7" />, caption: 'Signing', index: 1 };
    case 'submitted':
      return { icon: <Radio className="w-7 h-7" />, caption: 'Broadcasting', index: 2 };
    case 'confirmed':
      return { icon: <CheckCircle2 className="w-7 h-7" />, caption: 'Confirmed', index: 3 };
    case 'preparing':
    default:
      return { icon: <Zap className="w-7 h-7" />, caption: 'Preparing', index: 0 };
  }
};

const RING_SIZE = 104;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const SettlementOverlay: React.FC<SettlementOverlayProps> = ({ step, txHash, pnl }) => {
  const meta = stepMeta(step);
  const isConfirmed = step === 'confirmed';
  const progress = isConfirmed ? 1 : meta.index / (STEP_ORDER.length - 1);
  const accent = isConfirmed ? 'var(--color-long)' : 'var(--color-bnb-yellow)';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, zIndex: 40, transition: STANDARD }}
      exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center p-6 backdrop-blur-md pointer-events-auto"
      style={{ backgroundColor: 'rgba(5,9,20,0.75)' }}
    >
      <div
        className="w-full max-w-sm glass-panel rounded-[var(--radius-xl)] p-6 border flex flex-col items-center text-center"
        style={{ borderColor: 'rgba(240,185,11,0.3)', boxShadow: '0 0 50px rgba(240,185,11,0.25)' }}
      >
        {/* Circular progress ring — replaces the old 4-node horizontal
            pipeline. A single glyph morphs per SettlementStep at its
            center, so "signing" is a Key icon appearing, not a text row. */}
        <div className="relative mb-4" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
            />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              strokeWidth={RING_STROKE}
              fill="none"
              stroke={accent}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={false}
              animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress) }}
              transition={STANDARD}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: 0, transition: STANDARD }}
                exit={{ opacity: 0, scale: 0.6, transition: MICRO }}
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: accent, color: '#050914', boxShadow: `0 0 35px ${isConfirmed ? 'rgba(0,232,154,0.55)' : 'rgba(240,185,11,0.5)'}` }}
              >
                {meta.icon}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Single current-step caption, not four persistent labels. */}
        <AnimatePresence mode="wait">
          <motion.span
            key={step}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: MICRO }}
            exit={{ opacity: 0, transition: MICRO }}
            className="text-[11px] font-mono font-bold tracking-widest uppercase mb-3"
            style={{ color: accent }}
          >
            {meta.caption}
          </motion.span>
        </AnimatePresence>

        {/* Tiny at-a-glance progress dots, no labels. */}
        <div className="flex items-center gap-1.5 mb-4">
          {STEP_ORDER.map((s, idx) => {
            const filled = idx <= meta.index || isConfirmed;
            return (
              <span
                key={s}
                className="w-1.5 h-1.5 rounded-full transition-colors duration-300"
                style={{ backgroundColor: filled ? accent : 'rgba(255,255,255,0.15)' }}
              />
            );
          })}
        </div>

        <h3 className="text-base font-black uppercase tracking-wider mb-1 font-mono text-[color:var(--color-text-1)]">
          {isConfirmed ? (
            <span className="text-glow-green" style={{ color: 'var(--color-long)' }}>
              CONFIRMED ON-CHAIN
            </span>
          ) : (
            'SETTLING ON BNB CHAIN...'
          )}
        </h3>

        <div className="text-xs font-mono mb-5 text-[color:var(--color-text-3)]">
          Outcome:{' '}
          <span className="font-bold" style={{ color: pnl >= 0 ? 'var(--color-long)' : 'var(--color-short)' }}>
            {pnl < 0 ? '-' : '+'}${Math.abs(pnl).toFixed(2)}
          </span>
        </div>

        {txHash && (
          <a
            href={`https://bscscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl border text-[11px] font-mono transition-colors"
            style={{ backgroundColor: 'var(--color-bg-0)', borderColor: 'var(--color-line)', color: 'var(--color-text-2)' }}
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--color-long)' }} />
              Tx: {txHash.slice(0, 8)}...{txHash.slice(-6)}
            </span>
            <span className="flex items-center gap-1 font-bold" style={{ color: 'var(--color-bnb-yellow)' }}>
              BSC <ExternalLink className="w-3 h-3" />
            </span>
          </a>
        )}
      </div>
    </motion.div>
  );
};
