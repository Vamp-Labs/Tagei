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
    className="lg-wallet lg-wallet--compact min-h-14 py-2 pr-3 pointer-events-auto"
  >
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <DirectionChip direction={round.direction} size="sm" />
      <span className="truncate text-micro font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {round.asset} · 1 active
      </span>
    </span>
    <SignedAmount value={round.currentPnl} className="text-label font-bold" />
    <Icon name="chevron-right" size={20} className="text-ink-muted shrink-0" />
  </motion.button>
);
