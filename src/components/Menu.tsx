import React from 'react';
import { Sheet } from '../ui/Sheet';
import { cn } from '../ui/cn';
import { ART, Badge, Button, Icon, Panel, Pill, formatXp } from '../ui/lucky';
import { UserProgression } from '../types/game';
import { streakBonusXp } from './game/progression';
import { AvatarDisc } from './account/AvatarDisc';

interface MenuProps {
  progression: UserProgression;
  isWalletConnected: boolean;
  displayName: string;
  openPositions: number;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onDisconnect: () => void;
}

interface RowProps {
  label: string;
  badge?: number;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ label, badge, onClick, disabled, icon }) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    aria-disabled={disabled || undefined}
    className={cn(
      'flex min-h-14 w-full items-center gap-3 rounded-md bg-well px-4 text-left transition-colors',
      disabled ? 'cursor-default text-ink-muted' : 'cursor-pointer text-ink hover:bg-control active:bg-control'
    )}
  >
    {icon}
    <span className="flex-1 text-label">{label}</span>
    {badge != null && badge > 0 && (
      <Badge tone="count" label={`${badge} open`} className="h-7 min-w-7 px-2 text-body leading-none font-extrabold">
        {badge}
      </Badge>
    )}
    {disabled ? (
      <Pill size="sm">soon</Pill>
    ) : (
      <Icon name="chevron-right" size={20} className="text-ink-muted" />
    )}
  </button>
);

export const Menu: React.FC<MenuProps> = ({
  progression,
  isWalletConnected,
  displayName,
  openPositions,
  onClose,
  onOpenProfile,
  onOpenSettings,
  onDisconnect,
}) => {
  const streakDays = progression.streakDays ?? 0;
  const rows: RowProps[] = [
    { label: 'Positions', badge: openPositions, disabled: true },
    { label: 'History', disabled: true },
    { label: 'Profile', onClick: onOpenProfile },
    { label: 'Settings', onClick: onOpenSettings },
    { label: 'Help & Support', disabled: true },
  ];

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-3 px-6 pb-4 pt-1">
        <AvatarDisc />
        <div className="min-w-0">
          <div className="truncate text-section font-extrabold text-ink">{displayName}</div>
          <div className="text-caption tabular-nums text-ink-soft">
            <span className="font-bold text-lucky">Level {progression.level}</span> ·{' '}
            {formatXp(progression.currentXp)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-6 pb-2">
        <Panel as="div" className="flex flex-col gap-2 p-3">
          <nav aria-label="Menu" className="flex flex-col gap-2">
            {rows.map((row) => (
              <Row key={row.label} {...row} />
            ))}
          </nav>
        </Panel>

        <div className="flex min-h-14 items-center gap-3 rounded-md bg-well py-2 pl-2 pr-4">
          <span className="grid size-10 flex-none place-items-center rounded-sm bg-tile">
            <img src={ART['reward-gift'].src} alt="" width={36} height={33} />
          </span>
          <span className="flex-1 text-caption font-semibold text-ink">
            Daily streak · {streakDays} {streakDays === 1 ? 'day' : 'days'}
          </span>
          <span className="text-caption font-bold tabular-nums text-lucky">
            {formatXp(streakBonusXp(streakDays), { sign: 'always' })}
          </span>
        </div>

        {isWalletConnected && (
          <Button variant="secondary" size="md" block onClick={onDisconnect}>
            Disconnect wallet
          </Button>
        )}
      </div>
    </Sheet>
  );
};
