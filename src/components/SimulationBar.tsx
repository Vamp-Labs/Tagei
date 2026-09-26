import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TrendingUp, TrendingDown, Zap, AlertTriangle, PlayCircle, X, Wrench, Rocket, Shield, Target } from 'lucide-react';
import { GameStage } from '../types/game';
import { DISMISS_OFFSET, DISMISS_VELOCITY, MICRO, STANDARD } from '../ui/motion';

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

  const outline = 'rounded-sm border flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer transition-colors';
  const profitOutline = `${outline} bg-lucky-tint border-profit/50 text-profit hover:border-profit`;
  const lossOutline = `${outline} bg-well border-loss/50 text-loss hover:border-loss`;
  const neutralOutline = `${outline} bg-control border-line text-ink-secondary hover:bg-control-hover`;

  return (
    <>
      {/* Demo toolbar. Parked as an edge tab at mid-height: the bottom-right
          corner it used to sit in is now the launch arc's apex. */}
      {!isOpen && (
        <motion.button
          onClick={() => setIsOpen(true)}
          whileTap={{ scale: 0.95 }}
          transition={MICRO}
          aria-label="Open mock simulator"
          className="fixed top-1/2 right-0 -translate-y-1/2 z-[60] flex flex-col items-center gap-1 px-1.5 py-3 min-h-11 rounded-l-sm bg-sheet border border-r-0 border-frame-muted text-ink-secondary text-micro font-extrabold cursor-pointer"
        >
          <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="[writing-mode:vertical-rl] tracking-widest">SIM</span>
          {!autoResolveEnabled && (
            <span className="w-2 h-2 rounded-full bg-lucky" title="Infinite flight active" />
          )}
        </motion.button>
      )}

      {/* Slide-in simulation modal drawer */}
      <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, zIndex: 60, transition: STANDARD }}
          exit={{ opacity: 0, zIndex: 10, transition: MICRO }}
          className="lg-scrim--dim fixed inset-0 z-[60] flex items-end justify-center p-3"
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
              if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) setIsOpen(false);
            }}
            className="lg-card w-full max-w-sm p-4 font-sans max-h-[80svh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-lucky" aria-hidden="true" />
                <span className="font-extrabold text-ink tracking-wider text-micro uppercase">
                  Mock simulator
                </span>
                <span className="px-2 py-0.5 rounded-sm bg-well text-micro tabular-nums text-ink-muted">
                  {currentStage}
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Close simulator"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-ink-muted hover:text-ink cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Feature 1: Sim Live LONG (No Auto-End) */}
            <div className="mb-3 p-3 rounded-md bg-well border border-line">
              <div className="text-micro font-extrabold text-profit uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Rocket className="w-3.5 h-3.5" />
                <span>Simulate live flight</span>
              </div>
              <p className="text-micro text-ink-muted mb-2 leading-tight">
                Instantly flies live with LONG active. Observe the Profit/Loss zones on the chart without auto win/lose interruption.
              </p>
              <button
                onClick={() => {
                  onSimulateLiveLong();
                  setIsOpen(false);
                }}
                className={`w-full min-h-11 py-2 px-3 text-micro font-extrabold tracking-wide ${profitOutline}`}
              >
                <Rocket className="w-4 h-4" />
                <span>START LIVE LONG (NO AUTO-END)</span>
              </button>
            </div>

            {/* Auto-Resolve Win/Loss Toggle */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-well border border-line mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-ink-muted" />
                <div>
                  <div className="font-bold text-ink text-micro">Auto-resolve win/loss</div>
                  <div className="text-micro text-ink-muted">
                    {autoResolveEnabled ? 'Round auto-ends on target/stop' : 'Infinite flight (manual resolve only)'}
                  </div>
                </div>
              </div>
              <button
                onClick={onToggleAutoResolve}
                className={`shrink-0 min-h-11 px-3 text-micro font-extrabold tabular-nums ${
                  autoResolveEnabled ? profitOutline : neutralOutline
                }`}
              >
                {autoResolveEnabled ? 'AUTO: ON' : 'AUTO: OFF'}
              </button>
            </div>

            {/* Quick Stage Jump */}
            <div className="mb-3">
              <div className="text-micro font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                Jump to game stage
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-micro">
                {(['HOME', 'PRE_TRADE', 'LIVE_TRADE', 'RESULT'] as GameStage[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      onSetStage(st);
                      setIsOpen(false);
                    }}
                    className={`min-h-11 px-1 font-bold text-center ${
                      currentStage === st
                        ? `${outline} bg-control-hover border-lucky text-ink`
                        : neutralOutline
                    }`}
                  >
                    {st === 'PRE_TRADE' ? 'PRE' : st === 'LIVE_TRADE' ? 'LIVE' : st}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Triggers */}
            <div>
              <div className="text-micro font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                Real-time price and event controls
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-micro font-bold mb-1.5 tabular-nums">
                <button onClick={() => onSimulatePriceBump(0.8)} className={`min-h-11 px-1.5 ${profitOutline}`}>
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>+0.8%</span>
                </button>

                <button onClick={() => onSimulatePriceBump(-0.8)} className={`min-h-11 px-1.5 ${lossOutline}`}>
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>{'\u22120.8%'}</span>
                </button>

                <button
                  onClick={() => {
                    onSimulateCashOut();
                    setIsOpen(false);
                  }}
                  className={`min-h-11 px-1.5 ${neutralOutline}`}
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Cash out</span>
                </button>
              </div>

              {/* Large PnL Jump Buttons for Testing Tier 3 Hyperdrive & Red Alert */}
              <div className="grid grid-cols-2 gap-1.5 text-micro font-extrabold mb-2 tabular-nums">
                <button onClick={() => onSimulatePriceBump(2.5)} className={`min-h-11 px-2 ${profitOutline}`}>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Mega surge +2.5%</span>
                </button>

                <button onClick={() => onSimulatePriceBump(-2.5)} className={`min-h-11 px-2 ${lossOutline}`}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{'Deep drop \u22122.5%'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-micro font-bold">
                <button
                  onClick={() => {
                    onSimulateTargetHit();
                    setIsOpen(false);
                  }}
                  className={`min-h-11 px-3 font-extrabold ${profitOutline}`}
                >
                  <Zap className="w-4 h-4" />
                  <span>Force win hit</span>
                </button>

                <button
                  onClick={() => {
                    onSimulateLossHit();
                    setIsOpen(false);
                  }}
                  className={`min-h-11 px-3 ${lossOutline}`}
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Force stop loss</span>
                </button>

                {onTriggerMissionToast && (
                  <button
                    onClick={() => {
                      onTriggerMissionToast();
                      setIsOpen(false);
                    }}
                    className={`col-span-2 min-h-11 px-3 ${neutralOutline}`}
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>Trigger daily mission complete toast</span>
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
