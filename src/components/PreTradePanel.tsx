import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AssetSymbol } from '../types/market';
import { PositionDirection } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { MICRO, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { CURRENCY, DirectionChip, Icon, Pill, buttonClass, formatAmount, formatLeverage } from '../ui/lucky';
import { DirectionToggle } from './trade/DirectionToggle';
import { HOLD_RING_VISIBLE } from './trade/holdRing';

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

const STAKE_PRESETS = [5, 25, 50];
const SECTION_LABEL = 'text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted';
const usdt = (value: number) => formatAmount(value, 'USDT', { sign: 'never', decimals: 0 });

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
  const reduced = useMotionPref();
  const [stake, setStake] = useState<number>(10);
  const [displayStake, setDisplayStake] = useState<number>(10);

  // Animated number roll when stake changes (PRD §13)
  useEffect(() => {
    if (reduced || displayStake === stake) return;
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
  }, [stake, displayStake, reduced]);

  const shownStake = reduced ? stake : displayStake;

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
    <div className="relative flex flex-col w-full select-none px-6 pt-1 pb-3">
      <DirectionToggle value={selectedDirection} onChange={handleDirectionClick} className="mb-5" />

      <section aria-labelledby="trade-amount-label" className="mb-5">
        <h3 id="trade-amount-label" className={cn(SECTION_LABEL, 'mb-2')}>
          Amount
        </h3>
        <div className="flex items-center justify-between gap-2 h-16 px-2 rounded-md bg-well">
          <motion.button
            type="button"
            onClick={() => handleStakeStep(-5)}
            whileTap={{ scale: 0.9 }}
            transition={MICRO}
            className={buttonClass('icon', 'md')}
            aria-label="Decrease amount"
          >
            <Icon name="minus" size={22} />
          </motion.button>
          <output
            aria-live="polite"
            className="flex items-center justify-center gap-2 text-numeral tabular-nums text-ink"
          >
            <span className="sr-only">{usdt(stake)}</span>
            <img
              src={CURRENCY.usdt.src}
              alt=""
              width={24}
              height={24}
              className="rounded-full"
              aria-hidden="true"
            />
            <span aria-hidden="true">{usdt(shownStake)}</span>
          </output>
          <motion.button
            type="button"
            onClick={() => handleStakeStep(5)}
            whileTap={{ scale: 0.9 }}
            transition={MICRO}
            className={buttonClass('icon', 'md')}
            aria-label="Increase amount"
          >
            <Icon name="plus" size={22} />
          </motion.button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {STAKE_PRESETS.map((amt) => {
            const on = stake === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => handleStakePreset(amt)}
                aria-pressed={on}
                className={cn(
                  'h-11 rounded-sm text-caption font-bold tabular-nums transition-colors cursor-pointer',
                  on
                    ? 'bg-lucky-tint text-lucky ring-2 ring-inset ring-lucky'
                    : 'bg-control text-ink-secondary ring-1 ring-inset ring-line'
                )}
              >
                {usdt(amt)}
              </button>
            );
          })}
        </div>
      </section>

      {/* LEVERAGE. The spec mock's four tiers (2x/5x/10x/20x) are a design
          concept — none of them is the engine's real, fixed value (18x), so
          rather than force a mismatch onto one of them, the row stays a
          visual reference and the true active leverage gets its own badge.
          Both are shown; neither pretends to be the other. */}
      <section aria-labelledby="trade-leverage-label" className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 id="trade-leverage-label" className={SECTION_LABEL}>
            Leverage
          </h3>
          <span className="flex items-center gap-2">
            <span className="text-micro text-ink-muted">fixed by the game engine</span>
            <Pill size="sm" className="text-ink">
              <span className="normal-case">{formatLeverage(leverage)}</span>
            </Pill>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {LEVERAGE_OPTIONS.map((lv) => (
            <button
              key={lv}
              type="button"
              disabled
              aria-disabled="true"
              className="h-11 flex items-center justify-center gap-1 rounded-sm bg-well text-caption font-bold tabular-nums text-ink-muted opacity-60 cursor-not-allowed"
            >
              <Icon name="lock" size={14} />
              {lv}x
            </button>
          ))}
        </div>
      </section>

      {/* Commit — hold to launch, so a stretching thumb cannot mis-fire. */}
      <HoldButton
        variant="hot"
        onCommit={() => onStartTrade(stake)}
        disabled={!selectedDirection}
        ariaLabel={selectedDirection ? `Hold to launch ${selectedDirection}` : 'Select a direction first'}
        holdingLabel={<span>HOLDING…</span>}
        className={cn('h-14', HOLD_RING_VISIBLE, selectedDirection && !reduced && 'lg-pulse-hot')}
      >
        <span>{selectedDirection ? 'HOLD TO LAUNCH!' : 'SELECT LONG OR SHORT'}</span>
      </HoldButton>

      {selectedDirection && (
        <p className="flex items-center justify-center gap-2 mt-3 text-micro text-ink-muted tabular-nums">
          <DirectionChip direction={selectedDirection} size="sm" />
          <span>
            {currentAsset} · {usdt(shownStake)} · {formatLeverage(leverage)}
          </span>
        </p>
      )}
    </div>
  );
};
