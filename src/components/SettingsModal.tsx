import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { UserSettings } from '../types/game';
import { useHandedness } from '../ui/useHandedness';
import { cardVariants, scrimVariants, STANDARD } from '../ui/motion';
import { Button, Panel, Scrim, SheetHeader, Toggle, type SegmentedTabsItem } from '../ui/lucky';
import { ChoiceRow } from './account/ChoiceRow';
import { HAND_ITEMS, THUMB_SIDE_COPY, settingPatch, type SettingToggle } from './account/settings';

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onClose: () => void;
}

type FeedMode = 'sandbox' | 'live';

const FEED_ITEMS: readonly SegmentedTabsItem<FeedMode>[] = [
  { value: 'sandbox', label: 'Sandbox' },
  { value: 'live', label: 'Live' },
];

const settingsToggles: readonly SettingToggle[] = [
  { key: 'reducedMotion', label: 'Reduced motion', description: 'Subdues pitch and turns off parallax' },
  { key: 'soundEnabled', label: 'Sound effects', description: 'Engine hum, locks and target chimes' },
  { key: 'hapticsEnabled', label: 'Haptic vibration', description: 'Feedback on taps and collisions' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const [hand, setHand] = useHandedness();

  return (
    <AnimatePresence>
      {isOpen && (
        <Scrim
          key="settings-scrim"
          tone="dim"
          variants={scrimVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={STANDARD}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{
            paddingTop: 'calc(var(--sa-top) + 1rem)',
            paddingBottom: 'calc(var(--sa-bottom) + 1rem)',
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={STANDARD}
            drag="y"
            dragSnapToOrigin
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragConstraints={{ top: 0, bottom: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) onClose();
            }}
            onClick={(event) => event.stopPropagation()}
            className="lg-card w-full max-w-sm cursor-grab p-3 active:cursor-grabbing"
          >
            <div className="flex justify-center pb-1 pt-1">
              <span className="lg-grabber" aria-hidden="true" />
            </div>
            <SheetHeader
              title="Settings"
              action={<Button variant="icon" size="md" icon="close" aria-label="Close settings" onClick={onClose} />}
              className="px-1 pb-3 pt-2"
            />

            <Panel as="div" className="flex flex-col gap-2 p-2">
              <ChoiceRow
                label={THUMB_SIDE_COPY.label}
                description={THUMB_SIDE_COPY.description}
                ariaLabel="Thumb side"
                items={HAND_ITEMS}
                value={hand}
                onChange={setHand}
              />
              {settingsToggles.map((toggle) => (
                <Toggle
                  key={toggle.key}
                  checked={settings[toggle.key]}
                  onChange={(next) => onUpdateSettings(settingPatch(toggle.key, next))}
                  label={toggle.label}
                  description={toggle.description}
                />
              ))}
              <ChoiceRow
                label="Market feed"
                description={settings.useLiveBinance ? 'Binance live WebSocket' : 'High-volatility sandbox'}
                ariaLabel="Market feed mode"
                items={FEED_ITEMS}
                value={settings.useLiveBinance ? 'live' : 'sandbox'}
                onChange={(mode) => onUpdateSettings({ useLiveBinance: mode === 'live' })}
              />
            </Panel>

            <Button variant="secondary" size="md" block onClick={onClose} className="mt-3">
              Done
            </Button>
          </motion.div>
        </Scrim>
      )}
    </AnimatePresence>
  );
};
