import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { AssetSymbol } from '../types/market';
import { PositionDirection, RoundMode } from '../types/game';
import { soundEngine } from '../services/audioHaptics';
import { HoldButton } from '../ui/HoldButton';
import { MICRO, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { CURRENCY, DirectionChip, Icon, buttonClass, formatAmount } from '../ui/lucky';
import { DirectionToggle } from './trade/DirectionToggle';
import { STAKE_STEP, clampStake, type TierOption } from './game/tiers';
import { multipleText, tierText } from './game/roundDisplay';

interface PreTradePanelProps {
  currentAsset: AssetSymbol;
  selectedDirection: PositionDirection | null;
  onSelectDirection: (dir: PositionDirection) => void;
  onStartTrade: (stake: number) => void;
  mode: RoundMode;
  tiers: readonly TierOption[];
  selectedTier: TierOption | null;
  onSelectTier: (tier: number) => void;
  stake: number;
  onStakeChange: (stake: number) => void;
  creditsUsd?: number | null;
  blockedReason?: string | null;
  needsConnect?: boolean;
  onConnect?: () => void;
}

const STAKE_PRESETS = [5, 25, 50];
const SECTION_LABEL = 'text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted';
const usdt = (value: number) => formatAmount(value, 'USDT', { sign: 'never', decimals: 0 });
const credits = (value: number) => formatAmount(value, 'USDT', { sign: 'never' });

export const PreTradePanel: React.FC<PreTradePanelProps> = ({
  currentAsset,
  selectedDirection,
  onSelectDirection,
  onStartTrade,
  mode,
  tiers,
  selectedTier,
  onSelectTier,
  stake,
  onStakeChange,
  creditsUsd = null,
  blockedReason = null,
  needsConnect = false,
  onConnect,
}) => {
  const reduced = useMotionPref();
  const [displayStake, setDisplayStake] = useState<number>(stake);

  useEffect(() => {
    if (reduced || displayStake === stake) return;
    const step = stake - displayStake > 0 ? 1 : -1;
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
  const minStake = selectedTier?.minStake ?? STAKE_PRESETS[0];
  const maxStake = selectedTier?.maxStake ?? STAKE_PRESETS[STAKE_PRESETS.length - 1];
  const presets = STAKE_PRESETS.filter((amount) => amount >= minStake && amount <= maxStake);
  const canLaunch = Boolean(selectedDirection && selectedTier && !blockedReason && !needsConnect);

  const handleDirectionClick = (dir: PositionDirection) => {
    soundEngine.playChipSelect();
    onSelectDirection(dir);
  };

  const handleStakePreset = (amount: number) => {
    soundEngine.playClick();
    onStakeChange(clampStake(amount, selectedTier));
  };

  const handleStakeStep = (delta: number) => {
    soundEngine.playClick();
    onStakeChange(clampStake(stake + delta, selectedTier));
  };

  const handleTier = (option: TierOption) => {
    if (!option.enabled) return;
    soundEngine.playChipSelect();
    onSelectTier(option.tier);
  };

  const holdLabel = !selectedDirection ? 'SELECT LONG OR SHORT' : blockedReason ? 'LAUNCH PAUSED' : 'HOLD TO LAUNCH!';

  return (
    <div className="relative flex flex-col w-full select-none px-6 pt-1 pb-3">
      <DirectionToggle value={selectedDirection} onChange={handleDirectionClick} className="mb-5" />

      <section aria-labelledby="trade-amount-label" className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 id="trade-amount-label" className={SECTION_LABEL}>
            Amount
          </h3>
          {mode === 'live' && creditsUsd !== null && (
            <span className="text-micro tabular-nums text-ink-muted">balance {credits(creditsUsd)}</span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 h-16 px-2 rounded-md bg-well">
          <motion.button
            type="button"
            onClick={() => handleStakeStep(-STAKE_STEP)}
            disabled={stake <= minStake}
            whileTap={{ scale: 0.9 }}
            transition={MICRO}
            className={cn(buttonClass('icon', 'md'), 'disabled:opacity-40')}
            aria-label="Decrease amount"
          >
            <Icon name="minus" size={22} />
          </motion.button>
          <output aria-live="polite" className="flex items-center justify-center gap-2 text-numeral tabular-nums text-ink">
            <span className="sr-only">{usdt(stake)}</span>
            <img src={CURRENCY.usdt.src} alt="" width={24} height={24} className="rounded-full" aria-hidden="true" />
            <span aria-hidden="true">{usdt(shownStake)}</span>
          </output>
          <motion.button
            type="button"
            onClick={() => handleStakeStep(STAKE_STEP)}
            disabled={stake >= maxStake}
            whileTap={{ scale: 0.9 }}
            transition={MICRO}
            className={cn(buttonClass('icon', 'md'), 'disabled:opacity-40')}
            aria-label="Increase amount"
          >
            <Icon name="plus" size={22} />
          </motion.button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {presets.map((amt) => {
            const on = stake === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => handleStakePreset(amt)}
                aria-pressed={on}
                className={cn(
                  'h-11 rounded-sm text-caption font-bold tabular-nums transition-colors cursor-pointer',
                  on ? 'bg-lucky-tint text-lucky ring-2 ring-inset ring-lucky' : 'bg-control text-ink-secondary ring-1 ring-inset ring-line',
                )}
              >
                {usdt(amt)}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="trade-tier-label" className="mb-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 id="trade-tier-label" className={SECTION_LABEL}>
            Tier
          </h3>
          <span className="text-micro text-ink-muted">30 s rounds</span>
        </div>
        <div role="radiogroup" aria-labelledby="trade-tier-label" className="grid grid-cols-4 gap-2">
          {tiers.map((option) => {
            const on = option.enabled && option.tier === selectedTier?.tier;
            return (
              <button
                key={option.tier}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={option.enabled ? undefined : true}
                aria-label={option.enabled ? tierText(option.label, option.multiplierBps) : `${option.label}, coming soon`}
                onClick={() => handleTier(option)}
                className={cn(
                  'h-14 flex flex-col items-center justify-center gap-0.5 rounded-sm tabular-nums transition-colors',
                  on && 'bg-lucky-tint text-lucky ring-2 ring-inset ring-lucky cursor-pointer',
                  !on && option.enabled && 'bg-control text-ink-secondary ring-1 ring-inset ring-line cursor-pointer',
                  !option.enabled && 'bg-well text-ink-muted cursor-not-allowed',
                )}
              >
                <span className="text-micro font-extrabold tracking-[0.06em]">{option.label}</span>
                {option.enabled ? (
                  <span className="text-caption font-bold">{multipleText(option.multiplierBps)}</span>
                ) : (
                  <span className="flex items-center gap-1 text-micro font-semibold">
                    <Icon name="lock" size={13} />
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-micro tabular-nums text-ink-soft">
          {selectedTier?.summary ?? (tiers.length === 0 ? 'Loading lanes…' : 'No tier is available for this asset.')}
        </p>
      </section>

      {needsConnect ? (
        <button type="button" onClick={onConnect} className={cn(buttonClass('hot', 'lg', true), 'h-14', !reduced && 'lg-pulse-hot')}>
          CONNECT TO PLAY!
        </button>
      ) : (
        <HoldButton
          variant="hot"
          onCommit={() => onStartTrade(stake)}
          disabled={!canLaunch}
          ariaLabel={canLaunch && selectedDirection ? `Hold to launch ${selectedDirection}` : holdLabel}
          holdingLabel={<span>HOLDING…</span>}
          className={cn('h-14', canLaunch && !reduced && 'lg-pulse-hot')}
        >
          <span>{holdLabel}</span>
        </HoldButton>
      )}

      {blockedReason && !needsConnect ? (
        <p role="status" className="mt-3 text-center text-micro text-ink-soft">
          {blockedReason}
        </p>
      ) : (
        selectedDirection &&
        selectedTier && (
          <p className="flex items-center justify-center gap-2 mt-3 text-micro text-ink-muted tabular-nums">
            <DirectionChip direction={selectedDirection} size="sm" />
            <span>
              {currentAsset} · {usdt(shownStake)} · {tierText(selectedTier.label, selectedTier.multiplierBps)}
            </span>
          </p>
        )
      )}
    </div>
  );
};
