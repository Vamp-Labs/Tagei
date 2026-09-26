import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from 'motion/react';
import { ArrowRight, ChevronDown, ChevronUp, Rocket } from 'lucide-react';
import confetti from 'canvas-confetti';
import { soundEngine } from '../services/audioHaptics';
import { UserProgression } from '../types/game';
import { AssetSymbol, PriceTick } from '../types/market';
import { MICRO, STANDARD } from '../ui/motion';

interface HomeHeroOverlayProps {
  isWalletConnected: boolean;
  onConnectWallet: () => Promise<void>;
  onOpenTradeSheet: () => void;
  onOpenAssetSelector: () => void;
  currentAsset: AssetSymbol;
  latestTick: PriceTick | null;
  progression?: UserProgression;
}

/**
 * docs/UI_UX_SPEC.md §1 (Landing) and §2 (Home). The existing
 * isWalletConnected branch already IS the Landing/Home split the docs
 * draw — this re-lays-out each branch to its mock rather than introducing
 * a new stage. Hidden per the Home mock: leverage, amount, target, stop,
 * settings/profile, bottom nav — none of that lives here any more.
 */
export const HomeHeroOverlay: React.FC<HomeHeroOverlayProps> = ({
  isWalletConnected,
  onConnectWallet,
  onOpenTradeSheet,
  onOpenAssetSelector,
  currentAsset,
  latestTick,
  progression,
}) => {
  const [connecting, setConnecting] = useState(false);

  const handleConnectClick = async () => {
    soundEngine.playClick();
    setConnecting(true);
    try {
      await onConnectWallet();
      soundEngine.playChipSelect();
      confetti({
        particleCount: 24,
        spread: 45,
        origin: { y: 0.72 },
        colors: ['#F0B90B', '#FFFFFF', '#00E89A'],
      });
    } finally {
      setConnecting(false);
    }
  };

  const change = latestTick ? latestTick.change24h : 0;
  const isPositive = change >= 0;

  // --- Live price "tick" juice ---------------------------------------
  // Same toolkit as LiveTradeOverlay's P&L number and the rocket-following
  // number: a spring glide instead of a snap, plus a brief tick-direction
  // color flash (the standard exchange-ticker cue). The delta floor is
  // relative (%), not a fixed dollar amount, since assets here range from
  // ~$0.08 (DOGE) to ~$600+ (BNB/BTC) — a fixed floor would never fire for
  // the cheap ones or fire on noise for the expensive ones.
  const priceMV = useMotionValue(latestTick?.price ?? 0);
  const [displayPrice, setDisplayPrice] = useState<number>(latestTick?.price ?? 0);
  useMotionValueEvent(priceMV, 'change', (v) => setDisplayPrice(v));

  const priceScaleMV = useMotionValue(1);
  const [pricePopScale, setPricePopScale] = useState(1);
  useMotionValueEvent(priceScaleMV, 'change', (v) => setPricePopScale(v));

  const [flashDirection, setFlashDirection] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!latestTick) return;
    const prevPrice = prevPriceRef.current;
    prevPriceRef.current = latestTick.price;

    // First real tick of the session — snap in rather than gliding up from
    // the placeholder 0 the motion value was seeded with.
    if (prevPrice === null) {
      priceMV.set(latestTick.price);
      return;
    }

    animate(priceMV, latestTick.price, { type: 'spring', stiffness: 260, damping: 30, mass: 0.6 });

    const delta = latestTick.price - prevPrice;
    const relDelta = prevPrice !== 0 ? Math.abs(delta) / prevPrice : 0;
    // The mock feed's typical tick is only a few hundredths of a percent —
    // a floor tuned for that (rather than a round number picked blind)
    // keeps this reading as "always ticking," not stuck on whichever
    // direction happened to clear a too-high bar first.
    if (relDelta < 0.00006) return;

    setFlashDirection(delta > 0 ? 'up' : 'down');
    window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => setFlashDirection(null), 380);

    animate(priceScaleMV, [1, 1.04, 1], { duration: 0.28, ease: [0.34, 1.56, 0.64, 1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestTick]);

  useEffect(() => () => window.clearTimeout(flashTimeoutRef.current), []);

  const priceFormatted = latestTick
    ? displayPrice.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: currentAsset === 'DOGE' ? 4 : 2,
      })
    : '---';

  if (!isWalletConnected) {
    // Landing — docs §1. Welcome copy + a single primary CTA over the live
    // chart, which App.tsx already renders full-bleed behind this overlay.
    return (
      <div className="relative flex flex-col items-center text-center gap-2 px-6 pb-2 select-none pointer-events-auto">
        <h1 className="text-[length:var(--text-screen-title)] font-black text-[color:var(--color-text-1)]">
          Welcome to BNB PLAY
        </h1>
        <p className="text-[length:var(--text-metadata)] text-[color:var(--color-text-2)] max-w-[260px]">
          Connect your wallet to start your first mission
        </p>

        <motion.button
          onClick={handleConnectClick}
          disabled={connecting}
          whileTap={{ scale: 0.98 }}
          transition={MICRO}
          className="w-full mt-3 h-[var(--tap-primary)] rounded-[var(--radius-lg)] bg-[color:var(--color-bnb-yellow)] text-black font-black text-[length:var(--text-cta)] flex items-center justify-center gap-2 cursor-pointer pulse-glow-cta"
        >
          <Rocket className="w-5 h-5 stroke-[2.5]" />
          {connecting ? 'Connecting…' : 'Connect Wallet'}
        </motion.button>

        <button
          onClick={onOpenTradeSheet}
          className="text-[length:var(--text-metadata)] font-semibold text-[color:var(--color-text-2)] hover:text-[color:var(--color-text-1)] transition-colors cursor-pointer"
        >
          Explore first →
        </button>
      </div>
    );
  }

  // Home — docs §2. Asset/price block (tap → Asset Selector) and the
  // swipe-up-to-trade affordance. Everything else is hidden by design.
  return (
    <div className="flex flex-col items-center gap-3 pointer-events-none select-none">
      <button
        onClick={onOpenAssetSelector}
        className="flex flex-col items-center gap-0.5 pointer-events-auto cursor-pointer"
      >
        <span className="flex items-center gap-1 text-[length:var(--text-body)] font-bold text-[color:var(--color-text-1)]">
          {currentAsset}
          <ChevronDown className="w-3.5 h-3.5 text-[color:var(--color-text-3)]" />
        </span>
        <motion.span
          className="text-[length:var(--text-hero-price)] font-black leading-none font-mono transition-colors duration-300"
          style={{
            scale: pricePopScale,
            color:
              flashDirection === 'up'
                ? 'var(--color-long)'
                : flashDirection === 'down'
                  ? 'var(--color-short)'
                  : 'var(--color-text-1)',
          }}
        >
          ${priceFormatted}
        </motion.span>
        <span
          className="text-[length:var(--text-metadata)] font-bold font-mono"
          style={{ color: isPositive ? 'var(--color-long)' : 'var(--color-short)' }}
        >
          {isPositive ? '+' : ''}
          {change.toFixed(2)}%
        </span>
      </button>

      {progression && (
        <div className="flex items-center gap-1.5 px-3 h-7 rounded-full bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] text-[length:var(--text-micro)] font-semibold text-[color:var(--color-text-2)] pointer-events-none">
          <span className="text-[color:var(--color-long)] font-bold">Daily goal</span>
          <span>
            {progression.dailyRoundsPlayed}/{progression.dailyRoundsGoal}
          </span>
        </div>
      )}

      <AnimatePresence>
        <motion.button
          key="swipe-up"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: [0, -4, 0] }}
          exit={{ opacity: 0 }}
          transition={{ ...STANDARD, y: { repeat: Infinity, duration: 1.6, ease: 'easeInOut' } }}
          onClick={onOpenTradeSheet}
          className="flex flex-col items-center gap-1 pointer-events-auto cursor-pointer mt-1"
        >
          <ChevronUp className="w-5 h-5 text-[color:var(--color-bnb-yellow)]" />
          <span className="text-[length:var(--text-metadata)] font-bold uppercase tracking-wide text-[color:var(--color-text-2)] flex items-center gap-1">
            Swipe up to trade
            <ArrowRight className="w-3.5 h-3.5 -rotate-90" />
          </span>
        </motion.button>
      </AnimatePresence>
    </div>
  );
};
