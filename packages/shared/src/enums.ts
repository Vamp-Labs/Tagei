// Numeric values match the Solidity enums exactly (F1a).

export const Direction = { Long: 0, Short: 1 } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const RoundStatus = { None: 0, Open: 1, Settled: 2 } as const;
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus];

export const Outcome = { None: 0, TargetHit: 1, StopHit: 2, Timeout: 3, CashedOut: 4, Voided: 5 } as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export const VoidReason = { None: 0, EntryInvalid: 1, TerminalInvalid: 2, CheckpointGap: 3, Stalled: 4 } as const;
export type VoidReason = (typeof VoidReason)[keyof typeof VoidReason];

export type DirectionLabel = 'LONG' | 'SHORT';
export type OutcomeLabel = 'win' | 'loss' | 'timeout' | 'cashed_out' | 'voided';
export type VoidReasonLabel = 'entry_invalid' | 'terminal_invalid' | 'checkpoint_gap' | 'stalled';

export const directionLabel = (d: Direction): DirectionLabel => (d === Direction.Long ? 'LONG' : 'SHORT');
export const directionFromLabel = (l: DirectionLabel): Direction => (l === 'LONG' ? Direction.Long : Direction.Short);

const OUTCOME_LABELS: Record<Exclude<Outcome, 0>, OutcomeLabel> = {
  [Outcome.TargetHit]: 'win',
  [Outcome.StopHit]: 'loss',
  [Outcome.Timeout]: 'timeout',
  [Outcome.CashedOut]: 'cashed_out',
  [Outcome.Voided]: 'voided',
};

export const outcomeLabel = (o: Outcome): OutcomeLabel | null => (o === Outcome.None ? null : OUTCOME_LABELS[o]);

const VOID_LABELS: Record<Exclude<VoidReason, 0>, VoidReasonLabel> = {
  [VoidReason.EntryInvalid]: 'entry_invalid',
  [VoidReason.TerminalInvalid]: 'terminal_invalid',
  [VoidReason.CheckpointGap]: 'checkpoint_gap',
  [VoidReason.Stalled]: 'stalled',
};

export const voidReasonLabel = (r: VoidReason): VoidReasonLabel | null => (r === VoidReason.None ? null : VOID_LABELS[r]);
