import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { UserProgression, UserSettings } from '../types/game';
import { WalletState } from '../services/web3Service';
import { soundEngine } from '../services/audioHaptics';
import { useHandedness } from '../ui/useHandedness';
import { STANDARD, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import {
  ART,
  BalanceHeader,
  Button,
  Panel,
  ProgressBar,
  Scrim,
  SheetHeader,
  StatTile,
  Toggle,
  buttonClass,
  formatXp,
} from '../ui/lucky';
import { AvatarDisc } from './account/AvatarDisc';
import { BadgeGrid, type ProfileBadge } from './account/BadgeGrid';
import { ChainCard } from './account/ChainCard';
import { ChoiceRow } from './account/ChoiceRow';
import { HAND_ITEMS, THUMB_SIDE_COPY, settingPatch, type SettingToggle } from './account/settings';

interface PilotProfileDrawerProps {
  isOpen: boolean;
  progression: UserProgression;
  wallet: WalletState;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onConnectWallet: () => void;
  onClose: () => void;
}

const PILOT_ID = '#BNB-8849';

const badges: readonly ProfileBadge[] = [
  {
    id: 'first-orbit',
    name: 'First Orbit',
    description: 'Completed first live market flight',
    art: 'reward-gift',
    earned: true,
  },
  {
    id: 'hyperdrive-pilot',
    name: 'Hyperdrive Pilot',
    description: 'Achieved +2.0x multiplier on live trade',
    art: 'reward-crown',
    earned: true,
  },
  {
    id: 'iron-discipline',
    name: 'Iron Discipline',
    description: 'Preserved capital via disciplined cash out',
    art: 'reward-clover',
    earned: true,
  },
  {
    id: 'whale-hunter',
    name: 'Whale Hunter',
    description: 'Reach 5-round win streak',
    art: 'locked-crown',
    earned: false,
    progress: { current: 3, goal: 5 },
  },
];

const controlToggles: readonly SettingToggle[] = [
  { key: 'soundEnabled', label: 'Sound effects' },
  { key: 'hapticsEnabled', label: 'Haptic vibration' },
  { key: 'useLiveBinance', label: 'Binance live stream' },
];

const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

const splitTitle = (title: string) => {
  const [brand = '', ...rest] = title.split(/\s+/).filter(Boolean).map(titleCase);
  return { brand, word: rest.join(' ') };
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const PilotProfileDrawer: React.FC<PilotProfileDrawerProps> = ({
  isOpen,
  progression,
  wallet,
  settings,
  onUpdateSettings,
  onConnectWallet,
  onClose,
}) => {
  const [hand, setHand] = useHandedness();
  const reduced = useMotionPref();
  // The drawer enters from — and is flung back toward — the thumb's own edge.
  const edgeSign = hand === 'left' ? -1 : 1;
  const offscreen = reduced ? { opacity: 0 } : { x: `${100 * edgeSign}%` };
  const onscreen = reduced ? { opacity: 1 } : { x: 0 };

  const handleClose = () => {
    soundEngine.playClick();
    onClose();
  };

  const { brand, word } = splitTitle(progression.title);
  const nextLevel = progression.level + 1;
  const xpToNext = Math.max(0, progression.nextLevelXp - progression.currentXp);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden select-none">
          <Scrim
            tone="dim"
            onClick={handleClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={STANDARD}
            className="fixed inset-0"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Pilot Profile"
            initial={offscreen}
            animate={onscreen}
            exit={offscreen}
            transition={STANDARD}
            drag="x"
            dragDirectionLock
            dragSnapToOrigin
            dragElastic={0.18}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x * edgeSign > 90 || info.velocity.x * edgeSign > 500) {
                handleClose();
              }
            }}
            className="pilot-drawer fixed inset-y-0 flex w-full max-w-sm flex-col bg-sheet shadow-lift"
            style={{
              paddingTop: 'var(--sa-top)',
              paddingBottom: 'var(--sa-bottom)',
            }}
          >
            <div className="flex cursor-grab justify-center pt-3 active:cursor-grabbing">
              <span className="lg-grabber" aria-hidden="true" />
            </div>

            <SheetHeader
              eyebrow={<AvatarDisc className="mx-auto mb-2" />}
              title="Pilot Profile"
              subtitle={<span className="tabular-nums">id {PILOT_ID}</span>}
              action={
                <Button variant="icon" size="md" icon="close" aria-label="Close profile" onClick={handleClose} />
              }
              className="px-6 pb-4 pt-2"
            />

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-6 pb-4">
              <Panel as="div" className="flex flex-col gap-3 p-3">
                <BalanceHeader
                  brand={brand}
                  word={word}
                  value={formatXp(progression.currentXp)}
                  art={ART.coin.src}
                  className="px-3 pb-1 pt-2 [&_b]:whitespace-nowrap"
                />
                <ProgressBar
                  value={progression.currentXp}
                  max={progression.nextLevelXp}
                  next={nextLevel}
                  label={`Level ${progression.level} progress`}
                />
                <p className="px-1 text-caption tabular-nums text-ink-soft">
                  {formatXp(xpToNext)} to level {nextLevel}
                </p>
              </Panel>

              <Panel title="Stats" className="p-3 pt-4">
                <div className="lg-stats [&>.lg-stat-tile]:justify-start">
                  <StatTile value={plural(progression.streakDays ?? 0, 'day', 'days')} label="Streak" />
                  <StatTile
                    value={`${progression.dailyRoundsPlayed}/${progression.dailyRoundsGoal}`}
                    label="Rounds today"
                  />
                  <StatTile value={progression.level} label="Level" />
                </div>
              </Panel>

              <ChainCard wallet={wallet} onConnectWallet={onConnectWallet} />

              <BadgeGrid badges={badges} />

              <Panel title="Controls" className="flex flex-col gap-2 p-3 pt-4">
                <ChoiceRow
                  label={THUMB_SIDE_COPY.label}
                  description={THUMB_SIDE_COPY.description}
                  ariaLabel="Thumb side"
                  items={HAND_ITEMS}
                  value={hand}
                  onChange={setHand}
                />
                {controlToggles.map((toggle) => (
                  <Toggle
                    key={toggle.key}
                    checked={settings[toggle.key]}
                    onChange={(next) => onUpdateSettings(settingPatch(toggle.key, next))}
                    label={toggle.label}
                    description={toggle.description}
                  />
                ))}
              </Panel>
            </div>

            <div className="flex justify-center border-t border-line px-6 py-2">
              <a
                href="https://testnet.bscscan.com"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonClass('ghost', 'md'), 'text-info')}
              >
                Verified on BscScan
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
