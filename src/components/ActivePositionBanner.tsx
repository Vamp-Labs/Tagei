import { motion } from 'motion/react';
import { ActiveTradeRound } from '../types/game';
import { STANDARD } from '../ui/motion';
import { DirectionChip, Icon, SignedAmount, WalletRow, formatAmount } from '../ui/lucky';

interface ActivePositionBannerProps {
  round: ActiveTradeRound;
  onTap: () => void;
}

const MotionWalletRow = motion.create(WalletRow);

export const ActivePositionBanner: React.FC<ActivePositionBannerProps> = ({ round, onTap }) => (
  <MotionWalletRow
    mode="button"
    compact
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 12 }}
    transition={STANDARD}
    onSelect={onTap}
    aria-label={`1 active position, ${round.asset} ${round.direction}, ${formatAmount(round.currentPnl)}. Open position details`}
    className="min-h-14 gap-2 py-2 pr-3 pointer-events-auto"
    icon={<DirectionChip direction={round.direction} size="sm" />}
    amount={
      <span className="block truncate text-micro font-semibold uppercase tracking-[0.08em] text-ink-soft">
        1 open · {round.asset}
      </span>
    }
    trailing={
      <span className="flex items-center gap-1">
        <SignedAmount value={round.currentPnl} className="whitespace-nowrap text-label font-bold" />
        <Icon name="chevron-right" size={20} className="shrink-0 text-ink-muted" />
      </span>
    }
  />
);
