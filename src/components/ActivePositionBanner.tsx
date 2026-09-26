import { motion } from 'motion/react';
import { ActiveTradeRound } from '../types/game';
import { STANDARD } from '../ui/motion';
import { DirectionChip, Icon, SignedAmount, formatAmount } from '../ui/lucky';

interface ActivePositionBannerProps {
  round: ActiveTradeRound;
  onTap: () => void;
}

export const ActivePositionBanner: React.FC<ActivePositionBannerProps> = ({ round, onTap }) => (
  <motion.button
    type="button"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 12 }}
    transition={STANDARD}
    onClick={onTap}
    aria-label={`1 active position, ${round.asset} ${round.direction}, ${formatAmount(round.currentPnl)}. Open position details`}
    className="lg-wallet lg-wallet--compact pr-3 pointer-events-auto"
  >
    <span className="lg-wallet-text gap-1">
      <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">1 active position</span>
      <span className="flex items-center gap-2">
        <DirectionChip direction={round.direction} size="sm" />
        <span className="text-micro font-semibold uppercase tracking-[0.08em] text-ink-soft">{round.asset}</span>
      </span>
    </span>
    <SignedAmount value={round.currentPnl} className="text-label font-bold" />
    <Icon name="chevron-right" size={20} className="text-ink-muted shrink-0" />
  </motion.button>
);
