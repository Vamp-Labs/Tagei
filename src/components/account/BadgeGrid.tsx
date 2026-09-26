import React from 'react';
import { ART, Panel, RewardTile, type ArtName } from '../../ui/lucky';

export interface ProfileBadge {
  id: string;
  name: string;
  description: string;
  art: ArtName;
  earned: boolean;
  progress?: { current: number; goal: number };
}

const NEARLY_THERE_PCT = 80;

const badgeLabel = (badge: ProfileBadge) =>
  badge.earned
    ? `${badge.name}, earned. ${badge.description}`
    : `${badge.name}, locked, ${badge.progress?.current ?? 0} of ${badge.progress?.goal ?? 0}. ${badge.description}`;

const badgePct = ({ progress }: ProfileBadge) =>
  progress && progress.goal > 0 ? Math.round((progress.current / progress.goal) * 100) : 0;

export const BadgeGrid: React.FC<{ badges: readonly ProfileBadge[] }> = ({ badges }) => (
  <Panel title="Badges" className="p-3 pt-4">
    <ul className="grid grid-cols-3 justify-items-center gap-x-2 gap-y-3">
      {badges.map((badge) => {
        const pct = badgePct(badge);
        return (
          <li key={badge.id} className="flex w-full flex-col items-center gap-1.5">
            <RewardTile
              state={badge.earned ? 'claimed' : 'locked'}
              art={ART[badge.art].src}
              label={badgeLabel(badge)}
              timer={badge.progress && !badge.earned ? `${badge.progress.current}/${badge.progress.goal}` : undefined}
              progress={badge.earned ? undefined : pct}
              progressTone={pct >= NEARLY_THERE_PCT ? 'lucky' : 'amber'}
            />
            <span
              aria-hidden="true"
              className={`text-center text-micro font-semibold ${badge.earned ? 'text-ink-soft' : 'text-ink-muted'}`}
            >
              {badge.name}
            </span>
          </li>
        );
      })}
    </ul>
  </Panel>
);
