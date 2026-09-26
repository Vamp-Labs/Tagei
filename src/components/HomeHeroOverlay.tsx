import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform, type AnimationPlaybackControls } from 'motion/react';
import { soundEngine } from '../services/audioHaptics';
import { UserProgression } from '../types/game';
import { AssetSymbol, PriceTick } from '../types/market';
import { MICRO, STANDARD, useMotionPref } from '../ui/motion';
import { cn } from '../ui/cn';
import { Icon, ProgressBar, buttonClass, formatPct, formatPrice, signOf, useConfetti } from '../ui/lucky';

interface HomeHeroOverlayProps {
  isWalletConnected: boolean;
  onConnectWallet: () => Promise<void>;
  onOpenTradeSheet: () => void;
  onOpenAssetSelector: () => void;
  currentAsset: AssetSymbol;
  latestTick: PriceTick | null;
  progression?: UserProgression;
}

const PRICE_SPRING = { type: 'spring', stiffness: 260, damping: 30, mass: 0.6 } as const;
const PRICE_POP = { duration: 0.28, ease: [0.34, 1.56, 0.64, 1] } as const;
const PRICE_POP_KEYFRAMES = [1, 1.04, 1];
const TICK_FLASH_MS = 380;
const TICK_FLASH_MIN_REL_DELTA = 0.00006;
const CHEVRON_BOB = { repeat: Infinity, duration: 1.6, ease: 'easeInOut' } as const;
const PRESS_SCALE = 0.98;

export const HomeHeroOverlay: React.FC<HomeHeroOverlayProps> = ({
  isWalletConnected,
  onConnectWallet,
  onOpenTradeSheet,
  onOpenAssetSelector,
  currentAsset,
  latestTick,
  progression,
}) => {
  const reduced = useMotionPref();
  const { burst } = useConfetti();
  const [connecting, setConnecting] = useState(false);

  const handleConnectClick = async () => {
    soundEngine.playClick();
    setConnecting(true);
    try {
      await onConnectWallet();
      soundEngine.playChipSelect();
      burst('connect');
    } finally {
      setConnecting(false);
    }
  };

  const change = latestTick ? latestTick.change24h : 0;

  const priceMV = useMotionValue(latestTick?.price ?? 0);
  const priceText = useTransform(priceMV, (v) => formatPrice(v));
  const priceScaleMV = useMotionValue(1);
  const glideRef = useRef<AnimationPlaybackControls | null>(null);
  const popRef = useRef<AnimationPlaybackControls | null>(null);

  const [flashDirection, setFlashDirection] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!latestTick) return;
    const prevPrice = prevPriceRef.current;
    prevPriceRef.current = latestTick.price;

    if (prevPrice === null || reduced) {
      glideRef.current?.stop();
      priceMV.set(latestTick.price);
    } else {
      glideRef.current = animate(priceMV, latestTick.price, PRICE_SPRING);
    }
    if (prevPrice === null) return;

    const delta = latestTick.price - prevPrice;
    const relDelta = prevPrice !== 0 ? Math.abs(delta) / prevPrice : 0;
    if (relDelta < TICK_FLASH_MIN_REL_DELTA) return;

    setFlashDirection(delta > 0 ? 'up' : 'down');
    window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlashDirection(null), TICK_FLASH_MS);

    if (!reduced) popRef.current = animate(priceScaleMV, PRICE_POP_KEYFRAMES, PRICE_POP);
  }, [latestTick, reduced, priceMV, priceScaleMV]);

  useEffect(
    () => () => {
      window.clearTimeout(flashTimeoutRef.current);
      glideRef.current?.stop();
      popRef.current?.stop();
    },
    []
  );

  const pressProps = reduced ? {} : { whileTap: { scale: PRESS_SCALE }, transition: MICRO };

  if (!isWalletConnected) {
    return (
      <div className="relative flex flex-col items-center text-center gap-2 pb-2 select-none pointer-events-auto">
        <h1 className="text-display text-ink">
          Welcome to <span className="text-brand whitespace-nowrap">BNB PLAY</span>
        </h1>
        <p className="text-caption text-ink-soft max-w-[280px]">
          Connect your wallet to start your first mission
        </p>

        <motion.button
          type="button"
          onClick={handleConnectClick}
          disabled={connecting}
          aria-busy={connecting}
          {...pressProps}
          className={cn(buttonClass('hot', 'lg', true), 'mt-4', !reduced && 'lg-pulse-hot')}
        >
          {connecting ? 'CONNECTING…' : 'CONNECT WALLET!'}
        </motion.button>

        <button type="button" onClick={onOpenTradeSheet} className={buttonClass('ghost', 'md')}>
          Explore first
        </button>
      </div>
    );
  }

  const flashTone =
    flashDirection === 'up' ? 'text-profit' : flashDirection === 'down' ? 'text-loss' : 'text-ink';
  const changeTone = signOf(change) < 0 ? 'text-loss' : 'text-profit';
  const goalPlayed = progression ? Math.min(progression.dailyRoundsPlayed, progression.dailyRoundsGoal) : 0;

  return (
    <div className="flex flex-col items-center gap-4 pointer-events-none select-none">
      <button
        type="button"
        onClick={onOpenAssetSelector}
        aria-label={`Change asset, ${currentAsset} selected`}
        className="flex flex-col items-center gap-1 min-h-[44px] rounded-md px-3 pointer-events-auto cursor-pointer"
      >
        <span className="flex items-center gap-1 text-label uppercase text-ink">
          {currentAsset}
          <Icon name="chevron-down" size={18} className="text-ink-muted" />
        </span>
        <span className="flex items-baseline gap-2">
          {latestTick ? (
            <motion.span
              className={cn('inline-block text-display tabular-nums transition-colors duration-300', flashTone)}
              style={{ scale: priceScaleMV }}
            >
              {priceText}
            </motion.span>
          ) : (
            <span className="text-display text-ink-muted">—</span>
          )}
          <span className="text-caption text-ink-muted">USDT</span>
        </span>
        <span className={cn('text-caption font-bold tabular-nums', changeTone)}>{formatPct(change)}</span>
      </button>

      {progression && (
        <div className="w-full max-w-[240px] flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <span>Daily goal</span>
            <span className="tabular-nums text-ink-soft">
              {progression.dailyRoundsPlayed}/{progression.dailyRoundsGoal}
            </span>
          </div>
          <ProgressBar
            size="sm"
            value={goalPlayed}
            max={progression.dailyRoundsGoal}
            label={`Daily goal, ${progression.dailyRoundsPlayed} of ${progression.dailyRoundsGoal} rounds`}
          />
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={STANDARD}
        className="w-full flex flex-col items-center gap-2"
      >
        <span className="flex flex-col items-center text-ink-soft" aria-hidden="true">
          <motion.span
            animate={reduced ? { y: 0 } : { y: [0, -4, 0] }}
            transition={reduced ? { duration: 0 } : CHEVRON_BOB}
            className="inline-flex"
          >
            <Icon name="chevron-up" size={20} />
          </motion.span>
          <span className="text-micro font-semibold tracking-[0.08em] text-ink-muted">swipe up to trade</span>
        </span>
        <motion.button
          type="button"
          onClick={onOpenTradeSheet}
          {...pressProps}
          className={cn(buttonClass('hot', 'lg', true), 'pointer-events-auto', !reduced && 'lg-pulse-hot')}
        >
          PLAY NOW!
        </motion.button>
      </motion.div>
    </div>
  );
};
