import { AssetSymbol } from './market';

export type GameStage =
  | 'HOME'
  | 'PRE_TRADE'
  | 'LAUNCHING'
  | 'LIVE_TRADE'
  | 'TARGET_HIT'
  | 'LOSS_HIT'
  | 'SETTLING'
  | 'RESULT';

export type PositionDirection = 'LONG' | 'SHORT';

export interface ActiveTradeRound {
  id: string;
  asset: AssetSymbol;
  direction: PositionDirection;
  stake: number; // e.g. 10 USD
  entryPrice: number;
  targetPrice: number; // calculated threshold e.g. +1.2%
  stopLossPrice: number; // calculated stop threshold e.g. -1.0%
  targetPct: number;
  stopLossPct: number;
  startTime: number;
  durationSeconds: number;
  
  // Real-time state
  currentPrice: number;
  currentPnl: number;
  currentMultiplier: number;
  exitPrice?: number;
  outcome?: 'win' | 'loss' | 'cashed_out' | 'timeout';
  settlementTxHash?: string;
}

export interface TradeResult {
  id: string;
  asset: AssetSymbol;
  direction: PositionDirection;
  stake: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  multiplier: number;
  outcome: 'win' | 'loss' | 'cashed_out' | 'timeout';
  timestamp: number;
  txHash: string;
  xpEarned: number;
}

export interface LastRoundSummary {
  pnl: number;
  direction: PositionDirection;
  asset: AssetSymbol;
  entryPrice: number;
  exitPrice: number;
  outcome: 'win' | 'loss';
  timestamp: number;
}

export interface UserProgression {
  level: number;
  title: string;
  currentXp: number;
  nextLevelXp: number;
  dailyRoundsPlayed: number;
  dailyRoundsGoal: number;
  missionCompleted: boolean;
  streakDays?: number;
}

export interface UserSettings {
  reducedMotion: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  useLiveBinance: boolean;
}
