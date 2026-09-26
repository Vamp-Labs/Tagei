import { BADGES, DAILY_MISSIONS, XP, levelForXp, levelStartXp, titleForLevel } from '@bnbplay/shared/progression';
import type { ProfileDTO } from '@bnbplay/shared/dto';
import type { ProgressionPayload } from '../../services/roundService';
import type { UserProgression } from '../../types/game';
import type { ArtName } from '../../ui/lucky';

const FLY_MISSION = DAILY_MISSIONS[0];

export const EMPTY_PROGRESSION: UserProgression = {
  level: 1,
  title: titleForLevel(1),
  currentXp: 0,
  nextLevelXp: levelStartXp(2),
  dailyRoundsPlayed: 0,
  dailyRoundsGoal: FLY_MISSION.goal,
  missionCompleted: false,
  streakDays: 0,
};

interface MissionLike {
  id: string;
  progress: number;
  goal: number;
  completed: boolean;
}

function missionFields(missions: readonly MissionLike[]): Pick<UserProgression, 'dailyRoundsPlayed' | 'dailyRoundsGoal' | 'missionCompleted'> {
  const fly = missions.find((mission) => mission.id === FLY_MISSION.id);
  return fly
    ? { dailyRoundsPlayed: fly.progress, dailyRoundsGoal: fly.goal, missionCompleted: fly.completed }
    : { dailyRoundsPlayed: 0, dailyRoundsGoal: FLY_MISSION.goal, missionCompleted: false };
}

export function progressionFromEvent(event: ProgressionPayload): UserProgression {
  return {
    level: event.level,
    title: event.title,
    currentXp: event.xpAfter,
    nextLevelXp: event.nextLevelXp,
    streakDays: event.streakDays,
    ...missionFields(event.missions),
  };
}

export function progressionFromProfile(profile: ProfileDTO): UserProgression {
  const { progression } = profile;
  return {
    level: progression.level,
    title: progression.title,
    currentXp: progression.xp,
    nextLevelXp: progression.nextLevelXp,
    streakDays: progression.streakDays,
    ...missionFields(progression.missions),
  };
}

export const pilotTitle = (progression: Pick<UserProgression, 'level'>): string => titleForLevel(Math.max(1, progression.level));

export const levelOf = (xp: number): number => levelForXp(Math.max(0, xp));

export function streakBonusXp(streakDays: number): number {
  return XP.streakPerDay * Math.min(Math.max(streakDays, 1), XP.streakCapDays);
}

export interface MissionNotice {
  id: number;
  title: string;
  xp: number;
  progress: number;
  goal: number;
}

export function missionNotice(event: ProgressionPayload, id: number): MissionNotice | null {
  const doneId = event.missionJustCompleted;
  if (!doneId) return null;
  const mission = event.missions.find((entry) => entry.id === doneId);
  const def = DAILY_MISSIONS.find((entry) => entry.id === doneId);
  if (!mission && !def) return null;
  return {
    id,
    title: mission?.title ?? def?.title ?? 'Daily mission',
    xp: mission?.xp ?? def?.xp ?? 0,
    progress: mission?.progress ?? def?.goal ?? 0,
    goal: mission?.goal ?? def?.goal ?? 0,
  };
}

export interface BadgeView {
  id: string;
  name: string;
  description: string;
  art: ArtName;
  earned: boolean;
  progress?: { current: number; goal: number };
}

const BADGE_ART: Record<string, { earned: ArtName; locked: ArtName }> = {
  first_orbit: { earned: 'reward-gift', locked: 'locked-bolt' },
  hyperdrive_pilot: { earned: 'reward-crown', locked: 'locked-crown' },
  iron_discipline: { earned: 'reward-clover', locked: 'locked-magnet' },
  whale_hunter: { earned: 'reward-crown', locked: 'locked-crown' },
};

export interface BadgeProgress {
  id: string;
  progress: number;
  unlocked: boolean;
}

export function badgeViews(progress: readonly BadgeProgress[]): BadgeView[] {
  return BADGES.map((def) => {
    const entry = progress.find((item) => item.id === def.id);
    const earned = entry?.unlocked ?? false;
    const art = BADGE_ART[def.id] ?? { earned: 'reward-gift', locked: 'locked-bolt' };
    return {
      id: def.id,
      name: def.title,
      description: def.description,
      art: earned ? art.earned : art.locked,
      earned,
      progress: earned ? undefined : { current: Math.min(entry?.progress ?? 0, def.goal), goal: def.goal },
    };
  });
}

export function badgeProgressFromProfile(profile: ProfileDTO): BadgeProgress[] {
  return profile.progression.badges.map((badge) => ({ id: badge.id, progress: badge.progress, unlocked: badge.unlockedAtMs !== null }));
}

export function mergeUnlocked(current: readonly BadgeProgress[], unlocked: readonly { id: string }[]): BadgeProgress[] {
  if (unlocked.length === 0) return [...current];
  const next = new Map(current.map((entry) => [entry.id, entry]));
  for (const { id } of unlocked) {
    const def = BADGES.find((badge) => badge.id === id);
    next.set(id, { id, progress: def?.goal ?? 1, unlocked: true });
  }
  return [...next.values()];
}
