import { Direction } from '@bnbplay/shared/enums';
import { barrierPrices, maxPayout } from '@bnbplay/shared/lane';
import type { RoundTerms } from '@bnbplay/shared/path';
import { ActiveTradeRound, PositionDirection } from '../types/game';
import { AssetSymbol } from '../types/market';
import { practiceLane, type PracticeLane } from '../game/lanes';
import { markRound, type RoundMark } from '../game/roundMath';
import { fromPrice18, roundCents, stake18ToUsd, toPrice18, usdToStake18 } from '../game/units';

export interface SettlementConfig {
  targetThresholdPct: number; // e.g. 1.2%
  stopLossThresholdPct: number; // e.g. 1.0%
  multiplierLeverage: number; // e.g. 15x game amplifier for thrilling gameplay
  durationSeconds: number; // e.g. 20s
}

export const DEFAULT_CONFIG: SettlementConfig = {
  targetThresholdPct: 1.2,
  stopLossThresholdPct: 0.9,
  multiplierLeverage: 18.0,
  durationSeconds: 20,
};

export class SettlementEngine {
  /**
   * Initializes a new trade round from exact raw market price
   */
  public static initRound(
    asset: AssetSymbol,
    direction: PositionDirection,
    stake: number,
    exactRawPrice: number,
    config: SettlementConfig = DEFAULT_CONFIG
  ): ActiveTradeRound {
    const id = `round_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const targetOffset = exactRawPrice * (config.targetThresholdPct / 100);
    const stopLossOffset = exactRawPrice * (config.stopLossThresholdPct / 100);

    const targetPrice = direction === 'LONG'
      ? exactRawPrice + targetOffset
      : exactRawPrice - targetOffset;

    const stopLossPrice = direction === 'LONG'
      ? exactRawPrice - stopLossOffset
      : exactRawPrice + stopLossOffset;

    return {
      id,
      asset,
      direction,
      stake,
      entryPrice: exactRawPrice,
      targetPrice,
      stopLossPrice,
      targetPct: config.targetThresholdPct,
      stopLossPct: config.stopLossThresholdPct,
      startTime: now,
      durationSeconds: config.durationSeconds,
      currentPrice: exactRawPrice,
      currentPnl: 0,
      currentMultiplier: 1.0,
    };
  }

  /**
   * Calculates P&L and checks trigger conditions using RAW market price
   * PRD Section 37: Data Integrity
   */
  public static evaluateTick(
    round: ActiveTradeRound,
    exactRawPrice: number,
    config: SettlementConfig = DEFAULT_CONFIG
  ): {
    updatedRound: ActiveTradeRound;
    isTargetHit: boolean;
    isLossHit: boolean;
    targetProgressPct: number; // 0 to 100%
  } {
    const { direction, entryPrice, targetPrice, stopLossPrice, stake } = round;
    
    // Exact price percentage change relative to entry
    const priceChangePct = ((exactRawPrice - entryPrice) / entryPrice) * 100;
    
    // Directional return
    const directionalPct = direction === 'LONG' ? priceChangePct : -priceChangePct;

    // Amplified P&L
    const rawPnl = stake * (directionalPct / 100) * config.multiplierLeverage;
    // Cap max loss at stake
    const currentPnl = Math.max(-stake, rawPnl);
    const currentMultiplier = (stake + currentPnl) / stake;

    // Calculate progress towards target (0.0 to 1.0+)
    let targetProgressPct = 0;
    if (direction === 'LONG') {
      const totalSpan = targetPrice - entryPrice;
      const currentDelta = exactRawPrice - entryPrice;
      targetProgressPct = Math.max(0, Math.min(1.2, currentDelta / totalSpan)) * 100;
    } else {
      const totalSpan = entryPrice - targetPrice;
      const currentDelta = entryPrice - exactRawPrice;
      targetProgressPct = Math.max(0, Math.min(1.2, currentDelta / totalSpan)) * 100;
    }

    // Condition evaluations
    let isTargetHit = false;
    let isLossHit = false;

    if (direction === 'LONG') {
      if (exactRawPrice >= targetPrice) {
        isTargetHit = true;
      } else if (exactRawPrice <= stopLossPrice) {
        isLossHit = true;
      }
    } else {
      // SHORT
      if (exactRawPrice <= targetPrice) {
        isTargetHit = true;
      } else if (exactRawPrice >= stopLossPrice) {
        isLossHit = true;
      }
    }

    const updatedRound: ActiveTradeRound = {
      ...round,
      currentPrice: exactRawPrice,
      currentPnl: Math.round(currentPnl * 100) / 100,
      currentMultiplier: Math.max(0, Math.round(currentMultiplier * 100) / 100),
    };

    return {
      updatedRound,
      isTargetHit,
      isLossHit,
      targetProgressPct,
    };
  }

  public static practiceLane(asset: AssetSymbol, tier = 0): PracticeLane | null {
    return practiceLane(asset, tier);
  }

  public static initLaneRound(
    asset: AssetSymbol,
    direction: PositionDirection,
    stake: number,
    exactRawPrice: number,
    lane: PracticeLane,
    now: number = Date.now()
  ): ActiveTradeRound {
    const stake18 = usdToStake18(stake);
    const entry18 = toPrice18(exactRawPrice);
    const side = direction === 'LONG' ? Direction.Long : Direction.Short;
    const barriers = barrierPrices(side, entry18, lane.targetPpm, lane.stopPpm);
    const max18 = maxPayout(stake18, lane.multiplierBps);
    const entrySec = Math.floor(now / 1000);
    return {
      id: `practice_${now}_${Math.random().toString(36).substring(2, 7)}`,
      asset,
      direction,
      stake,
      entryPrice: exactRawPrice,
      targetPrice: fromPrice18(barriers.target),
      stopLossPrice: fromPrice18(barriers.stop),
      targetPct: lane.targetPpm / 10_000,
      stopLossPct: lane.stopPpm / 10_000,
      startTime: now,
      durationSeconds: lane.durationSec,
      currentPrice: exactRawPrice,
      currentPnl: 0,
      currentMultiplier: 1.0,
      mode: 'practice',
      tier: lane.tier,
      tierLabel: lane.label,
      multiplierBps: lane.multiplierBps,
      feeBps: lane.feeBps,
      targetPpm: lane.targetPpm,
      stopPpm: lane.stopPpm,
      maxPayout: stake18ToUsd(max18),
      entrySec,
      endSec: entrySec + lane.durationSec,
    };
  }

  public static laneTerms(round: ActiveTradeRound): RoundTerms | null {
    const { targetPpm, stopPpm, multiplierBps, feeBps, entrySec, endSec } = round;
    if (targetPpm === undefined || stopPpm === undefined || multiplierBps === undefined || feeBps === undefined) return null;
    const stake = usdToStake18(round.stake);
    const start = entrySec ?? Math.floor(round.startTime / 1000);
    return {
      direction: round.direction === 'LONG' ? Direction.Long : Direction.Short,
      stake,
      maxPayout: maxPayout(stake, multiplierBps),
      entrySec: start,
      endSec: endSec ?? start + round.durationSeconds,
      targetPpm,
      stopPpm,
      multiplierBps,
      feeBps,
      maxJumpPpm: 1_000_000,
      cashOutRequested: false,
    };
  }

  public static evaluateLaneTick(
    round: ActiveTradeRound,
    exactRawPrice: number,
    now: number = Date.now()
  ): {
    updatedRound: ActiveTradeRound;
    isTargetHit: boolean;
    isLossHit: boolean;
    targetProgressPct: number;
    mark: RoundMark | null;
  } {
    const terms = SettlementEngine.laneTerms(round);
    if (!terms) {
      return { ...SettlementEngine.evaluateTick(round, exactRawPrice), mark: null };
    }
    const mark = markRound(terms, toPrice18(round.entryPrice), toPrice18(exactRawPrice), Math.floor(now / 1000));
    return {
      updatedRound: {
        ...round,
        currentPrice: exactRawPrice,
        currentPnl: mark.pnl,
        currentMultiplier: Math.max(0, roundCents(mark.multiple)),
      },
      isTargetHit: mark.touch === 'target',
      isLossHit: mark.touch === 'stop',
      targetProgressPct: mark.progressPct,
      mark,
    };
  }

  public static markLive(terms: RoundTerms, entryPrice18: bigint, price18: bigint, sec: number): RoundMark {
    return markRound(terms, entryPrice18, price18, sec);
  }
}
