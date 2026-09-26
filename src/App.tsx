import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { MarketTrackCanvas } from './canvas/MarketTrackCanvas';
import { Header } from './components/Header';
import { HomeHeroOverlay } from './components/HomeHeroOverlay';
import { PreTradePanel } from './components/PreTradePanel';
import { LiveTradeOverlay } from './components/LiveTradeOverlay';
import { SettlementOverlay } from './components/SettlementOverlay';
import { ResultPanel } from './components/ResultPanel';
import { SettingsModal } from './components/SettingsModal';
import { PixCompanion } from './components/PixCompanion';
import { OutcomeBannerOverlay } from './components/OutcomeBannerOverlay';
import { SimulationBar } from './components/SimulationBar';
import { MissionToast } from './components/MissionToast';
import { PilotProfileDrawer } from './components/PilotProfileDrawer';
import { ActivePositionBanner } from './components/ActivePositionBanner';
import { AssetSelector } from './components/AssetSelector';
import { Menu } from './components/Menu';
import { PixChat } from './components/PixChat';
import { PositionDetails } from './components/PositionDetails';
import { Sheet } from './ui/Sheet';

import { marketFeed } from './services/marketFeed';
import { SettlementEngine, DEFAULT_CONFIG } from './services/settlementEngine';
import { web3Service, WalletState, SettlementStep } from './services/web3Service';
import { soundEngine } from './services/audioHaptics';

import { AssetSymbol, PriceTick, SUPPORTED_ASSETS } from './types/market';
import {
  GameStage,
  PositionDirection,
  ActiveTradeRound,
  TradeResult,
  LastRoundSummary,
  UserProgression,
  UserSettings,
} from './types/game';
export const App: React.FC = () => {
  // State Machine
  const [stage, setStage] = useState<GameStage>('HOME');
  const [currentAsset, setCurrentAsset] = useState<AssetSymbol>('BNB');
  const [latestTick, setLatestTick] = useState<PriceTick | null>(null);

  // Pre-Trade Controls
  const [selectedDirection, setSelectedDirection] = useState<PositionDirection | null>(null);

  // Active Trade State
  const [activeRound, setActiveRound] = useState<ActiveTradeRound | null>(null);
  const [targetProgressPct, setTargetProgressPct] = useState<number>(0);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState<boolean>(true);
  // Bumped on every Hold to Cash Out commit — a one-shot signal into the
  // canvas for its own smaller payoff beat, distinct from TARGET_HIT's.
  const [cashOutSignal, setCashOutSignal] = useState<number>(0);
  // Whether the round finalized in finalizeRound actually crossed a level
  // threshold — computed there (where before/after are both in scope) and
  // read by ResultPanel, since `progression` itself only carries the
  // already-updated post-round state.
  const [justLeveledUp, setJustLeveledUp] = useState<boolean>(false);

  // Settlement & Results
  const [settlementStep, setSettlementStep] = useState<SettlementStep>('idle');
  const [settlementTxHash, setSettlementTxHash] = useState<string>('');
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);
  const [lastRoundSummary, setLastRoundSummary] = useState<LastRoundSummary | null>(null);

  // Wallet State
  const [wallet, setWallet] = useState<WalletState>(() => web3Service.getState());

  // User Progression (PRD §29 & §30)
  const [progression, setProgression] = useState<UserProgression>({
    level: 7,
    title: 'MOMENTUM HUNTER',
    currentXp: 720,
    nextLevelXp: 770,
    dailyRoundsPlayed: 2,
    dailyRoundsGoal: 3,
    missionCompleted: false,
    streakDays: 3,
  });

  // Settings & Profile Drawers
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isMissionToastOpen, setIsMissionToastOpen] = useState<boolean>(false);
  const [settings, setSettings] = useState<UserSettings>({
    reducedMotion: false,
    soundEnabled: false,
    hapticsEnabled: true,
    useLiveBinance: false,
  });

  // Warp streak callback for asset switching
  const warpTriggerRef = useRef<(() => void) | null>(null);

  // Subscribe to Market Data
  useEffect(() => {
    marketFeed.setAsset(currentAsset, settings.useLiveBinance);
    const unsub = marketFeed.subscribe((tick) => {
      setLatestTick(tick);
    });
    return () => unsub();
  }, [currentAsset, settings.useLiveBinance]);

  // Subscribe to Web3 wallet changes
  useEffect(() => {
    const unsub = web3Service.subscribe((w) => setWallet(w));
    return () => unsub();
  }, []);

  // Sync settings with audio/haptics engine
  useEffect(() => {
    soundEngine.setSoundEnabled(settings.soundEnabled);
    soundEngine.setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.soundEnabled, settings.hapticsEnabled]);

  // Handle Asset Switch with Warp Animation (PRD §10)
  const handleSelectAsset = (asset: AssetSymbol) => {
    if (warpTriggerRef.current) {
      warpTriggerRef.current();
    }
    setCurrentAsset(asset);
    marketFeed.setAsset(asset, settings.useLiveBinance);
  };

  // Connect Wallet — always the mock/demo path (preferDemo=true). A real
  // injected wallet (e.g. Brave's own) blocks on eth_requestAccounts
  // waiting for an approval UI that never appears in a demo/judge/headless
  // context, hanging "Connecting…" forever. This is a full-simulation app —
  // settlement already only ever produces pseudo tx hashes — so there's no
  // real chain interaction to gate behind an actual wallet anyway.
  const handleConnectWallet = async () => {
    await web3Service.connectWallet(true);
  };

  // Transition Home -> Pre-Trade (PRD §8)
  const handlePlayNow = () => {
    setStage('PRE_TRADE');
  };

  // Start Trade Trigger -> Direct Seamless Live Flight (No blocking modal)
  const handleStartTrade = (stake: number) => {
    if (!selectedDirection) return;

    const currentPrice = marketFeed.getCurrentPrice();
    const round = SettlementEngine.initRound(currentAsset, selectedDirection, stake, currentPrice);

    setActiveRound(round);
    setTargetProgressPct(0);
    soundEngine.playLaunchIgnition();
    soundEngine.startEngineHum();
    setStage('LIVE_TRADE');
  };

  // Settle trade round helper
  const finalizeRound = useCallback(
    async (
      outcome: 'win' | 'loss' | 'cashed_out' | 'timeout',
      exitPrice: number,
      finalPnl: number
    ) => {
      if (!activeRound) return;

      soundEngine.stopEngineHum();
      setStage('SETTLING');

      // Execute transparent BNB Chain settlement checkpoint (PRD §27)
      let txHash = '';
      try {
        txHash = await web3Service.executeSettlement((step, hash) => {
          setSettlementStep(step);
          if (hash) setSettlementTxHash(hash);
        });
      } catch {
        txHash = '0x' + Array.from({ length: 64 }, () => 'f').join('');
      }

      // Calculate XP
      const xpEarned = outcome === 'win' ? 50 : 25;
      const nextRoundsPlayed = progression.dailyRoundsPlayed + 1;
      const isJustCompleted =
        !progression.missionCompleted && nextRoundsPlayed >= progression.dailyRoundsGoal;

      // level/nextLevelXp used to never advance here — ResultPanel's
      // level-up view just displayed `level + 1` as a one-off hack, so the
      // threshold never moved and the celebration would silently refire on
      // every future result. UserProgression has no separate "XP per
      // level" field, so the step reuses the same round-number XP-award
      // convention already used elsewhere in this function.
      const gainedXp = xpEarned + (isJustCompleted ? 50 : 0);
      let newXp = progression.currentXp + gainedXp;
      let newLevel = progression.level;
      let newNextLevelXp = progression.nextLevelXp;
      while (newXp >= newNextLevelXp) {
        newLevel += 1;
        newNextLevelXp += 50;
      }
      const leveledUp = newLevel > progression.level;
      setJustLeveledUp(leveledUp);

      setProgression((prev) => ({
        ...prev,
        currentXp: newXp,
        level: newLevel,
        nextLevelXp: newNextLevelXp,
        dailyRoundsPlayed: nextRoundsPlayed,
        missionCompleted: nextRoundsPlayed >= prev.dailyRoundsGoal,
      }));

      if (isJustCompleted) {
        setIsMissionToastOpen(true);
      }

      const result: TradeResult = {
        id: activeRound.id,
        asset: activeRound.asset,
        direction: activeRound.direction,
        stake: activeRound.stake,
        entryPrice: activeRound.entryPrice,
        exitPrice,
        pnl: finalPnl,
        multiplier: (activeRound.stake + finalPnl) / activeRound.stake,
        outcome,
        timestamp: Date.now(),
        txHash,
        xpEarned,
      };

      setLastResult(result);
      setLastRoundSummary({
        pnl: finalPnl,
        direction: activeRound.direction,
        asset: activeRound.asset,
        entryPrice: activeRound.entryPrice,
        exitPrice,
        outcome: finalPnl >= 0 ? 'win' : 'loss',
        timestamp: Date.now(),
      });

      setStage('RESULT');
    },
    [
      activeRound,
      progression.dailyRoundsPlayed,
      progression.dailyRoundsGoal,
      progression.missionCompleted,
      progression.currentXp,
      progression.level,
      progression.nextLevelXp,
    ]
  );

  // Cash Out handler (PRD §26)
  const handleCashOut = () => {
    if (!activeRound) return;
    soundEngine.playCashOutChime();
    // Only a genuinely profitable exit gets its own payoff beat — a
    // break-even/losing cash-out stays exactly as quiet as it is today.
    if (activeRound.currentPnl >= 0) {
      setCashOutSignal((s) => s + 1);
    }
    const currentPrice = marketFeed.getCurrentPrice();
    finalizeRound('cashed_out', currentPrice, activeRound.currentPnl);
  };

  // Timeout handler (PRD §25)
  const handleTimeout = () => {
    if (!activeRound) return;
    const currentPrice = marketFeed.getCurrentPrice();
    finalizeRound('timeout', currentPrice, activeRound.currentPnl);
  };

  // Evaluate ticks during LIVE_TRADE (PRD §17, §20, §23, §37)
  useEffect(() => {
    if (stage !== 'LIVE_TRADE' || !activeRound) return;

    const unsub = marketFeed.subscribe((tick) => {
      // Evaluate tick with exact raw price (PRD §37 Data Integrity)
      const { updatedRound, isTargetHit, isLossHit, targetProgressPct: progPct } =
        SettlementEngine.evaluateTick(activeRound, tick.price);

      setActiveRound(updatedRound);
      setTargetProgressPct(progPct);

      if (autoResolveEnabled) {
        if (isTargetHit) {
          soundEngine.playTargetHitChime();
          setStage('TARGET_HIT');
          setTimeout(() => {
            finalizeRound('win', tick.price, updatedRound.currentPnl);
          }, 1100);
        } else if (isLossHit) {
          soundEngine.playRoundCompleteChime();
          setStage('LOSS_HIT');
          setTimeout(() => {
            finalizeRound('loss', tick.price, updatedRound.currentPnl);
          }, 700);
        }
      }
    });

    return () => unsub();
  }, [stage, activeRound, autoResolveEnabled, finalizeRound]);

  // Restart handlers
  const handlePlayAgain = () => {
    setActiveRound(null);
    setTargetProgressPct(0);
    setSettlementStep('idle');
    setStage('PRE_TRADE');
  };

  const handleGoHome = () => {
    setActiveRound(null);
    setTargetProgressPct(0);
    setSettlementStep('idle');
    setStage('HOME');
  };

  // --- Interactive Mock Simulation Handlers ---
  const handleSimulatePriceBump = (pct: number) => {
    soundEngine.playSurgeThrum();
    marketFeed.pushPriceDelta(pct);
  };

  const handleSimulateTargetHit = () => {
    const price = marketFeed.getCurrentPrice();
    const round = activeRound || SettlementEngine.initRound(currentAsset, selectedDirection || 'LONG', 10, price);
    setActiveRound(round);
    setStage('TARGET_HIT');
    soundEngine.playTargetHitChime();
    setTimeout(() => {
      finalizeRound('win', round.targetPrice, 18.4);
    }, 900);
  };

  const handleSimulateLossHit = () => {
    const price = marketFeed.getCurrentPrice();
    const round = activeRound || SettlementEngine.initRound(currentAsset, selectedDirection || 'LONG', 10, price);
    setActiveRound(round);
    setStage('LOSS_HIT');
    soundEngine.playRoundCompleteChime();
    setTimeout(() => {
      finalizeRound('loss', round.stopLossPrice, -4.2);
    }, 800);
  };

  const handleSimulateCashOut = () => {
    if (activeRound) {
      handleCashOut();
    } else {
      const price = marketFeed.getCurrentPrice();
      const round = SettlementEngine.initRound(currentAsset, selectedDirection || 'LONG', 10, price);
      setActiveRound(round);
      finalizeRound('cashed_out', price, 12.5);
    }
  };

  const handleSimulateLiveLong = () => {
    const price = marketFeed.getCurrentPrice();
    const round = SettlementEngine.initRound(currentAsset, 'LONG', 10, price);
    setActiveRound(round);
    setSelectedDirection('LONG');
    setAutoResolveEnabled(false); // disable auto result popup so flight is continuous
    soundEngine.playLaunchIgnition();
    soundEngine.startEngineHum();
    setStage('LIVE_TRADE');
  };

  const handleSetStage = (targetStage: GameStage) => {
    const price = marketFeed.getCurrentPrice();
    if (targetStage === 'LIVE_TRADE' && !activeRound) {
      const round = SettlementEngine.initRound(currentAsset, selectedDirection || 'LONG', 10, price);
      setActiveRound(round);
    } else if (targetStage === 'RESULT' && !lastResult) {
      setLastResult({
        id: 'sim_result',
        asset: currentAsset,
        direction: 'LONG',
        stake: 10,
        entryPrice: price * 0.98,
        exitPrice: price,
        pnl: 18.4,
        multiplier: 2.84,
        outcome: 'win',
        timestamp: Date.now(),
        txHash: '0x9f83a24b12c5890e71ab456d',
        xpEarned: 50,
      });
    }
    setStage(targetStage);
  };

  // --- Navigation shell state (docs/ refactor) ---------------------------
  // Which of the new stub/real screens is open, layered on top of the
  // existing GameStage machine rather than folded into it — GameStage stays
  // exactly as it is (see the plan's frozen-boundary note on this). The
  // Trade Setup sheet is NOT tracked here: its visibility is simply
  // `stage === 'PRE_TRADE'`, so it works whether opened via swipe-up, via
  // "Trade Again", or via the dev SimulationBar's own stage jumps.
  type ActiveSheet = 'none' | 'menu' | 'asset-selector' | 'pix-chat' | 'position-details';
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');

  const assetOrder = Object.keys(SUPPORTED_ASSETS) as AssetSymbol[];

  const cycleAsset = (step: 1 | -1) => {
    const index = assetOrder.indexOf(currentAsset);
    const next = assetOrder[(index + step + assetOrder.length) % assetOrder.length];
    if (next !== currentAsset) handleSelectAsset(next);
  };

  const handleTrackSwipe = (_: unknown, info: PanInfo) => {
    if (stage === 'LIVE_TRADE' || stage === 'SETTLING') return;
    if (Math.abs(info.offset.x) > 70 || Math.abs(info.velocity.x) > 450) {
      cycleAsset(info.offset.x < 0 ? 1 : -1);
    }
  };

  // The engine's real, fixed leverage (settlementEngine.ts DEFAULT_CONFIG) —
  // read-only, never mutated. UI surfaces used to hardcode a mismatched
  // "10x" label everywhere; this keeps every display honest to the actual
  // engine value (18x) instead.
  const leverage = Math.round(DEFAULT_CONFIG.multiplierLeverage);

  const handleSelectAssetAndClose = (asset: AssetSymbol) => {
    handleSelectAsset(asset);
    setActiveSheet('none');
  };

  const handleDisconnect = () => {
    web3Service.disconnect();
    setActiveSheet('none');
  };

  return (
    <MotionConfig reducedMotion={settings.reducedMotion ? 'always' : 'user'}>
      <div className="app-frame relative flex flex-col w-full overflow-hidden bg-[color:var(--color-bg-0)] font-sans sm:border-x sm:border-[color:var(--color-line)]">
        <Header wallet={wallet} onOpenMenu={() => setActiveSheet('menu')} />

        <main id="track-stage" className="relative flex-1 flex flex-col overflow-hidden">
          {/* Continuous 60 FPS Market Track Canvas (Full Viewport 100% Bleed) */}
          <div className="absolute inset-0 w-full h-full z-0 overflow-hidden">
            <MarketTrackCanvas
              gameStage={stage}
              activeRound={activeRound}
              selectedDirection={selectedDirection}
              lastRound={lastRoundSummary}
              targetProgressPct={targetProgressPct}
              currentAsset={currentAsset}
              reducedMotion={settings.reducedMotion}
              onWarpTrigger={(fn) => {
                warpTriggerRef.current = fn;
              }}
              cashOutSignal={cashOutSignal}
            />
          </div>

          {/* Ambient depth vignette */}
          <div className="absolute inset-0 pointer-events-none z-10 bg-gradient-to-b from-[color:var(--color-bg-0)]/55 via-transparent to-[color:var(--color-bg-0)]/75" />

          {/* Swipe anywhere on the track to cycle assets — secondary to the
              tap-the-asset-name path now that Asset Selector exists. */}
          <motion.div
            className="absolute inset-0 z-[15]"
            style={{ touchAction: 'pan-y' }}
            drag="x"
            dragSnapToOrigin
            dragElastic={0.16}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={handleTrackSwipe}
          />

          <PixCompanion
            gameStage={stage}
            targetProgressPct={targetProgressPct}
            currentPnl={activeRound ? activeRound.currentPnl : 0}
            selectedDirection={selectedDirection}
            onTap={() => setActiveSheet('pix-chat')}
          />

          {/* Bottom content — Home hero, active-trade HUD, or a resolving
              indicator. Not a sheet: an active round is a persistent state
              the player doesn't dismiss, unlike Trade Setup/Menu/etc. */}
          <div className="relative z-20 mt-auto w-full px-4 pt-2 pad-safe-bottom flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
              {stage === 'HOME' && activeRound && (
                <div className="pointer-events-auto">
                  <ActivePositionBanner
                    round={activeRound}
                    onTap={() => setActiveSheet('position-details')}
                  />
                </div>
              )}
            </AnimatePresence>

            <div className="pointer-events-auto">
              {stage === 'HOME' && (
                <HomeHeroOverlay
                  isWalletConnected={wallet.isConnected}
                  onConnectWallet={handleConnectWallet}
                  onOpenTradeSheet={handlePlayNow}
                  onOpenAssetSelector={() => setActiveSheet('asset-selector')}
                  currentAsset={currentAsset}
                  latestTick={latestTick}
                  progression={progression}
                />
              )}

              {stage === 'LIVE_TRADE' && activeRound && (
                <LiveTradeOverlay
                  round={activeRound}
                  targetProgressPct={targetProgressPct}
                  autoResolveEnabled={autoResolveEnabled}
                  onCashOut={handleCashOut}
                  onTimeout={handleTimeout}
                  onOpenPositionDetails={() => setActiveSheet('position-details')}
                  leverage={leverage}
                />
              )}

              {(stage === 'TARGET_HIT' || stage === 'LOSS_HIT' || stage === 'SETTLING') && (
                <div className="flex items-center justify-center gap-2 h-16 text-[length:var(--text-metadata)] font-bold uppercase tracking-widest text-[color:var(--color-text-3)]">
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-ping"
                    style={{ backgroundColor: 'var(--color-bnb-yellow)' }}
                  />
                  <span>Resolving round</span>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Dramatic TARGET HIT / LOSS HIT Impact Overlay (PRD §20 & §23) */}
        <OutcomeBannerOverlay
          gameStage={stage}
          pnl={activeRound ? activeRound.currentPnl : 18.4}
          multiplier={activeRound ? activeRound.currentMultiplier : 2.8}
        />

        {/* Settlement Checkpoint Modal (PRD §27) */}
        <AnimatePresence>
          {stage === 'SETTLING' && (
            <SettlementOverlay
              step={settlementStep}
              txHash={settlementTxHash}
              pnl={activeRound ? activeRound.currentPnl : 0}
            />
          )}
        </AnimatePresence>

        {/* Trade Result — docs/UI_UX_SPEC.md §6/§7 */}
        <AnimatePresence>
          {stage === 'RESULT' && lastResult && (
            <ResultPanel
              result={lastResult}
              progression={progression}
              leverage={leverage}
              justLeveledUp={justLeveledUp}
              onPlayAgain={handlePlayAgain}
              onGoHome={handleGoHome}
              onViewDetails={() => setActiveSheet('position-details')}
              onClose={handlePlayAgain}
            />
          )}
        </AnimatePresence>

        {/* Trade Setup — docs/UI_UX_SPEC.md §3. A real bottom sheet, off-screen
            until stage reaches PRE_TRADE (swipe-up, "Trade Again", or the dev
            SimulationBar), unlike the old permanently-docked cockpit HUD. */}
        <AnimatePresence>
          {stage === 'PRE_TRADE' && (
            <Sheet onClose={handleGoHome} variant="game">
              <PreTradePanel
                currentAsset={currentAsset}
                selectedDirection={selectedDirection}
                onSelectDirection={(dir) => setSelectedDirection(dir)}
                onStartTrade={handleStartTrade}
                leverage={leverage}
              />
            </Sheet>
          )}
        </AnimatePresence>

        {/* Menu — docs/UI_UX_SPEC.md §11. Profile/Settings route to the
            existing, working drawer/modal rather than duplicating them. */}
        <AnimatePresence>
          {activeSheet === 'menu' && (
            <Menu
              progression={progression}
              isWalletConnected={wallet.isConnected}
              onClose={() => setActiveSheet('none')}
              onOpenProfile={() => {
                setActiveSheet('none');
                setIsProfileOpen(true);
              }}
              onOpenSettings={() => {
                setActiveSheet('none');
                setIsSettingsOpen(true);
              }}
              onDisconnect={handleDisconnect}
            />
          )}
        </AnimatePresence>

        {/* Asset Selector — docs/UI_UX_SPEC.md §9 */}
        <AnimatePresence>
          {activeSheet === 'asset-selector' && (
            <AssetSelector
              currentAsset={currentAsset}
              latestTick={latestTick}
              onSelect={handleSelectAssetAndClose}
              onClose={() => setActiveSheet('none')}
            />
          )}
        </AnimatePresence>

        {/* PIX AI Chat — docs/UI_UX_SPEC.md §10 */}
        <AnimatePresence>
          {activeSheet === 'pix-chat' && (
            <PixChat
              currentAsset={currentAsset}
              change24h={latestTick ? latestTick.change24h : 0}
              onClose={() => setActiveSheet('none')}
            />
          )}
        </AnimatePresence>

        {/* Position Details — docs/UI_UX_SPEC.md §8. Real data: activeRound
            stays populated through LIVE_TRADE and RESULT (finalizeRound never
            clears it — only Play Again/Home do), so this works from both. */}
        <AnimatePresence>
          {activeSheet === 'position-details' && activeRound && (
            <PositionDetails
              round={activeRound}
              leverage={leverage}
              onClose={() => setActiveSheet('none')}
            />
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          settings={settings}
          onUpdateSettings={(newSettings) =>
            setSettings((prev) => ({ ...prev, ...newSettings }))
          }
          onClose={() => setIsSettingsOpen(false)}
        />

        {/* Daily Mission Completion Toast (PRD §30) */}
        <MissionToast
          isOpen={isMissionToastOpen}
          roundsPlayed={progression.dailyRoundsPlayed}
          roundsGoal={progression.dailyRoundsGoal}
          xpBonus={50}
          onDismiss={() => setIsMissionToastOpen(false)}
        />

        {/* Pilot Profile & Web3 Badges Drawer — reached via Menu now */}
        <PilotProfileDrawer
          isOpen={isProfileOpen}
          progression={progression}
          wallet={wallet}
          settings={settings}
          onUpdateSettings={(newSettings) =>
            setSettings((prev) => ({ ...prev, ...newSettings }))
          }
          onConnectWallet={handleConnectWallet}
          onClose={() => setIsProfileOpen(false)}
        />

        {/* UI Mock Simulation Toolbar */}
        <SimulationBar
          currentStage={stage}
          autoResolveEnabled={autoResolveEnabled}
          onToggleAutoResolve={() => setAutoResolveEnabled((prev) => !prev)}
          onSimulateLiveLong={handleSimulateLiveLong}
          onSetStage={handleSetStage}
          onSimulatePriceBump={handleSimulatePriceBump}
          onSimulateTargetHit={handleSimulateTargetHit}
          onSimulateLossHit={handleSimulateLossHit}
          onSimulateCashOut={handleSimulateCashOut}
          onTriggerMissionToast={() => setIsMissionToastOpen(true)}
        />
      </div>
    </MotionConfig>
  );
};
