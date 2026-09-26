// Pure F1d rules: given the player's state before a finalized round, compute the
// awards and the next state. All constants come from @bnbplay/shared/progression.
// XP never scales with stake; per-round awards (flight, target, discipline, learning)
// follow dailyXpFactor; streak, missions and badges are flat.

import type { MissionSchema, BadgeSchema, RoundDTO } from '@bnbplay/shared/dto';
import type { OutcomeLabel } from '@bnbplay/shared/enums';
import {
  BADGES,
  DAILY_MISSIONS,
  DEBRIEF_REVIEW_WINDOW_SEC,
  XP,
  dailyXpFactor,
  isDisciplinedExit,
  levelForXp,
  levelStartXp,
  titleForLevel,
  type BadgeDef,
  type MissionDef,
} from '@bnbplay/shared/progression';
import type { z } from 'zod';
import { previousDay, utcDay } from '../api/time.ts';

export type BadgeId = BadgeDef['id'];
export type MissionId = MissionDef['id'];
type MissionDTO = z.infer<typeof MissionSchema>;
type BadgeDTO = z.infer<typeof BadgeSchema>;

export const DIRECTION_BIT = { LONG: 1, SHORT: 2 } as const;
export const HYPERDRIVE_X_BPS = 20_000;
/** Reviews stamped slightly before the settle block (clock skew) still count. */
const REVIEW_SKEW_MS = 5_000;

export interface ProgressState {
  xp: number;
  streakDays: number;
  lastActiveDay: string | null;
  rounds: number;
  targetHits: number;
  disciplinedExits: number;
  bestPayoutXBps: number;
}

export interface DayState {
  rounds: number;
  directions: number;
  reviews: number;
  missionsCompleted: MissionId[];
}

export const emptyProgress = (): ProgressState => ({
  xp: 0,
  streakDays: 0,
  lastActiveDay: null,
  rounds: 0,
  targetHits: 0,
  disciplinedExits: 0,
  bestPayoutXBps: 0,
});

export const emptyDay = (): DayState => ({ rounds: 0, directions: 0, reviews: 0, missionsCompleted: [] });

export interface RoundFacts {
  roundId: bigint;
  /** Lowercase address. */
  player: string;
  assetId: number;
  tier: number;
  direction: 'LONG' | 'SHORT';
  outcome: OutcomeLabel;
  stake: bigint;
  payout: bigint;
  payoutXBps: number;
  disciplined: boolean;
  day: string;
  settledAtMs: number;
  dto: RoundDTO;
}

/** A ledger award. `roundKey` 0 marks daily/lifetime awards whose reason carries the day or id. */
export interface Award {
  reason: string;
  amount: number;
  roundKey: bigint;
}

export function factsFromRound(dto: RoundDTO, opts: { nowMs: number; laneDurationSec?: number }): RoundFacts | { skip: string } {
  if (dto.status !== 'settled' || dto.outcome === null || dto.payout === null) return { skip: 'round not settled' };
  const stake = BigInt(dto.terms.stake);
  const payout = BigInt(dto.payout);
  const exitSec = dto.exitSec ?? dto.decisionSec;
  // RoundDTO.terms is the open-time snapshot; if a producer shortened endSec to the
  // exit second, fall back to the lane duration for the disciplined-exit share.
  let durationSec = dto.terms.endSec - dto.terms.entrySec;
  if (dto.cashOutRequested && exitSec !== null && dto.terms.endSec === exitSec && opts.laneDurationSec) durationSec = opts.laneDurationSec;
  const elapsedSec = (dto.decisionSec ?? exitSec ?? dto.terms.entrySec) - dto.terms.entrySec;
  const disciplined = dto.outcome === 'cashed_out' && isDisciplinedExit({ stake, payout, elapsedSec, durationSec });
  const settledAtMs = dto.settledAtMs ?? opts.nowMs;
  return {
    roundId: BigInt(dto.roundId),
    player: dto.player.toLowerCase(),
    assetId: dto.assetId,
    tier: dto.terms.tier,
    direction: dto.terms.direction,
    outcome: dto.outcome,
    stake,
    payout,
    payoutXBps: stake > 0n ? Number((payout * 10_000n) / stake) : 0,
    disciplined,
    day: utcDay(settledAtMs),
    settledAtMs,
    dto,
  };
}

const popcount = (n: number): number => (n & 1) + ((n >> 1) & 1);

function missionValue(id: MissionId, d: DayState): number {
  switch (id) {
    case 'fly_3':
      return d.rounds;
    case 'both_directions':
      return popcount(d.directions);
    case 'review_debrief':
      return d.reviews;
  }
}

/** Completes any mission whose goal is now met; returns the new awards. */
function completeMissions(day: string, d: DayState, only?: MissionId[]): Award[] {
  const out: Award[] = [];
  for (const m of DAILY_MISSIONS) {
    if (only && !only.includes(m.id)) continue;
    if (d.missionsCompleted.includes(m.id) || missionValue(m.id, d) < m.goal) continue;
    d.missionsCompleted = [...d.missionsCompleted, m.id];
    out.push({ reason: `mission:${m.id}:${day}`, amount: m.xp, roundKey: 0n });
  }
  return out;
}

export interface RoundAwards {
  awards: Award[];
  progress: ProgressState;
  day: DayState;
  dayIndex: number;
  factor: number;
  unlocked: BadgeId[];
  missionsCompleted: MissionId[];
}

export function computeRoundAwards(before: ProgressState, dayBefore: DayState, f: RoundFacts, owned: ReadonlySet<BadgeId>): RoundAwards {
  const dayIndex = dayBefore.rounds;
  const factor = dailyXpFactor(dayIndex);
  const scaled = (xp: number) => Math.floor(xp * factor);
  const round = f.roundId;
  const awards: Award[] = [{ reason: 'round_complete', amount: scaled(XP.roundComplete), roundKey: round }];
  if (f.outcome === 'win') awards.push({ reason: 'target_hit', amount: scaled(XP.targetHit), roundKey: round });
  if (f.disciplined) awards.push({ reason: 'disciplined_exit', amount: scaled(XP.disciplinedExit), roundKey: round });

  const progress: ProgressState = {
    ...before,
    rounds: before.rounds + 1,
    targetHits: before.targetHits + (f.outcome === 'win' ? 1 : 0),
    disciplinedExits: before.disciplinedExits + (f.disciplined ? 1 : 0),
    bestPayoutXBps: Math.max(before.bestPayoutXBps, f.payoutXBps),
  };

  // Daily streak: first completed live round of each UTC day. A round finalized out of
  // order for an earlier day leaves the streak alone.
  if (before.lastActiveDay === null || f.day > before.lastActiveDay) {
    const streak = before.lastActiveDay === previousDay(f.day) ? before.streakDays + 1 : 1;
    progress.streakDays = streak;
    progress.lastActiveDay = f.day;
    awards.push({ reason: `streak:${f.day}`, amount: XP.streakPerDay * Math.min(streak, XP.streakCapDays), roundKey: 0n });
  }

  const day: DayState = {
    ...dayBefore,
    rounds: dayBefore.rounds + 1,
    directions: dayBefore.directions | DIRECTION_BIT[f.direction],
  };
  const missionAwards = completeMissions(f.day, day, ['fly_3', 'both_directions']);
  awards.push(...missionAwards);

  const unlocked: BadgeId[] = [];
  const unlock = (id: BadgeId, cond: boolean) => {
    if (cond && !owned.has(id)) unlocked.push(id);
  };
  unlock('first_orbit', progress.rounds >= 1);
  unlock('hyperdrive_pilot', f.payoutXBps >= HYPERDRIVE_X_BPS);
  unlock('iron_discipline', progress.disciplinedExits >= 5);
  unlock('whale_hunter', progress.targetHits >= 5);
  for (const id of unlocked) {
    const def = BADGES.find((b) => b.id === id);
    if (def) awards.push({ reason: `badge:${id}`, amount: def.xp, roundKey: 0n });
  }

  return {
    awards: awards.filter((a) => a.amount > 0),
    progress,
    day,
    dayIndex,
    factor,
    unlocked,
    missionsCompleted: missionAwards.map((a) => a.reason.split(':')[1] as MissionId),
  };
}

export interface ReviewAwards {
  awards: Award[];
  day: DayState;
  withinWindow: boolean;
  missionsCompleted: MissionId[];
}

/**
 * The owner opened the debrief of a finalized round: Learning +5 (once per round,
 * within 10 min of settlement, scaled like the round) and the daily review mission.
 */
export function computeReviewAwards(
  dayBefore: DayState,
  round: { roundId: bigint; settledAtMs: number; dayIndex: number },
  reviewedAtMs: number,
): ReviewAwards {
  const reviewDay = utcDay(reviewedAtMs);
  const delta = reviewedAtMs - round.settledAtMs;
  const withinWindow = delta >= -REVIEW_SKEW_MS && delta <= DEBRIEF_REVIEW_WINDOW_SEC * 1000;
  const awards: Award[] = [];
  if (withinWindow) {
    const amount = Math.floor(XP.debriefReview * dailyXpFactor(round.dayIndex));
    if (amount > 0) awards.push({ reason: 'debrief_review', amount, roundKey: round.roundId });
  }
  const day: DayState = { ...dayBefore, reviews: dayBefore.reviews + 1 };
  const missionAwards = completeMissions(reviewDay, day, ['review_debrief']);
  awards.push(...missionAwards);
  return { awards, day, withinWindow, missionsCompleted: missionAwards.map((a) => a.reason.split(':')[1] as MissionId) };
}

// ── Views ─────────────────────────────────────────────────────────────────────

export function levelView(xp: number): { level: number; title: string; levelStartXp: number; nextLevelXp: number } {
  const level = levelForXp(xp);
  return { level, title: titleForLevel(level), levelStartXp: levelStartXp(level), nextLevelXp: levelStartXp(level + 1) };
}

export function missionsView(d: DayState | null): MissionDTO[] {
  const day = d ?? emptyDay();
  return DAILY_MISSIONS.map((m) => ({
    id: m.id,
    title: m.title,
    goal: m.goal,
    xp: m.xp,
    progress: Math.min(m.goal, missionValue(m.id, day)),
    completed: day.missionsCompleted.includes(m.id) || missionValue(m.id, day) >= m.goal,
  }));
}

export function badgesView(p: ProgressState, owned: ReadonlyMap<BadgeId, number>): BadgeDTO[] {
  const value = (id: BadgeId): number => {
    switch (id) {
      case 'first_orbit':
        return p.rounds;
      case 'hyperdrive_pilot':
        return p.bestPayoutXBps >= HYPERDRIVE_X_BPS ? 1 : 0;
      case 'iron_discipline':
        return p.disciplinedExits;
      case 'whale_hunter':
        return p.targetHits;
    }
  };
  return BADGES.map((b) => ({
    id: b.id,
    title: b.title,
    description: b.description,
    goal: b.goal,
    progress: Math.min(b.goal, value(b.id)),
    unlockedAtMs: owned.get(b.id) ?? null,
  }));
}

/** A streak is shown only while it is still alive (active today or yesterday, UTC). */
export const displayStreak = (p: ProgressState, today: string): number =>
  p.lastActiveDay === today || p.lastActiveDay === previousDay(today) ? p.streakDays : 0;
