import type { GameStage, PositionDirection } from '../../types/game';
import { HAPPY_PNL, NEAR_STOP_FX_PNL } from './mood';

export type PixExpression =
  | 'idle'
  | 'ready'
  | 'happy'
  | 'alert'
  | 'celebrate'
  | 'concerned'
  | 'loading'
  | 'thinking'
  | 'wave';

export interface PixExpressionInput {
  gameStage: GameStage;
  targetProgressPct: number;
  fxPnl: number;
  selectedDirection: PositionDirection | null;
}

export const pixExpressionFor = ({ gameStage, fxPnl, selectedDirection }: PixExpressionInput): PixExpression => {
  if (gameStage === 'TARGET_HIT') return 'celebrate';
  if (gameStage === 'LOSS_HIT') return 'concerned';
  if (gameStage === 'SETTLING') return 'loading';
  if (gameStage === 'RESULT') return fxPnl >= 0 ? 'celebrate' : 'concerned';
  if (gameStage === 'LIVE_TRADE') {
    if (fxPnl <= NEAR_STOP_FX_PNL) return 'alert';
    if (fxPnl >= HAPPY_PNL) return 'happy';
    return 'idle';
  }
  if (gameStage === 'PRE_TRADE' && selectedDirection) return 'ready';
  return 'idle';
};
