import { Rocket, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { ActiveTradeRound } from '../types/game';
import { STANDARD } from '../ui/motion';

interface ActivePositionBannerProps {
  round: ActiveTradeRound;
  onTap: () => void;
}

/**
 * docs/UI_UX_SPEC.md §12 — a pill above the swipe-up affordance on Home,
 * shown only while a round is active. Tap → Position Details.
 */
export const ActivePositionBanner: React.FC<ActivePositionBannerProps> = ({ round, onTap }) => {
  const isProfit = round.currentPnl >= 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={STANDARD}
      onClick={onTap}
      className="w-full flex items-center justify-between gap-2 px-4 h-[var(--tap-min)] rounded-[var(--radius-md)] border border-[color:var(--color-line)] bg-[color:var(--color-panel-soft)] backdrop-blur-md pointer-events-auto cursor-pointer"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Rocket className="w-4 h-4 text-[color:var(--color-bnb-yellow)] shrink-0" />
        <span className="text-[length:var(--text-metadata)] font-bold text-[color:var(--color-text-1)] uppercase tracking-wide truncate">
          1 Active Position
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className="font-mono text-[length:var(--text-metadata)] font-bold"
          style={{ color: isProfit ? 'var(--color-long)' : 'var(--color-short)' }}
        >
          {isProfit ? '+' : '-'}${Math.abs(round.currentPnl).toFixed(2)}
        </span>
        <ChevronRight className="w-4 h-4 text-[color:var(--color-text-3)]" />
      </div>
    </motion.button>
  );
};
