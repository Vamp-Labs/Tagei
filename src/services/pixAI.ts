import { guardrailViolations, PIX_DISCLAIMER } from '@bnbplay/shared/pix';
import type { DebriefDTO, MarketInsightDTO } from '@bnbplay/shared/dto';
import { AssetSymbol, MarketInsight } from '../types/market';
import { TradeResult } from '../types/game';
import { apiClient } from '../api/runtime';
import type { ApiClient } from '../api/client';
import type { PixChatMessage } from '../api/schemas';

export type PixSource = 'llm' | 'template';

export interface PixDebrief {
  headline: string;
  analysis: string;
  keyFactors: { label: string; value: string; positive?: boolean }[];
  coachingTip: string;
}

export type PixInsightResult = MarketInsight & { source: PixSource };
export type PixDebriefResult = PixDebrief & { source: PixSource };

export type PixApi = Pick<ApiClient, 'isEnabled' | 'pixInsight' | 'pixDebrief' | 'pixChat'>;

export { PIX_DISCLAIMER };

const isSafe = (...texts: string[]): boolean => texts.every((text) => guardrailViolations(text).length === 0);

const insightIsSafe = (insight: MarketInsightDTO): boolean =>
  isSafe(insight.headline, insight.summary, insight.learningTip, ...insight.factors.map((factor) => `${factor.label} ${factor.value}`));

const debriefIsSafe = (debrief: DebriefDTO): boolean =>
  isSafe(debrief.headline, debrief.analysis, debrief.coachingTip, ...debrief.keyFactors.map((factor) => `${factor.label} ${factor.value}`));

export class PixAIService {
  public static async fetchInsight(
    asset: AssetSymbol,
    change24h: number,
    options: { tier?: number; api?: PixApi } = {}
  ): Promise<PixInsightResult> {
    const api = options.api ?? apiClient;
    if (api.isEnabled()) {
      try {
        const insight = await api.pixInsight(asset, options.tier);
        if (insightIsSafe(insight)) {
          return {
            headline: insight.headline,
            summary: insight.summary,
            sentiment: insight.sentiment,
            factors: insight.factors,
            learningTip: insight.learningTip,
            source: insight.source,
          };
        }
      } catch {
        return { ...PixAIService.getPreTradeInsight(asset, change24h), source: 'template' };
      }
    }
    return { ...PixAIService.getPreTradeInsight(asset, change24h), source: 'template' };
  }

  public static async fetchDebrief(result: TradeResult, options: { api?: PixApi } = {}): Promise<PixDebriefResult> {
    const api = options.api ?? apiClient;
    if (result.mode === 'live' && result.roundId && api.isEnabled()) {
      try {
        const debrief = await api.pixDebrief(result.roundId);
        if (debriefIsSafe(debrief)) return { ...debrief, source: debrief.source };
      } catch {
        return { ...PixAIService.getPostTradeDebrief(result), source: 'template' };
      }
    }
    return { ...PixAIService.getPostTradeDebrief(result), source: 'template' };
  }

  public static async chat(
    messages: readonly PixChatMessage[],
    context: { asset: AssetSymbol; change24h: number },
    onDelta: (text: string) => void,
    options: { api?: PixApi; signal?: AbortSignal } = {}
  ): Promise<{ text: string; source: PixSource }> {
    const api = options.api ?? apiClient;
    const fallback = () => {
      const insight = PixAIService.getPreTradeInsight(context.asset, context.change24h);
      const text = `${insight.headline}. ${insight.summary}`;
      onDelta(text);
      return { text, source: 'template' as const };
    };
    if (!api.isEnabled()) return fallback();
    let text = '';
    try {
      for await (const event of api.pixChat(messages, options.signal)) {
        if (event.type === 'pix.delta') {
          text += event.text;
          onDelta(event.text);
        } else if (event.type === 'pix.error') {
          return text ? { text, source: 'llm' } : fallback();
        } else {
          break;
        }
      }
    } catch {
      return text ? { text, source: 'llm' } : fallback();
    }
    return text ? { text, source: 'llm' } : fallback();
  }

  /**
   * Generates real-time pre-trade market context without false guarantees
   * PRD Section 11
   */
  public static getPreTradeInsight(asset: AssetSymbol, change24h: number): MarketInsight {
    const isBullish = change24h > 0.5;
    const isBearish = change24h < -0.5;

    if (isBullish) {
      return {
        headline: `${asset} Momentum Building`,
        summary: `${asset} buying volume has surged over recent intervals. Upward pressure is noticeable, but short-term volatility remains active.`,
        sentiment: 'bullish',
        factors: [
          { label: 'Buy Pressure', value: 'High', positive: true },
          { label: 'Volume Spike', value: `+${(Math.abs(change24h) * 12 + 14).toFixed(0)}%`, positive: true },
          { label: 'Volatility', value: 'Moderate', positive: undefined },
        ],
        learningTip: 'Riding upward momentum requires watching for sudden liquidity pullbacks.',
      };
    } else if (isBearish) {
      return {
        headline: 'Consolidation & Selling Pressure',
        summary: `Sellers have tested lower liquidity bands. Downward drift is dominant across the short window.`,
        sentiment: 'bearish',
        factors: [
          { label: 'Sell Flow', value: 'Dominant', positive: false },
          { label: 'Order Velocity', value: 'Fast', positive: undefined },
          { label: 'Volatility', value: 'Elevated', positive: false },
        ],
        learningTip: 'Downside moves often accelerate faster than upward grinds due to cascade liquidations.',
      };
    } else {
      return {
        headline: 'Ranging in Tight Channel',
        summary: `Order flow is balanced around support. The market track is oscillating sideways awaiting a directional catalyst.`,
        sentiment: 'neutral',
        factors: [
          { label: 'Momentum', value: 'Neutral', positive: undefined },
          { label: 'Spread', value: 'Tight', positive: true },
          { label: 'Breakout Risk', value: 'Pending', positive: undefined },
        ],
        learningTip: 'Sideways channels often compress before sharp directional expansions.',
      };
    }
  }

  /**
   * Generates post-trade coaching review
   * PRD Section 28
   */
  public static getPostTradeDebrief(result: TradeResult): {
    headline: string;
    analysis: string;
    keyFactors: { label: string; value: string; positive?: boolean }[];
    coachingTip: string;
  } {
    const isWin = result.outcome === 'win';
    const isShort = result.direction === 'SHORT';

    if (isWin) {
      return {
        headline: isShort ? 'Sharp Downside Read!' : 'Target Achieved — Flawless Execution',
        analysis: isShort
          ? `You anticipated the selling cascade accurately. Downward momentum breached the target lane swiftly.`
          : `Strong accumulation continued post-entry. Buying pressure carried the rocket through the target threshold cleanly.`,
        keyFactors: [
          { label: 'Entry Precision', value: 'Optimal', positive: true },
          { label: 'Volume Alignment', value: '+38% above avg', positive: true },
          { label: 'P&L Velocity', value: `+$${result.pnl.toFixed(2)}`, positive: true },
        ],
        coachingTip: `Taking profits methodically when targets are hit preserves your win rate long term.`,
      };
    } else if (result.outcome === 'cashed_out') {
      return {
        headline: 'Tactical Cash Out',
        analysis: `You manually locked in gains before the round expired or reversed. Prudent risk management.`,
        keyFactors: [
          { label: 'Execution', value: 'Manual Exit', positive: true },
          { label: 'Secured P&L', value: `+$${result.pnl.toFixed(2)}`, positive: true },
          { label: 'Time Remaining', value: 'Protected', positive: true },
        ],
        coachingTip: 'Discretionary early exits can help protect capital when momentum begins to stall.',
      };
    } else {
      return {
        headline: 'Market Resistance & Reversal',
        analysis: `The market rotated against your position shortly after entry. Counter-trend order flow overwhelmed the direction.`,
        keyFactors: [
          { label: 'Momentum Shift', value: 'Opposing Flow', positive: false },
          { label: 'Volatility Spike', value: 'High', positive: false },
          { label: 'Risk Control', value: 'Stop Honored', positive: true },
        ],
        coachingTip: `Drawdowns are an inevitable reality of dynamic markets. Never chase losses with automatic size increases.`,
      };
    }
  }
}
