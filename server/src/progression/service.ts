// ProgressionService (F1d): awards XP once per finalized live round, idempotently,
// and emits `progression.updated`. Also serves profiles, the XP-only leaderboard and
// the player's settled round history.

import { getAddress, type Address } from 'viem';
import type { LeaderboardEntrySchema, ProfileDTO, ProgressionDTO, RoundDTO } from '@bnbplay/shared/dto';
import { BADGES } from '@bnbplay/shared/progression';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { z } from 'zod';
import type { Bus } from '../bus.ts';
import type { ProgressionService, RoundBook } from '../ports.ts';
import type { LaneSource, RoundHistory } from '../api/deps.ts';
import { silentLogger, type Logger } from '../api/log.ts';
import { utcDay, weekStartDay } from '../api/time.ts';
import type { AuthStore } from '../auth/store.ts';
import { displayNameFor } from '../auth/service.ts';
import {
  badgesView,
  computeReviewAwards,
  computeRoundAwards,
  displayStreak,
  factsFromRound,
  levelView,
  missionsView,
  type Award,
  type BadgeId,
  type DayState,
  type MissionId,
} from './rules.ts';
import type { ProgressionStore } from './store.ts';

type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;
type UpdatedPayload = SsePayload<'progression.updated'>;

export interface ProgressionDeps {
  store: ProgressionStore;
  roundBook: Pick<RoundBook, 'toDTO'>;
  bus: Bus;
  players?: Pick<AuthStore, 'getPlayer' | 'getPlayers'>;
  lanes?: LaneSource;
  now?: () => number;
  log?: Logger;
  /** RoundBook may trail the finality signal slightly; retry the DTO lookup. */
  dtoRetry?: { attempts: number; delayMs: number };
  leaderboardTtlMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ProgressionServiceImpl implements ProgressionService {
  private readonly deps: ProgressionDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly boardCache = new Map<string, { at: number; rows: LeaderboardEntry[] }>();

  constructor(deps: ProgressionDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
  }

  /** Idempotent per round; call once the settlement block is finalized. */
  async onRoundFinalized(roundId: bigint): Promise<void> {
    const dto = await this.fetchDto(roundId);
    if (!dto) {
      this.log.warn('finalized round has no DTO yet; skipped', { roundId: roundId.toString() });
      return;
    }
    const laneDurationSec = await this.laneDuration(dto);
    const facts = factsFromRound(dto, { nowMs: this.now(), laneDurationSec });
    if ('skip' in facts) {
      this.log.warn('finalized round not processable', { roundId: roundId.toString(), reason: facts.skip });
      return;
    }
    const player = facts.player;
    const payload = await this.deps.store.transaction(player, async (tx): Promise<UpdatedPayload | null> => {
      const before = await tx.progress(player);
      const dayBefore = await tx.day(player, facts.day);
      if (!(await tx.claimRound(facts, dayBefore.rounds))) return null; // already processed
      const owned = await tx.badges(player);
      const r = computeRoundAwards(before, dayBefore, facts, new Set(owned.keys()));

      const days = new Map<string, DayState>([[facts.day, r.day]]);
      const awards: { day: string; award: Award }[] = r.awards.map((award) => ({ day: facts.day, award }));
      const missionsDone: MissionId[] = [...r.missionsCompleted];

      const review = await tx.review(player, facts.roundId);
      if (review && !review.credited) {
        const reviewDay = utcDay(review.reviewedAtMs);
        const base = days.get(reviewDay) ?? (await tx.day(player, reviewDay));
        const rv = computeReviewAwards(base, { roundId: facts.roundId, settledAtMs: facts.settledAtMs, dayIndex: r.dayIndex }, review.reviewedAtMs);
        days.set(reviewDay, rv.day);
        awards.push(...rv.awards.map((award) => ({ day: reviewDay, award })));
        missionsDone.push(...rv.missionsCompleted);
        await tx.markReviewCredited(player, facts.roundId);
      }

      const gained: Award[] = [];
      for (const day of new Set(awards.map((a) => a.day))) {
        gained.push(...(await tx.insertAwards(player, day, awards.filter((a) => a.day === day).map((a) => a.award))));
      }
      const xpGained = gained.reduce((s, a) => s + a.amount, 0);
      const progress = { ...r.progress, xp: before.xp + xpGained };
      await tx.saveProgress(player, progress);
      for (const [day, d] of days) await tx.saveDay(player, day, d);
      await tx.addBadges(player, r.unlocked, facts.roundId, this.now());
      await tx.setRoundXp(facts.roundId, gained.filter((a) => a.roundKey === facts.roundId || a.roundKey === 0n).reduce((s, a) => s + a.amount, 0));

      const today = utcDay(this.now());
      return this.updatedPayload({
        roundId: facts.roundId,
        xpBefore: before.xp,
        xpAfter: progress.xp,
        gained,
        missionsDay: days.get(today) ?? days.get(facts.day) ?? r.day,
        missionJustCompleted: missionsDone[0] ?? null,
        streakDays: displayStreak(progress, today),
        badgesUnlocked: r.unlocked,
      });
    });
    if (payload) {
      this.boardCache.clear();
      this.deps.bus.emit('player.event', { player: getAddress(dto.player), event: 'progression.updated', payload });
    }
  }

  /**
   * The owner opened the PIX debrief (GET /v1/pix/debrief/:id with their JWT). Credited
   * now if the round is finalized, otherwise when it finalizes.
   */
  async onDebriefReviewed(playerIn: Address, roundId: bigint): Promise<void> {
    const player = playerIn.toLowerCase();
    const dto = this.deps.roundBook.toDTO(roundId) ?? (await this.deps.store.getRound(roundId));
    if (!dto || dto.status !== 'settled' || dto.player.toLowerCase() !== player) return;
    const reviewedAtMs = this.now();
    const payload = await this.deps.store.transaction(player, async (tx): Promise<UpdatedPayload | null> => {
      if (!(await tx.recordReview(player, roundId, reviewedAtMs))) return null;
      const finalized = await tx.getRound(roundId);
      if (!finalized) return null; // credited by onRoundFinalized
      const before = await tx.progress(player);
      const reviewDay = utcDay(reviewedAtMs);
      const rv = computeReviewAwards(await tx.day(player, reviewDay), finalized, reviewedAtMs);
      const gained = await tx.insertAwards(player, reviewDay, rv.awards);
      const xpGained = gained.reduce((s, a) => s + a.amount, 0);
      const progress = { ...before, xp: before.xp + xpGained };
      await tx.saveProgress(player, progress);
      await tx.saveDay(player, reviewDay, rv.day);
      await tx.markReviewCredited(player, roundId);
      if (gained.length === 0) return null;
      return this.updatedPayload({
        roundId,
        xpBefore: before.xp,
        xpAfter: progress.xp,
        gained,
        missionsDay: rv.day,
        missionJustCompleted: rv.missionsCompleted[0] ?? null,
        streakDays: displayStreak(progress, utcDay(this.now())),
        badgesUnlocked: [],
      });
    });
    if (payload) {
      this.boardCache.clear();
      this.deps.bus.emit('player.event', { player: getAddress(playerIn), event: 'progression.updated', payload });
    }
  }

  async progression(playerIn: Address): Promise<ProgressionDTO> {
    const today = utcDay(this.now());
    const snap = await this.deps.store.snapshot(playerIn.toLowerCase(), today);
    return {
      xp: snap.progress.xp,
      ...levelView(snap.progress.xp),
      streakDays: displayStreak(snap.progress, today),
      missions: missionsView(snap.day),
      badges: badgesView(snap.progress, snap.badges),
    };
  }

  /** Null when the address never signed in and never played. */
  async profile(addressIn: Address): Promise<ProfileDTO | null> {
    const address = getAddress(addressIn);
    const lower = address.toLowerCase();
    const today = utcDay(this.now());
    const [record, snap] = await Promise.all([this.deps.players?.getPlayer(lower) ?? null, this.deps.store.snapshot(lower, today)]);
    if (!record && snap.progress.rounds === 0 && snap.progress.xp === 0) return null;
    const kind = record?.kind ?? 'guest';
    return {
      address,
      displayName: record?.displayName ?? displayNameFor(address, kind),
      kind,
      progression: {
        xp: snap.progress.xp,
        ...levelView(snap.progress.xp),
        streakDays: displayStreak(snap.progress, today),
        missions: missionsView(snap.day),
        badges: badgesView(snap.progress, snap.badges),
      },
      stats: {
        rounds: snap.progress.rounds,
        targetHits: snap.progress.targetHits,
        disciplinedExits: snap.progress.disciplinedExits,
        bestPayoutX: snap.progress.bestPayoutXBps / 10_000,
      },
    };
  }

  /** XP only — never P&L or win rate (F1d §Leaderboard). */
  async leaderboard(period: 'weekly' | 'all', limit = 100): Promise<LeaderboardEntry[]> {
    const key = `${period}:${limit}`;
    const hit = this.boardCache.get(key);
    const ttl = this.deps.leaderboardTtlMs ?? 15_000;
    if (hit && this.now() - hit.at < ttl) return hit.rows;
    const rows = await this.deps.store.leaderboard({ period, weekStartDay: weekStartDay(this.now()), limit });
    const names = (await this.deps.players?.getPlayers(rows.map((r) => r.player))) ?? new Map();
    const out = rows.map((r, i): LeaderboardEntry => {
      const address = getAddress(r.player);
      const rec = names.get(r.player);
      const { level, title } = levelView(r.totalXp);
      return { rank: i + 1, address, displayName: rec?.displayName ?? displayNameFor(address, rec?.kind ?? 'guest'), level, title, xp: r.xp };
    });
    this.boardCache.set(key, { at: this.now(), rows: out });
    return out;
  }

  /** Settled-round history backed by the progression store. */
  history(): RoundHistory {
    return {
      listForPlayer: (player, opts) => this.deps.store.listRounds(player.toLowerCase(), opts),
      get: (roundId) => this.deps.store.getRound(roundId),
    };
  }

  /** Calls onRoundFinalized for every finalized `RoundSettled` chain event (idempotent alongside direct calls). */
  bindFinalizedRounds(): () => void {
    return this.deps.bus.on('chain.event', (e) => {
      if (e.name !== 'RoundSettled' || !e.finalized) return;
      const raw = e.args.roundId;
      if (typeof raw !== 'bigint' && typeof raw !== 'string' && typeof raw !== 'number') return;
      void this.onRoundFinalized(BigInt(raw)).catch((err: unknown) =>
        this.log.error('progression failed for finalized round', { roundId: String(raw), err: String(err) }),
      );
    });
  }

  private async fetchDto(roundId: bigint): Promise<RoundDTO | undefined> {
    const { attempts, delayMs } = this.deps.dtoRetry ?? { attempts: 5, delayMs: 300 };
    for (let i = 0; i < attempts; i++) {
      const dto = this.deps.roundBook.toDTO(roundId);
      if (dto && dto.status === 'settled') return dto;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return undefined;
  }

  private async laneDuration(dto: RoundDTO): Promise<number | undefined> {
    if (!this.deps.lanes) return undefined;
    try {
      const snap = await this.deps.lanes.snapshot();
      return snap.assets.find((a) => a.assetId === dto.assetId)?.tiers.find((t) => t.tier === dto.terms.tier)?.durationSec;
    } catch {
      return undefined;
    }
  }

  private updatedPayload(p: {
    roundId: bigint;
    xpBefore: number;
    xpAfter: number;
    gained: Award[];
    missionsDay: DayState;
    missionJustCompleted: MissionId | null;
    streakDays: number;
    badgesUnlocked: BadgeId[];
  }): UpdatedPayload {
    const after = levelView(p.xpAfter);
    return {
      roundId: p.roundId.toString(),
      xpBefore: p.xpBefore,
      xpAfter: p.xpAfter,
      gained: p.gained.map((a) => ({ reason: a.reason.split(':')[0] === 'streak' ? 'streak' : a.reason.replace(/:\d{4}-\d{2}-\d{2}$/, ''), amount: a.amount })),
      level: after.level,
      title: after.title,
      levelStartXp: after.levelStartXp,
      nextLevelXp: after.nextLevelXp,
      leveledUp: after.level > levelView(p.xpBefore).level,
      missions: missionsView(p.missionsDay),
      missionJustCompleted: p.missionJustCompleted,
      streakDays: p.streakDays,
      badgesUnlocked: p.badgesUnlocked.map((id) => ({ id, title: BADGES.find((b) => b.id === id)?.title ?? id })),
    };
  }
}
