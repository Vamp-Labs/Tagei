// Result labels (F1c §Copy rules) and default factor labels. The outcome decides the
// title and P&L only decides the sign, so a profitable timeout or cash-out never
// claims a target hit that did not happen.

import type { OutcomeLabel } from '../enums.ts';
import type { FactorKey } from '../pix.ts';
import { formatUsd18 } from './format.ts';

export interface ResultLabel {
  title: 'TARGET HIT' | 'ROUND COMPLETE' | 'ROUND VOIDED';
  /** `WIN +$x`, `±$x` or `$0.00` for a void. */
  amount: string;
  subtitle: string | null;
  tone: 'win' | 'gain' | 'loss' | 'void';
}

export function resultLabel(outcome: OutcomeLabel, pnl18: bigint): ResultLabel {
  const signed = formatUsd18(pnl18, { signed: true });
  switch (outcome) {
    case 'win':
      return { title: 'TARGET HIT', amount: `WIN ${signed}`, subtitle: null, tone: 'win' };
    case 'loss':
      return { title: 'ROUND COMPLETE', amount: signed, subtitle: null, tone: 'loss' };
    case 'timeout':
      return { title: 'ROUND COMPLETE', amount: signed, subtitle: 'TIME UP', tone: pnl18 >= 0n ? 'gain' : 'loss' };
    case 'cashed_out':
      return { title: 'ROUND COMPLETE', amount: signed, subtitle: 'CASHED OUT', tone: pnl18 >= 0n ? 'gain' : 'loss' };
    case 'voided':
      return { title: 'ROUND VOIDED', amount: '$0.00', subtitle: 'Oracle data was incomplete. Your stake was returned.', tone: 'void' };
  }
}

export const FACTOR_LABELS: Record<FactorKey, string> = {
  momentum_1m: '1m momentum',
  momentum_5m: '5m momentum',
  volume_spike: 'Volume',
  buy_pressure: 'Buy pressure',
  volatility: 'Volatility',
  range_position: '24h range',
  lane_reach: 'Target distance',
  change_24h: '24h change',
  entry_timing: 'Entry timing',
  time_to_touch: 'Time to touch',
  exit_choice: 'Exit timing',
  stop_honored: 'Risk limit',
  secured_gain: 'Secured',
};
