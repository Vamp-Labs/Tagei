import { useCallback, useEffect, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { marketFeed } from '../../services/marketFeed';
import { SettlementEngine } from '../../services/settlementEngine';
import { web3Service, type SettlementStep } from '../../services/web3Service';
import type { ActiveTradeRound, GameStage, LastRoundSummary, PositionDirection, TradeResult } from '../../types/game';
import type { AssetSymbol } from '../../types/market';
import { IMPACT_BEAT_MS } from './liveRoundController';
import { roundEndMs } from './roundDisplay';

export const PRACTICE_SETTLE_MS = 600;

const BARRIER_NUDGE = 1e-7;

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface PracticeSink {
  setStage: Setter<GameStage>;
  setActiveRound: Setter<ActiveTradeRound | null>;
  setTargetProgressPct: Setter<number>;
  setSettlementStep: Setter<SettlementStep>;
  setSettlementTxHash: Setter<string>;
  setLastResult: Setter<TradeResult | null>;
  setLastRoundSummary: Setter<LastRoundSummary | null>;
  onCashOutBeat: () => void;
}

export interface PracticeRoundOptions {
  enabled: boolean;
  stage: GameStage;
  activeRound: ActiveTradeRound | null;
  autoResolveEnabled: boolean;
  sink: PracticeSink;
}

export interface PracticeLaunch {
  asset: AssetSymbol;
  direction: PositionDirection;
  stake: number;
  tier: number;
}

type Outcome = TradeResult['outcome'];

export function createPracticeRound({ asset, direction, stake, tier }: PracticeLaunch): ActiveTradeRound | null {
  const lane = SettlementEngine.practiceLane(asset, tier) ?? SettlementEngine.practiceLane(asset, 0);
  if (!lane) return null;
  return SettlementEngine.initLaneRound(asset, direction, stake, marketFeed.getCurrentPrice(), lane);
}

export function priceBeyond(round: ActiveTradeRound, barrier: 'target' | 'stop'): number {
  const upward = (barrier === 'target') === (round.direction === 'LONG');
  const price = barrier === 'target' ? round.targetPrice : round.stopLossPrice;
  return price * (1 + (upward ? BARRIER_NUDGE : -BARRIER_NUDGE));
}

export function practiceResult(round: ActiveTradeRound, outcome: Outcome, exitAtMs: number): TradeResult {
  const payout = Math.max(0, round.stake + round.currentPnl);
  return {
    id: round.id,
    asset: round.asset,
    direction: round.direction,
    stake: round.stake,
    entryPrice: round.entryPrice,
    exitPrice: round.currentPrice,
    pnl: round.currentPnl,
    multiplier: round.stake > 0 ? payout / round.stake : 0,
    outcome,
    timestamp: exitAtMs,
    txHash: '',
    xpEarned: 0,
    mode: 'practice',
    tier: round.tier,
    tierLabel: round.tierLabel,
    payout,
    multiplierBps: round.multiplierBps,
    feeBps: round.feeBps,
    entrySec: round.entrySec,
    decisionSec: Math.floor(exitAtMs / 1000),
    durationSec: Math.max(0, (exitAtMs - round.startTime) / 1000),
    voided: false,
    voidReason: null,
  };
}

export function usePracticeRound({ enabled, stage, activeRound, autoResolveEnabled, sink }: PracticeRoundOptions) {
  const stageRef = useRef(stage);
  const roundRef = useRef(activeRound);
  const autoRef = useRef(autoResolveEnabled);
  const sinkRef = useRef(sink);
  const markedAtRef = useRef(0);
  const resolvingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    stageRef.current = stage;
    roundRef.current = activeRound;
    autoRef.current = autoResolveEnabled;
    sinkRef.current = sink;
  });

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    if (beatRef.current !== null) clearTimeout(beatRef.current);
    timeoutRef.current = null;
    beatRef.current = null;
  }, []);

  const setRound = useCallback((round: ActiveTradeRound) => {
    roundRef.current = round;
    sinkRef.current.setActiveRound(round);
  }, []);

  const setStage = useCallback((next: GameStage) => {
    stageRef.current = next;
    sinkRef.current.setStage(next);
  }, []);

  const finalize = useCallback(
    async (outcome: Outcome) => {
      const round = roundRef.current;
      if (!round || resolvingRef.current) return;
      resolvingRef.current = true;
      clearTimers();
      const exitAtMs = markedAtRef.current || Date.now();
      const { setSettlementStep, setSettlementTxHash, setLastResult, setLastRoundSummary } = sinkRef.current;
      setRound({ ...round, exitPrice: round.currentPrice, outcome });
      setSettlementTxHash('');
      setStage('SETTLING');
      await web3Service.runPracticeSettlement((step) => setSettlementStep(step), PRACTICE_SETTLE_MS);
      const result = practiceResult(round, outcome, exitAtMs);
      setLastResult(result);
      setLastRoundSummary({
        pnl: result.pnl,
        direction: result.direction,
        asset: result.asset,
        entryPrice: result.entryPrice,
        exitPrice: result.exitPrice,
        outcome: result.pnl >= 0 ? 'win' : 'loss',
        timestamp: exitAtMs,
      });
      setStage('RESULT');
    },
    [clearTimers, setRound, setStage],
  );

  const impact = useCallback(
    (hit: 'target' | 'stop') => {
      if (resolvingRef.current || beatRef.current !== null) return;
      clearTimers();
      setStage(hit === 'target' ? 'TARGET_HIT' : 'LOSS_HIT');
      beatRef.current = setTimeout(
        () => {
          beatRef.current = null;
          void finalize(hit === 'target' ? 'win' : 'loss');
        },
        hit === 'target' ? IMPACT_BEAT_MS.target : IMPACT_BEAT_MS.stop,
      );
    },
    [clearTimers, finalize, setStage],
  );

  const evaluate = useCallback(
    (price: number, atMs: number) => {
      const round = roundRef.current;
      if (!round) return null;
      const evaluation = SettlementEngine.evaluateLaneTick(round, price, atMs);
      markedAtRef.current = atMs;
      setRound(evaluation.updatedRound);
      sinkRef.current.setTargetProgressPct(evaluation.targetProgressPct);
      return evaluation;
    },
    [setRound],
  );

  const armTimeout = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const round = roundRef.current;
    if (!round || !autoRef.current || stageRef.current !== 'LIVE_TRADE') return;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (stageRef.current === 'LIVE_TRADE') void finalize('timeout');
    }, Math.max(0, roundEndMs(round) - Date.now()));
  }, [finalize]);

  useEffect(() => {
    if (!enabled) return;
    return marketFeed.subscribeRounds((exact) => {
      const round = roundRef.current;
      if (stageRef.current !== 'LIVE_TRADE' || resolvingRef.current || !round || round.asset !== exact.asset) return;
      const evaluation = evaluate(exact.price, exact.tsMs);
      if (!evaluation || !autoRef.current) return;
      if (evaluation.isTargetHit) impact('target');
      else if (evaluation.isLossHit) impact('stop');
    });
  }, [enabled, evaluate, impact]);

  useEffect(() => {
    if (!enabled) return;
    if (autoResolveEnabled && stage === 'LIVE_TRADE') armTimeout();
    else if (!autoResolveEnabled && timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [enabled, autoResolveEnabled, stage, armTimeout]);

  useEffect(() => clearTimers, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    resolvingRef.current = false;
    markedAtRef.current = 0;
  }, [clearTimers]);

  const launch = useCallback(
    (params: PracticeLaunch): boolean => {
      const round = createPracticeRound(params);
      if (!round) return false;
      reset();
      setRound(round);
      sinkRef.current.setTargetProgressPct(0);
      setStage('LAUNCHING');
      return true;
    },
    [reset, setRound, setStage],
  );

  const completeLaunch = useCallback(() => {
    const round = roundRef.current;
    if (!round || stageRef.current !== 'LAUNCHING') return;
    const now = Date.now();
    const entrySec = Math.floor(now / 1000);
    setRound({ ...round, startTime: now, entrySec, endSec: entrySec + round.durationSeconds });
    markedAtRef.current = now;
    setStage('LIVE_TRADE');
  }, [setRound, setStage]);

  const fly = useCallback(
    (params: PracticeLaunch): boolean => {
      const round = createPracticeRound(params);
      if (!round) return false;
      reset();
      markedAtRef.current = Date.now();
      setRound(round);
      sinkRef.current.setTargetProgressPct(0);
      setStage('LIVE_TRADE');
      return true;
    },
    [reset, setRound, setStage],
  );

  const cashOut = useCallback(() => {
    const round = roundRef.current;
    if (!round || stageRef.current !== 'LIVE_TRADE' || resolvingRef.current) return;
    if (round.currentPnl >= 0) sinkRef.current.onCashOutBeat();
    void finalize('cashed_out');
  }, [finalize]);

  const forceBarrier = useCallback(
    (barrier: 'target' | 'stop', fallback: PracticeLaunch) => {
      if (resolvingRef.current) return;
      if (!roundRef.current) {
        const round = createPracticeRound(fallback);
        if (!round) return;
        reset();
        setRound(round);
      }
      const round = roundRef.current;
      if (!round) return;
      evaluate(priceBeyond(round, barrier), Date.now());
      impact(barrier);
    },
    [evaluate, impact, reset, setRound],
  );

  const settleNow = useCallback(
    (outcome: Outcome, fallback: PracticeLaunch) => {
      if (resolvingRef.current) return;
      if (!roundRef.current) {
        const round = createPracticeRound(fallback);
        if (!round) return;
        reset();
        setRound(round);
      }
      const round = roundRef.current;
      if (!round) return;
      if (outcome === 'win') evaluate(priceBeyond(round, 'target'), Date.now());
      void finalize(outcome);
    },
    [evaluate, finalize, reset, setRound],
  );

  return { launch, completeLaunch, fly, cashOut, forceBarrier, settleNow, reset };
}
