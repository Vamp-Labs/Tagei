import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, ArrowDownRight, Minus, Plus } from 'lucide-react';
import { AssetSymbol } from '../types/market';
import { PositionDirection } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { MICRO } from '../ui/motion';

interface PreTradePanelProps {
  currentAsset: AssetSymbol;
  selectedDirection: PositionDirection | null;
  onSelectDirection: (dir: PositionDirection) => void;
  onStartTrade: (stake: number) => void;
  /** The engine's real, fixed leverage — see settlementEngine.ts. The
   * leverage row below is visual per the spec mock, but only this value
   * is genuinely selectable; changing it would mean editing frozen
   * settlement logic, which is out of bounds for a UI refactor. */
  leverage: number;
}

const LEVERAGE_OPTIONS = [2, 5, 10, 20];

/**
 * The Trade Setup sheet's content — docs/UI_UX_SPEC.md §3. Asset selection
 * moved out to the new AssetSelector (tapped from the Home price block),
 * so this panel is purely LONG/SHORT + amount + leverage + commit.
 */
export const PreTradePanel: React.FC<PreTradePanelProps> = ({
  currentAsset,
  selectedDirection,
  onSelectDirection,
  onStartTrade,
  leverage,
}) => {
  const [stake, setStake] = useState<number>(10);
  const [displayStake, setDisplayStake] = useState<number>(10);

  // Animated number roll when stake changes (PRD §13)
  useEffect(() => {
    if (displayStake === stake) return;
    const diff = stake - displayStake;
    const step = diff > 0 ? 1 : -1;
    const interval = window.setInterval(() => {
      setDisplayStake((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= stake) || (step < 0 && next <= stake)) {
          clearInterval(interval);
          return stake;
        }
        return next;
      });
    }, 25);
    return () => clearInterval(interval);
  }, [stake, displayStake]);

  const handleDirectionClick = (dir: PositionDirection) => {
    soundEngine.playChipSelect();
    onSelectDirection(dir);
  };

  const handleStakePreset = (amount: number) => {
    soundEngine.playClick();
    setStake(amount);
  };

  const handleStakeStep = (delta: number) => {
    soundEngine.playClick();
    setStake((prev) => Math.max(5, Math.min(100, prev + delta)));
  };

  return (
    <div className="relative flex flex-col w-full select-none px-5 pt-1 pb-5">
      {/* LONG / SHORT — neutral by default; selected takes the long/short
          color. Never both colored at once, per docs/DESIGN_TOKENS.md. */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <motion.button
          onClick={() => handleDirectionClick('LONG')}
          whileTap={{ scale: 0.97 }}
          transition={MICRO}
          className={`relative overflow-hidden h-14 rounded-[var(--radius-md)] flex items-center justify-center gap-2 border transition-colors cursor-pointer ${
            selectedDirection === 'LONG'
              ? 'bg-[color:var(--color-long)]/15 border-[color:var(--color-long)] glow-green'
              : 'bg-[color:var(--color-panel-soft)] border-[color:var(--color-line)]'
          }`}
        >
          <ArrowUpRight
            className="w-4.5 h-4.5 stroke-[3]"
            style={{ color: selectedDirection === 'LONG' ? 'var(--color-long)' : 'var(--color-text-2)' }}
          />
          <span
            className="font-black text-[length:var(--text-body)] tracking-wide"
            style={{ color: selectedDirection === 'LONG' ? 'var(--color-long)' : 'var(--color-text-1)' }}
          >
            LONG
          </span>
        </motion.button>

        <motion.button
          onClick={() => handleDirectionClick('SHORT')}
          whileTap={{ scale: 0.97 }}
          transition={MICRO}
          className={`relative overflow-hidden h-14 rounded-[var(--radius-md)] flex items-center justify-center gap-2 border transition-colors cursor-pointer ${
            selectedDirection === 'SHORT'
              ? 'bg-[color:var(--color-short)]/15 border-[color:var(--color-short)] glow-magenta'
              : 'bg-[color:var(--color-panel-soft)] border-[color:var(--color-line)]'
          }`}
        >
          <ArrowDownRight
            className="w-4.5 h-4.5 stroke-[3]"
            style={{ color: selectedDirection === 'SHORT' ? 'var(--color-short)' : 'var(--color-text-2)' }}
          />
          <span
            className="font-black text-[length:var(--text-body)] tracking-wide"
            style={{ color: selectedDirection === 'SHORT' ? 'var(--color-short)' : 'var(--color-text-1)' }}
          >
            SHORT
          </span>
        </motion.button>
      </div>

      {/* AMOUNT */}
      <div className="mb-5">
        <div className="text-[length:var(--text-micro)] font-bold uppercase tracking-widest text-[color:var(--color-text-3)] mb-2">
          Amount
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <motion.button
              onClick={() => handleStakeStep(-5)}
              whileTap={{ scale: 0.9 }}
              transition={MICRO}
              className="w-[var(--tap-min)] h-[var(--tap-min)] rounded-[var(--radius-sm)] bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] flex items-center justify-center text-[color:var(--color-text-2)] cursor-pointer"
              aria-label="Decrease amount"
            >
              <Minus className="w-4 h-4" />
            </motion.button>
            <span className="w-16 text-center font-mono font-black text-[length:var(--text-body)] text-[color:var(--color-text-1)]">
              ${displayStake}
            </span>
            <motion.button
              onClick={() => handleStakeStep(5)}
              whileTap={{ scale: 0.9 }}
              transition={MICRO}
              className="w-[var(--tap-min)] h-[var(--tap-min)] rounded-[var(--radius-sm)] bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] flex items-center justify-center text-[color:var(--color-text-2)] cursor-pointer"
              aria-label="Increase amount"
            >
              <Plus className="w-4 h-4" />
            </motion.button>
          </div>

          <div className="flex items-center gap-1.5">
            {[5, 25, 50].map((amt) => (
              <button
                key={amt}
                onClick={() => handleStakePreset(amt)}
                className={`h-9 px-2.5 rounded-[var(--radius-sm)] font-mono text-[length:var(--text-metadata)] font-bold border transition-colors cursor-pointer ${
                  stake === amt
                    ? 'bg-[color:var(--color-bnb-yellow)]/15 border-[color:var(--color-bnb-yellow)] text-[color:var(--color-bnb-yellow)]'
                    : 'bg-transparent border-[color:var(--color-line)] text-[color:var(--color-text-2)]'
                }`}
              >
                ${amt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* LEVERAGE. The spec mock's four tiers (2x/5x/10x/20x) are a design
          concept — none of them is the engine's real, fixed value (18x), so
          rather than force a mismatch onto one of them, the row stays a
          visual reference and the true active leverage gets its own badge.
          Both are shown; neither pretends to be the other. */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[length:var(--text-micro)] font-bold uppercase tracking-widest text-[color:var(--color-text-3)]">
            Leverage
          </span>
          <span className="px-2 h-6 flex items-center rounded-full bg-[color:var(--color-bnb-yellow)]/15 border border-[color:var(--color-bnb-yellow)]/40 font-mono text-[length:var(--text-micro)] font-bold text-[color:var(--color-bnb-yellow)]">
            Active: {leverage}x
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {LEVERAGE_OPTIONS.map((lv) => (
            <button
              key={lv}
              disabled
              className="h-10 rounded-[var(--radius-sm)] font-mono text-[length:var(--text-metadata)] font-bold border bg-transparent border-[color:var(--color-line)] text-[color:var(--color-text-3)] opacity-40 cursor-not-allowed"
            >
              {lv}x
            </button>
          ))}
        </div>
      </div>

      {/* Commit — hold to launch, so a stretching thumb cannot mis-fire. */}
      <HoldButton
        onCommit={() => onStartTrade(stake)}
        disabled={!selectedDirection}
        ariaLabel={selectedDirection ? `Hold to launch ${selectedDirection}` : 'Select a direction first'}
        ringClassName="text-black"
        holdingLabel={<span>Holding…</span>}
        className={`w-full h-[var(--tap-primary)] px-6 rounded-[var(--radius-lg)] font-black text-[length:var(--text-cta)] tracking-wide transition-colors ${
          selectedDirection
            ? 'bg-[color:var(--color-bnb-yellow)] text-black pulse-glow-cta'
            : 'bg-white/5 text-[color:var(--color-text-3)] cursor-not-allowed'
        }`}
      >
        <span>{selectedDirection ? 'Hold to Launch' : 'Select Long or Short'}</span>
      </HoldButton>

      {selectedDirection && (
        <p className="text-center mt-2 text-[length:var(--text-micro)] font-mono text-[color:var(--color-text-3)]">
          {selectedDirection} {currentAsset} · ${displayStake} · {leverage}x
        </p>
      )}
    </div>
  );
};
