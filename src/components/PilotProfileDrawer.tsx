import React, { useRef } from 'react';
import { bscTestnet, explorerAddressUrl } from '@bnbplay/shared/chain';
import { AnimatePresence, motion } from 'motion/react';
import { UserProgression, UserSettings } from '../types/game';
import { WalletState } from '../services/web3Service';
import { soundEngine } from '../services/audioHaptics';
import { useHandedness } from '../ui/useHandedness';
import { useDialogFocus } from '../ui/useDialogFocus';
import { STANDARD, useMotionPref } from '../ui/motion';
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
  formatHash,
  formatXp,
} from '../ui/lucky';
import { AvatarDisc } from './account/AvatarDisc';
import { BadgeGrid, type ProfileBadge } from './account/BadgeGrid';
import { ChainCard } from './account/ChainCard';
import { ChoiceRow } from './account/ChoiceRow';
import { GuestKeyCard } from './account/GuestKeyCard';
import { pilotTitle } from './game/progression';
import { HAND_ITEMS, THUMB_SIDE_COPY, practiceToggleCopy, settingPatch, type SettingToggle } from './account/settings';

interface PilotProfileDrawerProps {
  isOpen: boolean;
  progression: UserProgression;
  wallet: WalletState;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onConnectWallet: () => void;
  onClose: () => void;
  badges: readonly ProfileBadge[];
  practiceMode: boolean;
  onPracticeModeChange: (practice: boolean) => void;
  modeLocked: boolean;
  liveAvailable: boolean;
}

const controlToggles: readonly SettingToggle[] = [
  { key: 'soundEnabled', label: 'Sound effects' },
  { key: 'hapticsEnabled', label: 'Haptic vibration' },
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
  badges,
  practiceMode,
  onPracticeModeChange,
  modeLocked,
  liveAvailable,
}) => {
  const [hand, setHand] = useHandedness();
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionPref();
  // The drawer enters from — and is flung back toward — the thumb's own edge.
  const edgeSign = hand === 'left' ? -1 : 1;
  const offscreen = reduced ? { opacity: 0 } : { x: `${100 * edgeSign}%` };
  const onscreen = reduced ? { opacity: 1 } : { x: 0 };

  const handleClose = () => {
    soundEngine.playClick();
    onClose();
  };

  useDialogFocus(dialogRef, isOpen, handleClose);

  const { brand, word } = splitTitle(pilotTitle(progression));
  const pilotId = wallet.isConnected && wallet.address ? formatHash(wallet.address) : 'not connected';
  const explorerHref = wallet.isConnected && wallet.address ? explorerAddressUrl(wallet.address) : bscTestnet.explorer;
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
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Pilot Profile"
            tabIndex={-1}
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
              subtitle={<span className="tabular-nums">id {pilotId}</span>}
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
                  className="px-3 pb-1 pt-2"
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
                <div className="lg-stats">
                  <StatTile value={plural(progression.streakDays ?? 0, 'day', 'days')} label="Streak" />
                  <StatTile
                    value={`${progression.dailyRoundsPlayed}/${progression.dailyRoundsGoal}`}
                    label="Today"
                  />
                  <StatTile value={progression.level} label="Level" />
                </div>
              </Panel>

              <ChainCard wallet={wallet} onConnectWallet={onConnectWallet} />

              <BadgeGrid badges={badges} />

              {wallet.isConnected && wallet.kind === 'guest' && <GuestKeyCard />}

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
                <Toggle
                  checked={practiceMode}
                  onChange={onPracticeModeChange}
                  disabled={modeLocked || (!liveAvailable && practiceMode)}
                  label="Practice mode"
                  description={practiceToggleCopy(modeLocked, liveAvailable)}
                />
              </Panel>
            </div>

            <div className="flex justify-center border-t border-line px-6 py-2">
              <a href={explorerHref} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'md')}>
                View on BscScan testnet
              </a>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
