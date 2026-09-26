import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConfigDTO } from '@bnbplay/shared/dto';
import { MarketTrackCanvas } from './canvas/MarketTrackCanvas';
import { Header } from './components/Header';
import { HomeHeroOverlay } from './components/HomeHeroOverlay';
import { PreTradePanel } from './components/PreTradePanel';
import { LiveTradeOverlay } from './components/LiveTradeOverlay';
import { LaunchCountdown } from './components/LaunchCountdown';
import { SettlementOverlay } from './components/SettlementOverlay';
import { ResultPanel } from './components/ResultPanel';
import { SettingsModal } from './components/SettingsModal';
import { PixCompanion } from './components/PixCompanion';
import { OutcomeBannerOverlay } from './components/OutcomeBannerOverlay';
import { SimulationBar } from './components/SimulationBar';
import { MissionToast } from './components/MissionToast';
import { NoticeToast } from './components/NoticeToast';
import { PilotProfileDrawer } from './components/PilotProfileDrawer';
import { ActivePositionBanner } from './components/ActivePositionBanner';
import { AssetSelector } from './components/AssetSelector';
import { ConnectSheet } from './components/ConnectSheet';
import { Menu } from './components/Menu';
import { PixChat } from './components/PixChat';
import { PositionDetails } from './components/PositionDetails';
import { useLiveRound } from './components/game/useLiveRound';
import { usePracticeRound, type PracticeLaunch } from './components/game/usePracticeRound';
import { liveTierOptions, pickTier, practiceTierOptions, clampStake } from './components/game/tiers';
import {
  EMPTY_PROGRESSION,
  badgeProgressFromProfile,
  badgeViews,
  mergeUnlocked,
  missionNotice,
  progressionFromEvent,
  progressionFromProfile,
  type BadgeProgress,
  type MissionNotice,
} from './components/game/progression';
import { TIME_UP_COPY, roundEndMs } from './components/game/roundDisplay';
import { Sheet } from './ui/Sheet';
import { usePrefersReducedMotion } from './ui/motion';
import { ConfettiLayer } from './ui/lucky/Confetti';
import { formatHash } from './ui/lucky/format';

import { apiClient, isBackendAvailable } from './api/runtime';
import { toApiError } from './api/errors';
import { fxPnlForRound } from './game/fx';
import { marketFeed } from './services/marketFeed';
import { roundService, type ProgressionPayload } from './services/roundService';
import { web3Service, WalletState, SettlementStep } from './services/web3Service';
import { soundEngine } from './services/audioHaptics';
import { useDevScene } from './dev/useDevScene';

import { AssetSymbol, MarketFeedStatus, PriceTick, SUPPORTED_ASSETS } from './types/market';
import {
  GameStage,
  PositionDirection,
  ActiveTradeRound,
  TradeResult,
  LastRoundSummary,
  UserProgression,
  UserSettings,
} from './types/game';
type ActiveSheet = 'none' | 'menu' | 'asset-selector' | 'pix-chat' | 'position-details';

const DEFAULT_STAKE = 10;
const IDLE_STAGES: ReadonlySet<GameStage> = new Set<GameStage>(['HOME', 'PRE_TRADE']);
const TRACK_SWIPE_STAGES: ReadonlySet<GameStage> = IDLE_STAGES;
const RESOLVING_STAGES: ReadonlySet<GameStage> = new Set<GameStage>(['TARGET_HIT', 'LOSS_HIT', 'SETTLING']);
const HUM_KEEP_STAGES: ReadonlySet<GameStage> = new Set<GameStage>(['LAUNCHING', 'LIVE_TRADE', 'TARGET_HIT']);

const wallNow = () => Date.now();
const serverNow = () => roundService.serverNow();

const exitAtClientMs = (result: TradeResult): number =>
  result.decisionSec !== undefined ? result.decisionSec * 1000 - (roundService.serverNow() - Date.now()) : result.timestamp;

export const App: React.FC = () => {
  const [appStage, setAppStage] = useState<GameStage>('HOME');
  const [currentAsset, setCurrentAsset] = useState<AssetSymbol>('BNB');
  const [latestTick, setLatestTick] = useState<PriceTick | null>(null);
  const [feedStatus, setFeedStatus] = useState<MarketFeedStatus | null>(null);

  const [selectedDirection, setSelectedDirection] = useState<PositionDirection | null>(null);
  const [stake, setStake] = useState<number>(DEFAULT_STAKE);
  const [tierChoice, setTierChoice] = useState<number>(0);

  const [activeRound, setActiveRound] = useState<ActiveTradeRound | null>(null);
  const [targetProgressPct, setTargetProgressPct] = useState<number>(0);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState<boolean>(true);
  const [cashOutSignal, setCashOutSignal] = useState<number>(0);
  const [justLeveledUp, setJustLeveledUp] = useState<boolean>(false);

  const [settlementStep, setSettlementStep] = useState<SettlementStep>('idle');
  const [settlementTxHash, setSettlementTxHash] = useState<string>('');
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);
  const [lastRoundSummary, setLastRoundSummary] = useState<LastRoundSummary | null>(null);

  const [wallet, setWallet] = useState<WalletState>(() => web3Service.getState());
  const [progression, setProgression] = useState<UserProgression>(EMPTY_PROGRESSION);
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress[]>([]);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isConnectOpen, setIsConnectOpen] = useState<boolean>(false);
  const [isMissionToastOpen, setIsMissionToastOpen] = useState<boolean>(false);
  const [mission, setMission] = useState<MissionNotice | null>(null);
  const [practiceNotice, setPracticeNotice] = useState<{ id: number; title: string; body: string } | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() => ({
    reducedMotion: false,
    soundEnabled: false,
    hapticsEnabled: true,
    useLiveBinance: false,
    practiceMode: !isBackendAvailable(),
  }));
  const osReduced = usePrefersReducedMotion();
  const reduced = settings.reducedMotion || osReduced;
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduce' : 'full';
  }, [reduced]);

  const [activeSheet, setActiveSheet] = useState<ActiveSheet>('none');
  const warpTriggerRef = useRef<(() => void) | null>(null);
  const missionIdRef = useRef(0);
  const noticeIdRef = useRef(0);

  const handleConnectWallet = useCallback(async () => {
    await web3Service.connectWallet(true).catch(() => undefined);
  }, []);

  const handlePlayNow = useCallback(() => {
    setAppStage('PRE_TRADE');
  }, []);

  const devScene = useDevScene({
    setStage: setAppStage,
    setCurrentAsset,
    setSelectedDirection,
    setActiveRound,
    setTargetProgressPct,
    setJustLeveledUp,
    setSettlementStep,
    setSettlementTxHash,
    setLastResult,
    setLastRoundSummary,
    setProgression,
    setIsSettingsOpen,
    setIsProfileOpen,
    setIsMissionToastOpen,
    setSettings,
    setActiveSheet,
    handleConnectWallet,
    handlePlayNow,
  });

  const liveAvailable = isBackendAvailable() && !devScene.active;
  const practice = !liveAvailable || (settings.practiceMode ?? !liveAvailable);

  const queryClient = useQueryClient();
  const handleProgression = useCallback(
    (event: ProgressionPayload) => {
      setProgression(progressionFromEvent(event));
      setBadgeProgress((prev) => mergeUnlocked(prev, event.badgesUnlocked));
      const notice = missionNotice(event, ++missionIdRef.current);
      if (notice) {
        setMission(notice);
        setIsMissionToastOpen(true);
      }
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    [queryClient],
  );

  const handleResume = useCallback((info: { asset: AssetSymbol; direction: PositionDirection | null }) => {
    setCurrentAsset(info.asset);
    if (info.direction) setSelectedDirection(info.direction);
  }, []);

  const live = useLiveRound(!practice, { onProgression: handleProgression, onResume: handleResume });
  const liveView = live.view;
  const liveOwnsStage = !practice && liveView.stage !== null;

  const stage: GameStage = liveOwnsStage && liveView.stage ? liveView.stage : appStage;
  const round = liveOwnsStage ? liveView.round : activeRound;
  const progressPct = liveOwnsStage ? liveView.progressPct : targetProgressPct;
  const result = liveOwnsStage ? liveView.result : lastResult;
  const settleStep = liveOwnsStage ? liveView.settlement.step : settlementStep;
  const settleTx = liveOwnsStage ? liveView.settlement.txHash : settlementTxHash;

  const practiceRound = usePracticeRound({
    enabled: practice,
    stage: appStage,
    activeRound,
    autoResolveEnabled,
    sink: {
      setStage: setAppStage,
      setActiveRound,
      setTargetProgressPct,
      setSettlementStep,
      setSettlementTxHash,
      setLastResult,
      setLastRoundSummary,
      onCashOutBeat: () => setCashOutSignal((s) => s + 1),
    },
  });

  useEffect(() => {
    marketFeed.setAsset(currentAsset, !practice);
    return marketFeed.subscribe((tick) => setLatestTick(tick));
  }, [currentAsset, practice]);

  useEffect(() => marketFeed.subscribeStatus(setFeedStatus), []);

  useEffect(() => web3Service.subscribe((w) => setWallet(w)), []);

  useEffect(() => {
    soundEngine.setSoundEnabled(settings.soundEnabled);
    soundEngine.setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.soundEnabled, settings.hapticsEnabled]);

  const lastStageRef = useRef<GameStage>(stage);
  useEffect(() => {
    if (lastStageRef.current === stage) return;
    lastStageRef.current = stage;
    if (stage === 'TARGET_HIT') soundEngine.playTargetHitChime();
    else if (stage === 'LOSS_HIT') soundEngine.playRoundCompleteChime();
    if (stage === 'LIVE_TRADE') soundEngine.startEngineHum();
    else if (!HUM_KEEP_STAGES.has(stage)) soundEngine.stopEngineHum();
  }, [stage]);

  const [config, setConfig] = useState<ConfigDTO | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  useEffect(() => {
    if (practice) return;
    let alive = true;
    roundService
      .getConfig()
      .then((next) => {
        if (!alive) return;
        setConfig(next);
        setConfigError(null);
      })
      .catch((error: unknown) => {
        if (alive) setConfigError(toApiError(error, 'NETWORK').message);
      });
    return () => {
      alive = false;
    };
  }, [practice]);

  const tiers = useMemo(
    () => (practice ? practiceTierOptions(currentAsset) : liveTierOptions(config, currentAsset)),
    [practice, config, currentAsset],
  );
  const selectedTier = pickTier(tiers, tierChoice);

  useEffect(() => {
    if (selectedTier) setStake((prev) => clampStake(prev, selectedTier));
  }, [selectedTier]);

  const address = wallet.isConnected ? wallet.address : null;
  const profileQuery = useQuery({
    queryKey: ['profile', address],
    queryFn: () => apiClient.profile(address ?? ''),
    enabled: !practice && apiClient.isEnabled() && address !== null,
    staleTime: 30_000,
  });
  const profile = profileQuery.data ?? null;
  useEffect(() => {
    if (!profile) return;
    setProgression(progressionFromProfile(profile));
    setBadgeProgress(badgeProgressFromProfile(profile));
  }, [profile]);

  const lastLiveResultRef = useRef<string | null>(null);
  useEffect(() => {
    const settled = liveView.result;
    if (!settled || settled.voided || !settled.roundId || lastLiveResultRef.current === settled.roundId) return;
    lastLiveResultRef.current = settled.roundId;
    setLastRoundSummary({
      pnl: settled.pnl,
      direction: settled.direction,
      asset: settled.asset,
      entryPrice: settled.entryPrice,
      exitPrice: settled.exitPrice,
      outcome: settled.pnl >= 0 ? 'win' : 'loss',
      timestamp: exitAtClientMs(settled),
    });
  }, [liveView.result]);

  const displayName =
    profile?.displayName ??
    (wallet.isConnected && wallet.address ? (wallet.kind === 'guest' ? 'Guest pilot' : formatHash(wallet.address)) : 'Pilot');
  const badges = useMemo(() => badgeViews(badgeProgress), [badgeProgress]);

  const handleSelectAsset = (asset: AssetSymbol) => {
    if (warpTriggerRef.current) warpTriggerRef.current();
    setCurrentAsset(asset);
  };

  const practiceParams = (direction: PositionDirection | null = selectedDirection): PracticeLaunch => ({
    asset: currentAsset,
    direction: direction ?? 'LONG',
    stake,
    tier: selectedTier?.tier ?? 0,
  });

  const notifyPractice = (title: string, body: string) => setPracticeNotice({ id: ++noticeIdRef.current, title, body });

  const handleStartTrade = (commitStake: number) => {
    if (!selectedDirection || !selectedTier) return;
    if (practice) {
      const launched = practiceRound.launch({ asset: currentAsset, direction: selectedDirection, stake: commitStake, tier: selectedTier.tier });
      if (!launched) notifyPractice('PRACTICE LANE UNAVAILABLE', `${currentAsset} has no practice lane right now.`);
      return;
    }
    const predicted = marketFeed.getLastExactRound()?.price ?? marketFeed.getCurrentPrice();
    void live.controller.launch(
      { asset: currentAsset, tier: selectedTier.tier, direction: selectedDirection, stakeUsd: commitStake },
      predicted,
    );
  };

  const handleCashOut = () => {
    soundEngine.playCashOutChime();
    if (practice) {
      practiceRound.cashOut();
      return;
    }
    if (round && round.currentPnl >= 0) setCashOutSignal((s) => s + 1);
    void live.controller.cashOut();
  };

  const finishRound = (next: GameStage) => {
    if (liveOwnsStage) live.controller.acknowledge();
    practiceRound.reset();
    setActiveRound(null);
    setTargetProgressPct(0);
    setSettlementStep('idle');
    setSettlementTxHash('');
    setJustLeveledUp(false);
    setAppStage(next);
  };

  const handlePlayAgain = () => finishRound('PRE_TRADE');
  const handleGoHome = () => finishRound('HOME');

  const handleSimulatePriceBump = (pct: number) => {
    soundEngine.playSurgeThrum();
    marketFeed.pushPriceDelta(pct);
  };

  const handleSimulateLiveLong = () => {
    setSelectedDirection('LONG');
    setAutoResolveEnabled(false);
    practiceRound.fly(practiceParams('LONG'));
  };

  const handleSimulateCashOut = () => {
    if (activeRound && appStage === 'LIVE_TRADE') handleCashOut();
    else practiceRound.settleNow('cashed_out', practiceParams());
  };

  const handleSetStage = (target: GameStage) => {
    if (target === 'LIVE_TRADE' && !activeRound) {
      practiceRound.fly(practiceParams());
      return;
    }
    if (target === 'RESULT' && !lastResult) {
      practiceRound.settleNow('win', practiceParams());
      return;
    }
    setAppStage(target);
  };

  const assetOrder = Object.keys(SUPPORTED_ASSETS) as AssetSymbol[];

  const cycleAsset = (step: 1 | -1) => {
    const index = assetOrder.indexOf(currentAsset);
    const next = assetOrder[(index + step + assetOrder.length) % assetOrder.length];
    if (next !== currentAsset) handleSelectAsset(next);
  };

  const handleTrackSwipe = (_: unknown, info: PanInfo) => {
    if (!TRACK_SWIPE_STAGES.has(stage)) return;
    if (Math.abs(info.offset.x) > 70 || Math.abs(info.velocity.x) > 450) {
      cycleAsset(info.offset.x < 0 ? 1 : -1);
    }
  };

  const handleSelectAssetAndClose = (asset: AssetSymbol) => {
    handleSelectAsset(asset);
    setActiveSheet('none');
  };

  const handleDisconnect = () => {
    web3Service.disconnect();
    setActiveSheet('none');
  };

  const openConnect = () => {
    setIsProfileOpen(false);
    setActiveSheet('none');
    setIsConnectOpen(true);
  };

  const modeLocked = !IDLE_STAGES.has(stage) || live.controller.isBusy();
  const handlePracticeModeChange = (next: boolean) => {
    if (modeLocked || (!next && !liveAvailable)) return;
    setActiveRound(null);
    setTargetProgressPct(0);
    setSettings((prev) => ({ ...prev, practiceMode: next }));
  };

  const needsConnect = !practice && !wallet.isConnected;
  const credits = wallet.creditsUsd ?? null;
  const blockedReason = practice
    ? null
    : configError
      ? `Lanes are unavailable: ${configError}`
      : config && !config.contracts
        ? 'Contracts are not deployed yet. Launch is paused.'
        : feedStatus?.oracle && feedStatus.oracle !== 'ok'
          ? `The oracle is ${feedStatus.oracle}. Launch is paused.`
          : wallet.isConnected && credits !== null && selectedTier && credits < selectedTier.minStake
            ? 'Not enough test credits for the minimum stake.'
            : wallet.isConnected && credits !== null && stake > credits
              ? 'This stake is above your test credits.'
              : null;

  const fx = round ? fxPnlForRound(round) : 0;
  const roundNow = round?.mode === 'live' ? serverNow : wallNow;
  const inFlight = round !== null && round.outcome === undefined && !IDLE_STAGES.has(stage) && stage !== 'RESULT';
  const settlementVariant = (round?.mode ?? result?.mode) === 'practice' ? 'practice' : 'live';
  const liveReason = liveOwnsStage ? liveView.settlement.reason : null;
  const notice = liveView.notice ?? practiceNotice;

  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>
      <div className="app-frame flex flex-col w-full overflow-hidden bg-lobby font-sans sm:border-x sm:border-frame">
        <Header wallet={wallet} practice={practice} onOpenMenu={() => setActiveSheet('menu')} />
        <ConfettiLayer />

        <main id="track-stage" className="relative flex-1 flex flex-col overflow-hidden">
          <div className="absolute inset-0 w-full h-full z-0 overflow-hidden">
            <MarketTrackCanvas
              gameStage={stage}
              activeRound={round}
              selectedDirection={selectedDirection}
              lastRound={lastRoundSummary}
              targetProgressPct={progressPct}
              currentAsset={currentAsset}
              reducedMotion={reduced}
              onWarpTrigger={(fn) => {
                warpTriggerRef.current = fn;
              }}
              cashOutSignal={cashOutSignal}
            />
          </div>

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
            targetProgressPct={progressPct}
            fxPnl={fx}
            selectedDirection={selectedDirection}
            onTap={() => setActiveSheet('pix-chat')}
          />

          <AnimatePresence>
            {stage === 'LAUNCHING' &&
              (liveOwnsStage && liveView.launch ? (
                <LaunchCountdown key="launch-live" variant="live" launch={liveView.launch} now={wallNow} />
              ) : activeRound ? (
                <LaunchCountdown
                  key="launch-practice"
                  variant="practice"
                  entryPrice={activeRound.entryPrice}
                  direction={activeRound.direction}
                  onLaunchComplete={practiceRound.completeLaunch}
                />
              ) : null)}
          </AnimatePresence>

          <div className="relative z-20 mt-auto w-full px-6 pt-2 pad-safe-bottom flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
              {stage === 'HOME' && round && (
                <div className="pointer-events-auto">
                  <ActivePositionBanner round={round} onTap={() => setActiveSheet('position-details')} />
                </div>
              )}
            </AnimatePresence>

            <div className="pointer-events-auto">
              {stage === 'HOME' && (
                <HomeHeroOverlay
                  isWalletConnected={wallet.isConnected}
                  onConnectWallet={openConnect}
                  onOpenTradeSheet={handlePlayNow}
                  onOpenAssetSelector={() => setActiveSheet('asset-selector')}
                  currentAsset={currentAsset}
                  latestTick={latestTick}
                  progression={progression}
                />
              )}

              {stage === 'LIVE_TRADE' && round && (
                <LiveTradeOverlay
                  round={round}
                  targetProgressPct={progressPct}
                  autoResolveEnabled={liveOwnsStage || autoResolveEnabled}
                  onCashOut={handleCashOut}
                  onOpenPositionDetails={() => setActiveSheet('position-details')}
                  endMs={roundEndMs(round)}
                  now={roundNow}
                  cashOut={liveOwnsStage ? liveView.cashOut : undefined}
                />
              )}

              {RESOLVING_STAGES.has(stage) && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center justify-center gap-2 h-16 text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted"
                >
                  <span aria-hidden="true" className="w-2 h-2 rounded-full bg-ink-muted" />
                  <span>{liveReason === 'time' ? TIME_UP_COPY : 'Resolving round'}</span>
                </div>
              )}
            </div>
          </div>
        </main>

        <OutcomeBannerOverlay gameStage={stage} pnl={round ? round.currentPnl : null} multiplier={round ? round.currentMultiplier : null} />

        <AnimatePresence>
          {stage === 'SETTLING' && (
            <SettlementOverlay
              step={settleStep}
              txHash={settleTx}
              pnl={round ? round.currentPnl : 0}
              variant={settlementVariant}
              estimate={liveOwnsStage && liveReason !== 'target' && liveReason !== 'stop'}
              reason={liveReason}
              exitPrice={liveOwnsStage ? liveView.cashOut.exitPrice : null}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stage === 'RESULT' && result && (
            <ResultPanel
              result={result}
              progression={progression}
              justLeveledUp={liveOwnsStage ? false : justLeveledUp}
              xp={liveOwnsStage ? liveView.xp : null}
              xpPending={liveOwnsStage && liveView.xpPending}
              onPlayAgain={handlePlayAgain}
              onGoHome={handleGoHome}
              onViewDetails={() => setActiveSheet('position-details')}
              onClose={handlePlayAgain}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stage === 'PRE_TRADE' && (
            <Sheet onClose={handleGoHome} variant="game">
              <PreTradePanel
                currentAsset={currentAsset}
                selectedDirection={selectedDirection}
                onSelectDirection={(dir) => setSelectedDirection(dir)}
                onStartTrade={handleStartTrade}
                mode={practice ? 'practice' : 'live'}
                tiers={tiers}
                selectedTier={selectedTier}
                onSelectTier={setTierChoice}
                stake={stake}
                onStakeChange={setStake}
                creditsUsd={credits}
                blockedReason={blockedReason}
                needsConnect={needsConnect}
                onConnect={openConnect}
              />
            </Sheet>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeSheet === 'menu' && (
            <Menu
              progression={progression}
              isWalletConnected={wallet.isConnected}
              displayName={displayName}
              openPositions={inFlight ? 1 : 0}
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

        <AnimatePresence>
          {activeSheet === 'pix-chat' && (
            <PixChat currentAsset={currentAsset} change24h={latestTick ? latestTick.change24h : 0} onClose={() => setActiveSheet('none')} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {activeSheet === 'position-details' && round && (
            <PositionDetails round={round} now={roundNow} onClose={() => setActiveSheet('none')} />
          )}
        </AnimatePresence>

        <AnimatePresence>{isConnectOpen && <ConnectSheet onClose={() => setIsConnectOpen(false)} />}</AnimatePresence>

        <SettingsModal
          isOpen={isSettingsOpen}
          settings={settings}
          onUpdateSettings={(newSettings) => setSettings((prev) => ({ ...prev, ...newSettings }))}
          onClose={() => setIsSettingsOpen(false)}
          practiceMode={practice}
          onPracticeModeChange={handlePracticeModeChange}
          modeLocked={modeLocked}
          liveAvailable={liveAvailable}
        />

        <MissionToast
          isOpen={isMissionToastOpen}
          roundsPlayed={mission?.progress ?? progression.dailyRoundsPlayed}
          roundsGoal={mission?.goal ?? progression.dailyRoundsGoal}
          xpBonus={mission?.xp}
          title={mission?.title}
          onDismiss={() => setIsMissionToastOpen(false)}
        />

        <NoticeToast
          notice={notice}
          onDismiss={(id) => {
            live.controller.dismissNotice(id);
            setPracticeNotice((prev) => (prev?.id === id ? null : prev));
          }}
        />

        <PilotProfileDrawer
          isOpen={isProfileOpen}
          progression={progression}
          wallet={wallet}
          settings={settings}
          onUpdateSettings={(newSettings) => setSettings((prev) => ({ ...prev, ...newSettings }))}
          onConnectWallet={openConnect}
          onClose={() => setIsProfileOpen(false)}
          badges={badges}
          practiceMode={practice}
          onPracticeModeChange={handlePracticeModeChange}
          modeLocked={modeLocked}
          liveAvailable={liveAvailable}
        />

        {practice && (!devScene.active || devScene.sim) ? (
          <SimulationBar
            currentStage={stage}
            autoResolveEnabled={autoResolveEnabled}
            onToggleAutoResolve={() => setAutoResolveEnabled((prev) => !prev)}
            onSimulateLiveLong={handleSimulateLiveLong}
            onSetStage={handleSetStage}
            onSimulatePriceBump={handleSimulatePriceBump}
            onSimulateTargetHit={() => practiceRound.forceBarrier('target', practiceParams())}
            onSimulateLossHit={() => practiceRound.forceBarrier('stop', practiceParams())}
            onSimulateCashOut={handleSimulateCashOut}
            onTriggerMissionToast={() => setIsMissionToastOpen(true)}
          />
        ) : null}
      </div>
    </MotionConfig>
  );
};
