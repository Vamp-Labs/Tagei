// Progression rules (F1d). XP is flat and never scales with stake; the server
// awards it idempotently once a settlement is finalized. Practice earns nothing.

export const XP = {
  roundComplete: 20,
  targetHit: 15,
  disciplinedExit: 10,
  debriefReview: 5,
  streakPerDay: 10,
  streakCapDays: 5,
} as const;

/** Rounds after this count per UTC day earn half XP; after the second count, none. */
export const DAILY_HALF_XP_AFTER = 30;
export const DAILY_NO_XP_AFTER = 60;

/** Disciplined exit: a cash-out held for at least this share of the duration and at least this many seconds. */
export const DISCIPLINED_MIN_ELAPSED_SHARE = 0.25;
export const DISCIPLINED_MIN_ELAPSED_SEC = 5;
/** …that secures gains (payout >= stake) or cuts losses while still keeping >= 40% of the stake. */
export const DISCIPLINED_MIN_PAYOUT_SHARE = 0.4;

export const DEBRIEF_REVIEW_WINDOW_SEC = 600;

export interface MissionDef {
  id: 'fly_3' | 'both_directions' | 'review_debrief';
  title: string;
  goal: number;
  xp: number;
}

export const DAILY_MISSIONS: readonly MissionDef[] = [
  { id: 'fly_3', title: 'Fly 3 rounds', goal: 3, xp: 50 },
  { id: 'both_directions', title: 'Fly both directions', goal: 2, xp: 30 },
  { id: 'review_debrief', title: 'Review a PIX debrief', goal: 1, xp: 20 },
];

export interface BadgeDef {
  id: 'first_orbit' | 'hyperdrive_pilot' | 'iron_discipline' | 'whale_hunter';
  title: string;
  description: string;
  goal: number;
  xp: number;
}

export const BADGES: readonly BadgeDef[] = [
  { id: 'first_orbit', title: 'First Orbit', description: 'Completed your first live market flight', goal: 1, xp: 25 },
  { id: 'hyperdrive_pilot', title: 'Hyperdrive Pilot', description: 'Settled a round at 2.0x payout or more', goal: 1, xp: 50 },
  { id: 'iron_discipline', title: 'Iron Discipline', description: 'Made 5 disciplined cash-outs', goal: 5, xp: 50 },
  { id: 'whale_hunter', title: 'Whale Hunter', description: 'Hit the target 5 times', goal: 5, xp: 75 },
];

/** XP needed to go from level L to L+1. */
export const xpToNextLevel = (level: number): number => 40 + 20 * (level - 1);

/** Total XP at which `level` starts (level 1 starts at 0). */
export const levelStartXp = (level: number): number => 40 * (level - 1) + 10 * (level - 1) * (level - 2);

export function levelForXp(xp: number): number {
  let level = 1;
  while (levelStartXp(level + 1) <= xp) level++;
  return level;
}

const TITLES: readonly { from: number; title: string }[] = [
  { from: 20, title: 'ORBIT LEGEND' },
  { from: 15, title: 'HYPERDRIVE ACE' },
  { from: 10, title: 'VOLATILITY SURFER' },
  { from: 7, title: 'MOMENTUM HUNTER' },
  { from: 5, title: 'TRAILBLAZER' },
  { from: 3, title: 'NAVIGATOR' },
  { from: 1, title: 'CADET' },
];

export const titleForLevel = (level: number): string => (TITLES.find((t) => level >= t.from) ?? TITLES[TITLES.length - 1]).title;

export function isDisciplinedExit(p: { stake: bigint; payout: bigint; elapsedSec: number; durationSec: number }): boolean {
  if (p.elapsedSec < DISCIPLINED_MIN_ELAPSED_SEC) return false;
  if (p.elapsedSec < DISCIPLINED_MIN_ELAPSED_SHARE * p.durationSec) return false;
  return p.payout * 10n >= p.stake * BigInt(Math.round(DISCIPLINED_MIN_PAYOUT_SHARE * 10));
}

/** Multiplier applied to per-round XP given how many live rounds were already played today. */
export function dailyXpFactor(roundsBeforeToday: number): number {
  if (roundsBeforeToday >= DAILY_NO_XP_AFTER) return 0;
  if (roundsBeforeToday >= DAILY_HALF_XP_AFTER) return 0.5;
  return 1;
}
