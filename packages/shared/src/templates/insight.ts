// PIX pre-trade insight templates (PRD §11). PIX interprets the market; it never
// predicts, never names a side to pick and never promises a result. Sentiment and
// every factor value are computed by the caller.

import type { AssetSymbol } from '../assets.ts';
import type { TemplateFactor } from './debrief.ts';
import { pickVariant } from './format.ts';

export type InsightSentiment = 'bullish' | 'bearish' | 'neutral';
export type VolatilityRegime = 'calm' | 'normal' | 'elevated';

export interface InsightTemplateInput {
  asset: AssetSymbol;
  sentiment: InsightSentiment;
  volatility?: VolatilityRegime | null;
  /** Factors computed in code, most relevant first; at most three are shown. */
  factors?: readonly TemplateFactor[];
  seed?: number;
}

export interface InsightCopy {
  headline: string;
  summary: string;
  sentiment: InsightSentiment;
  factors: TemplateFactor[];
  learningTip: string;
}

const HEADLINES: Record<InsightSentiment, (asset: AssetSymbol) => readonly string[]> = {
  bullish: (a) => ['Momentum is building.', `${a} is pushing higher.`, 'Buyers are leaning in.'],
  bearish: (a) => ['Sellers have the upper hand.', `${a} is drifting lower.`, 'Downward pressure in play.'],
  neutral: () => ['Ranging in a tight channel.', 'No clear direction yet.', 'Balanced order flow.'],
};

function summaryFor(sentiment: InsightSentiment, vol: VolatilityRegime | null | undefined): string {
  switch (sentiment) {
    case 'bullish':
      if (vol === 'elevated') return 'Buying pressure has picked up over the last few minutes, but volatility is elevated.';
      if (vol === 'calm') return 'Buying pressure has picked up over the last few minutes on a fairly calm track.';
      return 'Buying pressure has picked up over the last few minutes, and short-term swings are still active.';
    case 'bearish':
      if (vol === 'elevated') return 'Price has been slipping over the last few minutes and volatility is elevated. Short moves can snap back quickly.';
      return 'Price has been slipping over the last few minutes. Short moves can snap back quickly.';
    case 'neutral':
      if (vol === 'elevated') return 'Order flow looks balanced, with sharp swings in both directions.';
      return 'Order flow looks balanced and price is moving sideways. Quiet stretches can break either way.';
  }
}

const TIPS: Record<InsightSentiment, readonly string[]> = {
  bullish: [
    'Strong momentum can help, but high volatility also increases risk.',
    'Momentum can fade quickly on a 30-second window, so the stop lane is always part of the plan.',
  ],
  bearish: [
    'Downside moves often run faster than climbs, so the stop lane can arrive quickly.',
    'A falling market is not a signal on its own; both directions carry risk.',
  ],
  neutral: [
    'Sideways channels often compress before a bigger move, but direction is never certain.',
    'When the track is flat, small moves decide the round, and it is fine to wait for a clearer read.',
  ],
};

function defaultFactors(sentiment: InsightSentiment, vol: VolatilityRegime | null | undefined): TemplateFactor[] {
  const momentum: TemplateFactor =
    sentiment === 'bullish'
      ? { label: 'Momentum', value: 'Building', positive: true }
      : sentiment === 'bearish'
        ? { label: 'Momentum', value: 'Fading', positive: false }
        : { label: 'Momentum', value: 'Neutral' };
  const out = [momentum];
  if (vol) out.push({ label: 'Volatility', value: vol === 'elevated' ? 'Elevated' : vol === 'calm' ? 'Calm' : 'Normal' });
  return out;
}

export function insightTemplate(input: InsightTemplateInput): InsightCopy {
  const seed = input.seed ?? 0;
  const provided = (input.factors ?? []).slice(0, 3);
  return {
    headline: pickVariant(HEADLINES[input.sentiment](input.asset), seed),
    summary: summaryFor(input.sentiment, input.volatility),
    sentiment: input.sentiment,
    factors: provided.length > 0 ? provided : defaultFactors(input.sentiment, input.volatility),
    learningTip: pickVariant(TIPS[input.sentiment], seed),
  };
}
