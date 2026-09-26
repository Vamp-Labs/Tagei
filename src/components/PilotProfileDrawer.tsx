import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Award,
  Zap,
  Shield,
  Crown,
  Rocket,
  Flame,
  Wallet,
  CheckCircle2,
  Volume2,
  Smartphone,
  Radio,
  Hand,
  ExternalLink,
} from 'lucide-react';
import { UserProgression, UserSettings } from '../types/game';
import { WalletState } from '../services/web3Service';
import { soundEngine } from '../services/audioHaptics';
import { useHandedness } from '../ui/useHandedness';
import { STANDARD } from '../ui/motion';

interface PilotProfileDrawerProps {
  isOpen: boolean;
  progression: UserProgression;
  wallet: WalletState;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onConnectWallet: () => void;
  onClose: () => void;
}

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
  // The drawer enters from — and is flung back toward — the thumb's own edge.
  const edgeSign = hand === 'left' ? -1 : 1;

  const handleClose = () => {
    soundEngine.playClick();
    onClose();
  };

  const xpPct = Math.min(
    100,
    Math.round((progression.currentXp / progression.nextLevelXp) * 100)
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden select-none">
          {/* Dimmed Backdrop */}
          <motion.div
            onClick={handleClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={STANDARD}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Slide-over Sheet */}
          <motion.div
            initial={{ x: `${100 * edgeSign}%` }}
            animate={{ x: 0 }}
            exit={{ x: `${100 * edgeSign}%` }}
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
            className="pilot-drawer fixed inset-y-0 w-full max-w-sm bg-[#070b19]/95 backdrop-blur-2xl shadow-2xl flex flex-col"
            style={{
              paddingTop: 'var(--sa-top)',
              paddingBottom: 'var(--sa-bottom)',
            }}
          >
        {/* Grab handle — swipe toward the edge to dismiss */}
        <div className="flex justify-center pt-2 cursor-grab active:cursor-grabbing">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#F0B90B] flex items-center justify-center text-black font-black shadow-[0_0_15px_rgba(240,185,11,0.4)]">
              ⚡
            </div>
            <div>
              <div className="text-xs font-black tracking-widest text-white uppercase font-mono">
                PILOT DOSSIER
              </div>
              <div className="text-[10px] font-mono text-[#F0B90B]">
                ID: #BNB-{wallet.address ? wallet.address.slice(2, 6).toUpperCase() : '8849'}
              </div>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Level & Title Hero Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-white/[0.07] to-white/[0.02] border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#00FFA3]">
                <Award className="w-4 h-4" />
                <span>LEVEL {progression.level}</span>
              </div>
              <span className="text-[11px] font-mono text-gray-400">
                {progression.currentXp} / {progression.nextLevelXp} XP
              </span>
            </div>

            <div className="text-lg font-black text-white uppercase font-mono tracking-tight mb-2">
              {progression.title}
            </div>

            {/* XP Progress Bar */}
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-gradient-to-r from-[#F0B90B] to-[#00FFA3] rounded-full transition-all duration-500"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>

          {/* Career Telemetry Metrics */}
          <div>
            <div className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider mb-2">
              TELEMETRY & FLIGHT STATS
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/5 flex flex-col items-center text-center">
                <Flame className="w-4 h-4 text-[#F0B90B] mb-1" />
                <span className="text-sm font-black text-white font-mono">
                  {progression.streakDays ?? 3}D
                </span>
                <span className="text-[9px] text-gray-400 uppercase font-mono">Streak</span>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/5 flex flex-col items-center text-center">
                <Zap className="w-4 h-4 text-[#00FFA3] mb-1" />
                <span className="text-sm font-black text-white font-mono">68%</span>
                <span className="text-[9px] text-gray-400 uppercase font-mono">Win Rate</span>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.04] border border-white/5 flex flex-col items-center text-center">
                <Crown className="w-4 h-4 text-[#00F0FF] mb-1" />
                <span className="text-sm font-black text-white font-mono">2.84x</span>
                <span className="text-[9px] text-gray-400 uppercase font-mono">Best Payout</span>
              </div>
            </div>
          </div>

          {/* Web3 BNB Chain Settlement Card */}
          <div className="p-3.5 rounded-2xl bg-[#0e162e] border border-[#F0B90B]/25">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#F0B90B]">
                <Wallet className="w-4 h-4" />
                <span>BNB CHAIN TESTNET</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#00FFA3]/15 text-[#00FFA3] border border-[#00FFA3]/30">
                ACTIVE (97)
              </span>
            </div>

            {wallet.isConnected ? (
              <div className="flex items-center justify-between text-xs font-mono text-gray-300">
                <span>{wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}</span>
                <span className="font-bold text-white">{wallet.balanceBNB} tBNB</span>
              </div>
            ) : (
              <button
                onClick={onConnectWallet}
                className="w-full mt-1 py-2 px-3 rounded-xl bg-[#F0B90B] hover:bg-[#D4A109] text-black font-mono text-xs font-black uppercase transition-all cursor-pointer"
              >
                Connect Pilot Wallet
              </button>
            )}
          </div>

          {/* Pilot Achievement Badges */}
          <div>
            <div className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider mb-2">
              PILOT HONORS & BADGES
            </div>
            <div className="flex flex-col gap-2">
              <div className="p-2.5 rounded-xl bg-white/[0.04] border border-[#00FFA3]/30 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#00FFA3]/15 flex items-center justify-center text-[#00FFA3] flex-shrink-0">
                  <Rocket className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-white font-mono">First Orbit</div>
                  <div className="text-[10px] text-gray-400">Completed first live market flight</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[#00FFA3]" />
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.04] border border-[#00FFA3]/30 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#00FFA3]/15 flex items-center justify-center text-[#00FFA3] flex-shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-white font-mono">Hyperdrive Pilot</div>
                  <div className="text-[10px] text-gray-400">Achieved +2.0x multiplier on live trade</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[#00FFA3]" />
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.04] border border-[#00FFA3]/30 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#00FFA3]/15 flex items-center justify-center text-[#00FFA3] flex-shrink-0">
                  <Shield className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-white font-mono">Iron Discipline</div>
                  <div className="text-[10px] text-gray-400">Preserved capital via disciplined cash out</div>
                </div>
                <CheckCircle2 className="w-4 h-4 text-[#00FFA3]" />
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-3 opacity-60">
                <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 flex-shrink-0">
                  <Crown className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-gray-300 font-mono">Whale Hunter</div>
                  <div className="text-[10px] text-gray-500">Reach 5-round win streak (3/5)</div>
                </div>
                <span className="text-[10px] font-mono font-bold text-gray-500">LOCKED</span>
              </div>
            </div>
          </div>

          {/* Quick Cockpit Settings */}
          <div>
            <div className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider mb-2">
              COCKPIT CONTROLS
            </div>
            <div className="flex flex-col gap-2">
              {/* Thumb side — mirrors the launch arc and this drawer's edge */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/5">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                  <Hand className="w-4 h-4 text-[#F0B90B]" />
                  <span>Thumb Side</span>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[#070b19] border border-white/10">
                  {(['left', 'right'] as const).map((side) => (
                    <button
                      key={side}
                      onClick={() => setHand(side)}
                      className={`px-2.5 h-7 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                        hand === side ? 'bg-[#F0B90B] text-black' : 'text-gray-400'
                      }`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sound toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/5">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                  <Volume2 className="w-4 h-4 text-[#00FFA3]" />
                  <span>Sound Effects</span>
                </div>
                <button
                  onClick={() => onUpdateSettings({ soundEnabled: !settings.soundEnabled })}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    settings.soundEnabled ? 'bg-[#00FFA3]' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                      settings.soundEnabled ? 'left-5' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Haptics toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/5">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                  <Smartphone className="w-4 h-4 text-[#F0B90B]" />
                  <span>Haptic Vibration</span>
                </div>
                <button
                  onClick={() => onUpdateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    settings.hapticsEnabled ? 'bg-[#00FFA3]' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                      settings.hapticsEnabled ? 'left-5' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Binance Live WebSocket Toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] border border-white/5">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
                  <Radio className="w-4 h-4 text-[#00F0FF]" />
                  <span>Binance Live Stream</span>
                </div>
                <button
                  onClick={() => onUpdateSettings({ useLiveBinance: !settings.useLiveBinance })}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    settings.useLiveBinance ? 'bg-[#00FFA3]' : 'bg-gray-700'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                      settings.useLiveBinance ? 'left-5' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-white/10 text-center">
          <a
            href="https://testnet.bscscan.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-mono text-gray-400 hover:text-[#F0B90B] transition-colors"
          >
            <span>Verified on BscScan</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
