// PIX chat fallback: deterministic, sentence-by-sentence answers used when the LLM
// is disabled, over budget or failing. Direction questions get an honest "nobody can
// call it" plus the current read; nothing here suggests a side, a stake or a way to
// make back a loss.

import type { AssetSymbol } from '../assets.ts';
import type { TemplateFactor } from './debrief.ts';

export type ChatTopic =
  | 'direction'
  | 'responsible'
  | 'levels'
  | 'cashout'
  | 'oracle'
  | 'progression'
  | 'payout'
  | 'chart'
  | 'trend'
  | 'greeting'
  | 'unknown';

// Order matters: the first matching topic wins.
const TOPICS: readonly [ChatTopic, RegExp][] = [
  ['responsible', /\b(losing|lost|chase|chasing|tilt\w*|upset|frustrat\w*|make (it )?back|win (it )?back|recover\w*)\b/i],
  ['direction', /\b(long|short|buy|sell|pump|dump|moon|predict\w*|forecast|will (it|bnb|btc|eth|sol|doge|price)|should i|good time|next move|which way|go up|go down)\b/i],
  ['levels', /\b(support|resistance|levels?|range|24h high|24h low)\b/i],
  ['cashout', /\b(cash[- ]?out|exit|close (my|the) (round|position))\b/i],
  ['oracle', /\b(oracle|supra|price feed|fair|rigged|on[- ]chain|settle\w*|proof|verify)\b/i],
  ['progression', /\b(xp|level|mission|badge|streak|leaderboard|rank|title)\b/i],
  ['payout', /\b(payout|multiplier|fee|pay|target|stop|loss|lane|tier|cruise|boost|hyper|warp)\b/i],
  ['chart', /\b(chart|track|line|rocket|explain|how does|how do)\b/i],
  ['trend', /\b(trend|momentum|market|doing|happening|moving|sentiment|volatil\w*|now|today)\b/i],
  ['greeting', /\b(hi|hello|hey|who are you|what are you|help)\b/i],
];

export function chatTopic(question: string): ChatTopic {
  for (const [topic, re] of TOPICS) if (re.test(question)) return topic;
  return 'unknown';
}

export interface ChatTemplateInput {
  question: string;
  asset?: AssetSymbol;
  /** The current (template or cached) insight for `asset`, if any. */
  insight?: { headline: string; summary: string } | null;
  /** Factors computed in code for `asset`, most relevant first. */
  factors?: readonly TemplateFactor[];
}

const factorLine = (factors: readonly TemplateFactor[]): string | null =>
  factors.length === 0 ? null : `Key factors: ${factors.slice(0, 3).map((f) => `${f.label} ${f.value}`).join(', ')}.`;

/** The answer as whole sentences, ready to stream one by one. */
export function chatTemplate(input: ChatTemplateInput): string[] {
  const asset = input.asset ?? 'the market';
  const factors = input.factors ?? [];
  const read = input.insight ? `Right now on ${asset}: ${input.insight.summary}` : null;
  switch (chatTopic(input.question)) {
    case 'direction':
      return [
        'I can’t call where the price goes next, and nobody can on a 30-second window.',
        read ?? 'I can walk you through what the track is showing instead.',
        'Pick the side that matches your own read; both directions carry risk.',
      ];
    case 'responsible':
      return [
        'Rough rounds are part of reading any market, and they say nothing about the next one.',
        'It is always fine to take a break. PIX will be here when you are back.',
      ];
    case 'levels': {
      const range = factors.find((f) => f.label === '24h range');
      return [
        'I don’t draw support lines, but the 24-hour range is a useful frame.',
        range ? `Where ${asset} sits in its 24-hour range: ${range.value}.` : 'Check where the price sits between today’s high and low before you launch.',
      ];
    }
    case 'cashout':
      return [
        'Cash Out asks the arena to settle your round at a checkpoint about two seconds after you commit.',
        'The payout follows how far price has moved toward your target or stop at that second, minus the lane fee.',
        'If the round is almost over, a cash-out can be too late, and the round settles at the final price instead.',
      ];
    case 'oracle':
      return [
        'Prices come from Supra’s DORA-2 oracle, and every second of an active round is recorded on BNB Chain.',
        'Settlement replays that recorded path, so nobody, including us, can pick the price.',
        'If the data for a round can’t be verified, the round is voided and your stake comes back.',
      ];
    case 'progression':
      return [
        'Every live flight earns XP, with bonuses for target hits, disciplined exits and reviewing your debrief.',
        'Daily missions and streaks add more, and XP never depends on how much you stake.',
      ];
    case 'payout':
      return [
        'Each lane has a target and a stop measured from your entry price.',
        'Touching the target pays the lane multiplier, and touching the stop ends the round at zero.',
        'If time runs out between the two, the payout scales with how far price moved, minus a small fee.',
      ];
    case 'chart':
      return [
        'The Market Track draws the live oracle price, one recorded second at a time.',
        'At launch your entry locks a few seconds ahead, and the target and stop lanes are fixed from that price.',
        'The first lane a recorded checkpoint touches decides the round; if neither is touched, it settles at the final price.',
      ];
    case 'trend': {
      if (!input.insight) return ['I don’t have a fresh read on that market yet.', 'Give it a few seconds and ask again.'];
      const line = factorLine(factors);
      return [input.insight.headline, input.insight.summary, ...(line ? [line] : [])];
    }
    case 'greeting':
      return [
        'Hey, I’m PIX, your co-pilot on the Market Track.',
        'Ask me what the market is doing, how lanes and cash-outs work, or how settlement stays fair.',
      ];
    case 'unknown':
      return [
        'I’m best at explaining the Market Track: momentum, volatility, lanes, cash-outs and settlement.',
        'Try asking what the market is doing right now.',
      ];
  }
}
