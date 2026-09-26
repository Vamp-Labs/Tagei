// PIX post-trade debrief templates (PRD §24, §28). Seven branches: win, loss,
// timeout±, cash-out±, voided. Every number comes from the caller's computed facts;
// the copy never promises outcomes, never suggests a bigger stake and never frames
// a loss as something to win back.
//
// Label fixes versus the v0.2 prototype (src/services/pixAI.ts):
// - P&L is signed correctly ("+$2.10" / "−$1.60"; the prototype printed "+$-1.60").
// - Timeouts no longer fall into the loss branch ("reversal", "Stop Honored") when they
//   finished ahead, and a stop is only mentioned when a stop was actually touched.
// - Cash-outs that finished behind are no longer described as "locked in gains".
// - Voided rounds get their own branch instead of reading as a loss.
// - No fabricated figures ("+38% above avg", "Optimal" entry) and no win-rate talk.

import type { InsightFactorSchema } from '../dto.ts';
import type { AssetSymbol } from '../assets.ts';
import type { DirectionLabel, OutcomeLabel, VoidReasonLabel } from '../enums.ts';
import type { z } from 'zod';
import { formatPrice18, formatUsd18, pickVariant, sharePct } from './format.ts';

export type TemplateFactor = z.infer<typeof InsightFactorSchema>;

export type DebriefBranch = 'win' | 'loss' | 'timeout_gain' | 'timeout_loss' | 'cashout_gain' | 'cashout_loss' | 'voided';

export const DEBRIEF_BRANCHES: readonly DebriefBranch[] = [
  'win',
  'loss',
  'timeout_gain',
  'timeout_loss',
  'cashout_gain',
  'cashout_loss',
  'voided',
];

export function debriefBranch(outcome: OutcomeLabel, pnl18: bigint): DebriefBranch {
  switch (outcome) {
    case 'win':
      return 'win';
    case 'loss':
      return 'loss';
    case 'voided':
      return 'voided';
    case 'timeout':
      return pnl18 >= 0n ? 'timeout_gain' : 'timeout_loss';
    case 'cashed_out':
      return pnl18 >= 0n ? 'cashout_gain' : 'cashout_loss';
  }
}

export interface DebriefTemplateInput {
  asset: AssetSymbol;
  direction: DirectionLabel;
  outcome: OutcomeLabel;
  /** 18-decimal tUSD. */
  stake: bigint;
  payout: bigint;
  entryPrice?: bigint | null;
  exitPrice?: bigint | null;
  displayDecimals?: number;
  /** decisionSec − entrySec. */
  elapsedSec?: number | null;
  durationSec?: number | null;
  voidReason?: VoidReasonLabel | null;
  /** Factors computed in code, most relevant first; at most three are shown. */
  factors?: readonly TemplateFactor[];
  /** Variant seed (e.g. the round id) so a round always reads the same way. */
  seed?: number;
}

export interface DebriefCopy {
  headline: string;
  analysis: string;
  keyFactors: TemplateFactor[];
  coachingTip: string;
}

const HEADLINES: Record<Exclude<DebriefBranch, 'win'>, readonly string[]> & { win: Record<DirectionLabel, readonly string[]> } = {
  win: {
    LONG: ['Nice read — target reached.', 'Clean climb to the target.', 'Momentum carried you home.'],
    SHORT: ['Sharp downside read.', 'Clean drop to the target.', 'The slide carried you home.'],
  },
  loss: ['The market turned on this one.', 'Stop reached — round complete.', 'A reversal after your entry.'],
  timeout_gain: ['Time up — finished ahead.', 'A steady drift your way.', 'Round complete in the green.'],
  timeout_loss: ['Time up — finished slightly behind.', 'A choppy round, small give-back.', 'Round complete, a little short.'],
  cashout_gain: ['Gain secured with a cash-out.', 'Smart exit — gain locked.', 'You banked it early.'],
  cashout_loss: ['Loss trimmed with a cash-out.', 'An early exit limited the damage.', 'Exit taken before the stop.'],
  voided: ['Round voided — stake returned.'],
};

const TIPS: Record<DebriefBranch, readonly string[]> = {
  win: [
    'Strong momentum can help, but high volatility also increases risk.',
    'A target locks the result the moment a recorded checkpoint touches it, so there is no exit to time.',
    'Every round starts fresh, so read the track again before the next launch.',
  ],
  loss: [
    'Reversals right after entry are common on short windows; the last minute of momentum helps you read the track.',
    'Losses are part of reading markets. Take a breath before the next round; there is nothing to chase.',
    'Fast stop touches often come with a volatility spike, and calmer tracks give a read more time to play out.',
  ],
  timeout_gain: [
    'Not every round needs a target hit; a steady drift your way still pays at the final price.',
    'Rounds that end between the lanes pay in proportion to the move, so small drifts mean small results.',
  ],
  timeout_loss: [
    'Choppy rounds tend to end near the entry, and the lane fee means a flat finish lands just under your stake.',
    'Sideways markets are hard to read, and sitting out a round is always an option.',
  ],
  cashout_gain: [
    'Locking in a gain early trades extra upside for certainty, a solid habit when momentum starts to stall.',
    'Exits settle at a recorded checkpoint about two seconds after you commit, so the final figure can differ slightly from the snapshot.',
  ],
  cashout_loss: [
    'Cutting a losing position early is risk control, not failure.',
    'When the track turns against you, a planned exit keeps each round small and repeatable.',
  ],
  voided: ['Voids are rare; they protect you whenever the price path cannot be verified on chain.'],
};

const inClause = (elapsedSec: number | null | undefined): string =>
  elapsedSec !== null && elapsedSec !== undefined && elapsedSec > 0 ? ` ${Math.round(elapsedSec)}s in` : '';

function voidAnalysis(reason: VoidReasonLabel | null | undefined): string {
  switch (reason) {
    case 'entry_invalid':
      return 'The entry checkpoint could not be verified, so the round was voided and your full stake was returned. It does not count as a loss.';
    case 'terminal_invalid':
      return 'The final checkpoint failed validation, so the round was voided and your full stake was returned. It does not count as a loss.';
    default:
      return 'Oracle data for this round was incomplete, so it was voided and your full stake was returned. It does not count as a loss.';
  }
}

function analysisFor(branch: DebriefBranch, i: DebriefTemplateInput): string {
  const up = i.direction === 'LONG';
  const pnl = formatUsd18(i.payout - i.stake, { signed: true });
  const at = inClause(i.elapsedSec);
  switch (branch) {
    case 'win':
      return `${i.asset} ${up ? 'climbed' : 'slid'} after your entry and a recorded checkpoint crossed your target${at}. The round settled at the full lane payout for ${pnl}.`;
    case 'loss':
      return `${i.asset} ${up ? 'slid' : 'rose'} against your ${i.direction} after entry and a recorded checkpoint reached the stop${at}. The loss stayed limited to your stake.`;
    case 'timeout_gain':
      return `${i.asset} drifted your way without reaching the target, so the round settled at the final recorded price for ${pnl}.`;
    case 'timeout_loss':
      return `${i.asset} leaned against your ${i.direction} without reaching the stop, so the round settled at the final recorded price for ${pnl}.`;
    case 'cashout_gain': {
      const when =
        i.elapsedSec && i.durationSec ? ` ${Math.round(i.elapsedSec)}s into the ${Math.round(i.durationSec)}s round` : ' early';
      return `You cashed out${when} and the exit checkpoint locked ${pnl}.`;
    }
    case 'cashout_loss':
      return `You exited${at || ' early'} and kept ${sharePct(i.payout, i.stake)}% of your stake instead of riding the move to the stop.`;
    case 'voided':
      return voidAnalysis(i.voidReason);
  }
}

function defaultFactors(branch: DebriefBranch, i: DebriefTemplateInput): TemplateFactor[] {
  const out: TemplateFactor[] = [];
  const secs = i.elapsedSec !== null && i.elapsedSec !== undefined && i.elapsedSec > 0 ? `${Math.round(i.elapsedSec)}s` : null;
  const pnl18 = i.payout - i.stake;
  switch (branch) {
    case 'win':
      if (secs) out.push({ label: 'Time to target', value: secs, positive: true });
      break;
    case 'loss':
      if (secs) out.push({ label: 'Time to stop', value: secs, positive: false });
      out.push({ label: 'Risk limit', value: 'Capped at stake' });
      break;
    case 'timeout_gain':
    case 'timeout_loss':
      out.push({ label: 'Result', value: formatUsd18(pnl18, { signed: true }), positive: pnl18 >= 0n });
      break;
    case 'cashout_gain':
      out.push({ label: 'Secured', value: formatUsd18(pnl18, { signed: true }), positive: true });
      if (secs) out.push({ label: 'Exit timing', value: i.durationSec ? `${secs} of ${Math.round(i.durationSec)}s` : secs });
      break;
    case 'cashout_loss':
      out.push({ label: 'Stake kept', value: `${sharePct(i.payout, i.stake)}%` });
      if (secs) out.push({ label: 'Exit timing', value: i.durationSec ? `${secs} of ${Math.round(i.durationSec)}s` : secs });
      break;
    case 'voided':
      out.push({ label: 'Stake', value: 'Returned in full', positive: true });
      return out;
  }
  const dp = i.displayDecimals ?? 2;
  if (i.entryPrice && out.length < 3) out.push({ label: 'Entry', value: formatPrice18(i.entryPrice, dp) });
  if (i.exitPrice && out.length < 3) out.push({ label: 'Exit', value: formatPrice18(i.exitPrice, dp) });
  return out;
}

export function debriefTemplate(input: DebriefTemplateInput): DebriefCopy {
  const branch = debriefBranch(input.outcome, input.payout - input.stake);
  const seed = input.seed ?? 0;
  const headline =
    branch === 'win' ? pickVariant(HEADLINES.win[input.direction], seed) : pickVariant(HEADLINES[branch], seed);
  const provided = (input.factors ?? []).slice(0, 3);
  return {
    headline,
    analysis: analysisFor(branch, input),
    keyFactors: provided.length > 0 ? provided : defaultFactors(branch, input),
    coachingTip: pickVariant(TIPS[branch], seed),
  };
}
