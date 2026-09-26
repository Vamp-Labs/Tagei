import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TrendingUp, TrendingDown, Zap, AlertTriangle, PlayCircle, X, Wrench, Rocket, Shield } from 'lucide-react';
import { GameStage } from '../types/game';
import { MICRO, STANDARD } from '../ui/motion';

interface SimulationBarProps {
  currentStage: GameStage;
  autoResolveEnabled: boolean;
  onToggleAutoResolve: () => void;
  onSimulateLiveLong: () => void;
  onSetStage: (stage: GameStage) => void;
  onSimulatePriceBump: (pct: number) => void;
  onSimulateTargetHit: () => void;
  onSimulateLossHit: () => void;
  onSimulateCashOut: () => void;
  onTriggerMissionToast?: () => void;
}

export const SimulationBar: React.FC<SimulationBarProps> = ({
  currentStage,
  autoResolveEnabled,
  onToggleAutoResolve,
  onSimulateLiveLong,
  onSetStage,
  onSimulatePriceBump,
  onSimulateTargetHit,
  onSimulateLossHit,
  onSimulateCashOut,
  onTriggerMissionToast,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  return (
    <>
      {/* Demo toolbar. Parked as an edge tab at mid-height: the bottom-right
          corner it used to sit in is now the launch arc's apex. */}
      {!isOpen && (
        <motion.button
          onClick={() => setIsOpen(true)}
          whileTap={{ scale: 0.95 }}
          transition={MICRO}
          className="fixed top-1/2 right-0 -translate-y-1/2 z-50 flex flex-col items-center gap-1 px-1.5 py-3 rounded-l-xl bg-[#070b19]/90 border border-r-0 border-[#00F0FF]/40 text-[#00F0FF] shadow-[0_0_15px_rgba(0,240,255,0.3)] backdrop-blur-md text-[9px] font-mono font-black cursor-pointer"
        >
          <Wrench className="w-3 h-3 text-[#00F0FF] animate-spin [animation-duration:10s]" />
          <span className="[writing-mode:vertical-rl] tracking-widest">SIM</span>
          {!autoResolveEnabled && (
            <span className="w-2 h-2 rounded-full bg-[#00FFA3] animate-pulse" title="Infinite Fly active" />
          )}
        </motion.button>
      )}

      {/* Slide-in simulation modal drawer */}
      <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, zIndex: 50, transition: STANDARD }}
          exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs p-3"
          style={{ paddingBottom: 'calc(var(--sa-bottom) + 0.75rem)' }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={STANDARD}
            drag="y"
            dragSnapToOrigin
            dragElastic={{ top: 0, bottom: 0.4 }}
            dragConstraints={{ top: 0, bottom: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 500) setIsOpen(false);
            }}
            className="w-full max-w-sm bg-[#070b19]/95 border border-[#00F0FF]/40 rounded-3xl p-4 shadow-2xl font-sans max-h-[80svh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00F0FF] animate-ping" />
                <span className="font-extrabold text-[#00F0FF] tracking-wider text-xs">
                  MOCK SIMULATOR
                </span>
                <span className="px-2 py-0.5 rounded-md bg-white/10 font-mono text-[10px] text-gray-300">
                  {currentStage}
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Feature 1: Sim Live LONG (No Auto-End) */}
            <div className="mb-3 p-2.5 rounded-2xl bg-gradient-to-r from-[#00FFA3]/15 to-[#00F0FF]/15 border border-[#00FFA3]/30">
              <div className="text-[10px] font-extrabold text-[#00FFA3] uppercase tracking-wider mb-1 flex items-center gap-1.5 font-mono">
                <Rocket className="w-3.5 h-3.5 text-[#00FFA3]" />
                <span>Simulate Live Flight</span>
              </div>
              <p className="text-[10px] text-gray-300 mb-2 leading-tight">
                Instantly flies live with LONG active. Observe the Untung/Rugi zones on the chart without auto win/lose interruption!
              </p>
              <button
                onClick={() => {
                  onSimulateLiveLong();
                  setIsOpen(false);
                }}
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-[#00FFA3] to-[#00F0FF] text-black font-black text-xs tracking-wide flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(0,255,163,0.4)] active:scale-95 cursor-pointer"
              >
                <Rocket className="w-4 h-4" />
                <span>START LIVE LONG (NO AUTO-END)</span>
              </button>
            </div>

            {/* Auto-Resolve Win/Loss Toggle */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10 mb-3 text-xs">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#F0B90B]" />
                <div>
                  <div className="font-bold text-white text-[11px]">Auto-Resolve Win/Loss</div>
                  <div className="text-[9px] text-gray-400">
                    {autoResolveEnabled ? 'Round auto-ends on target/stop' : 'Infinite flight (manual resolve only)'}
                  </div>
                </div>
              </div>
              <button
                onClick={onToggleAutoResolve}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-black transition-colors cursor-pointer ${
                  autoResolveEnabled
                    ? 'bg-[#F0B90B] text-black'
                    : 'bg-[#00FFA3]/25 text-[#00FFA3] border border-[#00FFA3]/50'
                }`}
              >
                {autoResolveEnabled ? 'AUTO: ON' : 'AUTO: OFF'}
              </button>
            </div>

            {/* Quick Stage Jump */}
            <div className="mb-3">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 font-mono">
                Jump to Game Stage
              </div>
              <div className="grid grid-cols-4 gap-1.5 font-mono text-[10px]">
                {(['HOME', 'PRE_TRADE', 'LIVE_TRADE', 'RESULT'] as GameStage[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      onSetStage(st);
                      setIsOpen(false);
                    }}
                    className={`py-1.5 px-1 rounded-xl font-bold transition-all text-center cursor-pointer ${
                      currentStage === st
                        ? 'bg-[#00F0FF] text-black shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300 border border-white/5'
                    }`}
                  >
                    {st === 'PRE_TRADE' ? 'PRE' : st === 'LIVE_TRADE' ? 'LIVE' : st}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Triggers */}
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 font-mono">
                Real-Time Price & Event Controls
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold mb-1.5">
                <button
                  onClick={() => onSimulatePriceBump(0.8)}
                  className="py-2 px-1.5 rounded-xl bg-[#00FFA3]/15 hover:bg-[#00FFA3]/25 border border-[#00FFA3]/40 text-[#00FFA3] flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>+0.8%</span>
                </button>

                <button
                  onClick={() => onSimulatePriceBump(-0.8)}
                  className="py-2 px-1.5 rounded-xl bg-[#FF0055]/15 hover:bg-[#FF0055]/25 border border-[#FF0055]/40 text-[#FF0055] flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                >
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>-0.8%</span>
                </button>

                <button
                  onClick={() => {
                    onSimulateCashOut();
                    setIsOpen(false);
                  }}
                  className="py-2 px-1.5 rounded-xl bg-[#00F0FF]/15 hover:bg-[#00F0FF]/25 border border-[#00F0FF]/40 text-[#00F0FF] flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Cash Out</span>
                </button>
              </div>

              {/* Large PnL Jump Buttons for Testing Tier 3 Hyperdrive & Red Alert */}
              <div className="grid grid-cols-2 gap-1.5 text-[10px] font-black mb-2">
                <button
                  onClick={() => onSimulatePriceBump(2.5)}
                  className="py-1.5 px-2 rounded-xl bg-gradient-to-r from-[#00FFA3]/20 to-[#00F0FF]/20 hover:from-[#00FFA3]/30 hover:to-[#00F0FF]/30 border border-[#00FFA3]/50 text-[#00FFA3] flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                >
                  <span>⚡ ++ MEGA SURGE (+2.5%)</span>
                </button>

                <button
                  onClick={() => onSimulatePriceBump(-2.5)}
                  className="py-1.5 px-2 rounded-xl bg-gradient-to-r from-[#FF0055]/20 to-[#FF4400]/20 hover:from-[#FF0055]/30 hover:to-[#FF4400]/30 border border-[#FF0055]/50 text-[#FF0055] flex items-center justify-center gap-1 active:scale-95 cursor-pointer"
                >
                  <span>⚠️ -- DEEP DROP (-2.5%)</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  onClick={() => {
                    onSimulateTargetHit();
                    setIsOpen(false);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#F0B90B] text-black shadow-[0_0_15px_rgba(240,185,11,0.4)] flex items-center justify-center gap-1.5 font-black active:scale-95 cursor-pointer"
                >
                  <Zap className="w-4 h-4" />
                  <span>Force Win Hit</span>
                </button>

                <button
                  onClick={() => {
                    onSimulateLossHit();
                    setIsOpen(false);
                  }}
                  className="py-2.5 px-3 rounded-xl bg-[#192348] text-[#FF0055] border border-[#FF0055]/40 flex items-center justify-center gap-1.5 font-bold active:scale-95 cursor-pointer"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Force Stop Loss</span>
                </button>

                {onTriggerMissionToast && (
                  <button
                    onClick={() => {
                      onTriggerMissionToast();
                      setIsOpen(false);
                    }}
                    className="col-span-2 py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-[#F0B90B]/40 text-[#F0B90B] flex items-center justify-center gap-1.5 font-mono text-[11px] font-bold active:scale-95 cursor-pointer"
                  >
                    <span>🎯 Trigger Daily Mission Complete Toast</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
};
