import type { Dispatch, SetStateAction } from 'react';
import type { SettlementStep } from '../services/web3Service';
import type {
  ActiveTradeRound,
  GameStage,
  LastRoundSummary,
  PositionDirection,
  TradeResult,
  UserProgression,
  UserSettings,
} from '../types/game';
import type { AssetSymbol } from '../types/market';

type Setter<T> = Dispatch<SetStateAction<T>>;

export type DevSheet = 'none' | 'menu' | 'asset-selector' | 'pix-chat' | 'position-details' | 'leaderboard';

export interface DevSceneContext {
  setStage: Setter<GameStage>;
  setCurrentAsset: Setter<AssetSymbol>;
  setSelectedDirection: Setter<PositionDirection | null>;
  setActiveRound: Setter<ActiveTradeRound | null>;
  setTargetProgressPct: Setter<number>;
  setJustLeveledUp: Setter<boolean>;
  setSettlementStep: Setter<SettlementStep>;
  setSettlementTxHash: Setter<string>;
  setLastResult: Setter<TradeResult | null>;
  setLastRoundSummary: Setter<LastRoundSummary | null>;
  setProgression: Setter<UserProgression>;
  setIsSettingsOpen: Setter<boolean>;
  setIsProfileOpen: Setter<boolean>;
  setIsMissionToastOpen: Setter<boolean>;
  setSettings: Setter<UserSettings>;
  setActiveSheet: Setter<DevSheet>;
  handleConnectWallet: () => Promise<void>;
  handlePlayNow: () => void;
}

export interface DevSceneParams {
  name: string;
  freeze: boolean;
  rm: boolean;
  sim: boolean;
  fx: boolean;
  dir: PositionDirection | null;
  asset: AssetSymbol | null;
  delta: number | null;
  step: SettlementStep | null;
  seed: number;
}

export interface DevSceneState {
  active: boolean;
  sim: boolean;
}

export interface SceneEntry {
  id: string;
  name: string;
  owners: string[];
  settleMs: number;
  height?: number;
}

export interface SceneReport {
  name: string;
  fontsOk: boolean;
  errors: string[];
}

declare global {
  interface Window {
    __scene?: SceneReport;
    __settleStep?: (step: SettlementStep) => void;
  }
}
