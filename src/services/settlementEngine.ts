import { ActiveTradeRound, PositionDirection } from '../types/game';
import { AssetSymbol } from '../types/market';

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
}
