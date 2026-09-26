import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Volume2, Smartphone, Eye, Radio, Sparkles, Hand } from 'lucide-react';
import { UserSettings } from '../types/game';
import { useHandedness } from '../ui/useHandedness';
import { cardVariants, scrimVariants, STANDARD } from '../ui/motion';

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onClose: () => void;
}

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
        <motion.div
          key="settings-scrim"
          variants={scrimVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={STANDARD}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm"
          style={{
            paddingTop: 'calc(var(--sa-top) + 1rem)',
            paddingBottom: 'calc(var(--sa-bottom) + 1rem)',
          }}
        >
        <motion.div
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
          className="w-full max-w-sm glass-panel rounded-3xl p-5 border border-white/15 shadow-2xl cursor-grab active:cursor-grabbing"
        >
        {/* Grab handle — the swipe-to-dismiss affordance */}
        <div className="flex justify-center pb-3">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#F0B90B]" />
            <h3 className="text-sm font-black text-white uppercase tracking-wider">
              Settings & Accessibility
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Handedness — mirrors the thumb arc and the drawer's entry edge */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5">
              <Hand className="w-4 h-4 text-[#F0B90B]" />
              <div>
                <div className="text-xs font-bold text-white">Thumb Side</div>
                <div className="text-[10px] text-gray-400">
                  Puts the launch arc under your hand
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#070b19] border border-white/10">
              {(['left', 'right'] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setHand(side)}
                  className={`px-3 h-8 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    hand === side
                      ? 'bg-[#F0B90B] text-black'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>
          </div>

          {/* Reduced Motion Toggle (PRD §35) */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5">
              <Eye className="w-4 h-4 text-[#00F0FF]" />
              <div>
                <div className="text-xs font-bold text-white">Reduced Motion</div>
                <div className="text-[10px] text-gray-400">
                  Subdues pitch & turns off parallax
                </div>
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ reducedMotion: !settings.reducedMotion })}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.reducedMotion ? 'bg-[#00FFA3]' : 'bg-gray-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.reducedMotion ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Sound FX Toggle (PRD §34) */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-[#F0B90B]" />
              <div>
                <div className="text-xs font-bold text-white">Procedural Audio</div>
                <div className="text-[10px] text-gray-400">
                  Engine hum, locks & target chimes
                </div>
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ soundEnabled: !settings.soundEnabled })}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.soundEnabled ? 'bg-[#F0B90B]' : 'bg-gray-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-black transition-transform absolute top-1 ${
                  settings.soundEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Haptics Toggle (PRD §33) */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5">
              <Smartphone className="w-4 h-4 text-[#00FFA3]" />
              <div>
                <div className="text-xs font-bold text-white">Haptic Vibration</div>
                <div className="text-[10px] text-gray-400">
                  Feedback on taps & collisions
                </div>
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                settings.hapticsEnabled ? 'bg-[#00FFA3]' : 'bg-gray-700'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  settings.hapticsEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Data Feed Mode */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-2.5">
              <Radio className="w-4 h-4 text-[#FF0055]" />
              <div>
                <div className="text-xs font-bold text-white">Market Feed Mode</div>
                <div className="text-[10px] text-gray-400">
                  {settings.useLiveBinance ? 'Binance Live WebSocket' : 'High-Volatility Sandbox'}
                </div>
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ useLiveBinance: !settings.useLiveBinance })}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                settings.useLiveBinance
                  ? 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40'
                  : 'bg-[#F0B90B]/20 text-[#F0B90B] border border-[#F0B90B]/40'
              }`}
            >
              {settings.useLiveBinance ? 'LIVE' : 'SANDBOX'}
            </button>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs tracking-wider transition-colors cursor-pointer"
        >
          DONE
        </button>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
