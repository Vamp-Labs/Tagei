import { useState } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Sheet } from '../ui/Sheet';
import { STANDARD, staggerChildVariants, staggerVariants, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { Badge, Pill, SegmentedTabs, SheetHeader, WalletRow, formatXp, type PillTone, type SegmentedTabsItem } from '../ui/lucky';
import { apiClient } from '../api/runtime';
import type { LeaderboardEntry } from '../api/client';
import { isOwnEntry, medalTone } from './game/leaderboard';

interface LeaderboardProps {
  ownAddress: string | null;
  onClose: () => void;
}

type Period = 'weekly' | 'all';

const PERIOD_ITEMS: SegmentedTabsItem<Period>[] = [
  { value: 'weekly', label: 'This Week' },
  { value: 'all', label: 'All Time' },
];

const MEDAL_PILL: Record<'gold' | 'silver' | 'bronze', { tone: PillTone; label: string }> = {
  gold: { tone: 'gold', label: '1st' },
  silver: { tone: 'neutral', label: '2nd' },
  bronze: { tone: 'amber', label: '3rd' },
};

const rankIcon = (rank: number) => {
  const tone = medalTone(rank);
  if (!tone) return <span className="text-caption font-semibold text-ink-muted">#{rank}</span>;
  const { tone: pillTone, label } = MEDAL_PILL[tone];
  return (
    <Pill tone={pillTone} size="sm">
      {label}
    </Pill>
  );
};

function LeaderboardRow({ entry, own }: { entry: LeaderboardEntry; own: boolean }) {
  return (
    <WalletRow
      mode="static"
      icon={rankIcon(entry.rank)}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{entry.displayName}</span>
          {own && <Badge tone="count">You</Badge>}
        </span>
      }
      amount={formatXp(entry.xp)}
      bonus={entry.title}
      bonusTone="muted"
      trailing={`Lv ${entry.level}`}
      className={cn(own && 'ring-2 ring-lucky')}
    />
  );
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ ownAddress, onClose }) => {
  const [period, setPeriod] = useState<Period>('weekly');
  const reduced = useMotionPref();
  const query = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: () => apiClient.leaderboard(period),
    enabled: apiClient.isEnabled(),
    staleTime: 30_000,
  });
  const entries = query.data ?? [];

  return (
    <Sheet onClose={onClose}>
      <SheetHeader title="Leaderboard" subtitle="Weekly rankings reset Monday 00:00 UTC" />

      <div className="flex flex-col gap-3 px-6 pb-3">
        <SegmentedTabs items={PERIOD_ITEMS} value={period} onChange={setPeriod} surface="sheet" ariaLabel="Leaderboard period" />

        {query.isLoading ? (
          <p className="py-6 text-center text-caption text-ink-muted">Loading rankings…</p>
        ) : query.isError ? (
          <p role="alert" className="py-6 text-center text-caption text-ink-muted">
            Couldn't load the leaderboard. Try again shortly.
          </p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-caption text-ink-muted">No rankings yet — be the first to play.</p>
        ) : reduced ? (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <LeaderboardRow key={entry.address} entry={entry} own={isOwnEntry(entry, ownAddress)} />
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerVariants}
            initial="hidden"
            animate="visible"
            transition={{ ...STANDARD, staggerChildren: 0.04 }}
            className="flex flex-col gap-2"
          >
            {entries.map((entry) => (
              <motion.div key={entry.address} variants={staggerChildVariants} transition={STANDARD}>
                <LeaderboardRow entry={entry} own={isOwnEntry(entry, ownAddress)} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </Sheet>
  );
};
