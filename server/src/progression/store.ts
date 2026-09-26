// Progression persistence. Every mutation runs inside `transaction(player, fn)`,
// which serializes per player (pg advisory lock / in-process mutex) and commits
// atomically, so a round is processed exactly once.

import { and, desc, eq, gte, lt, sql as dsql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { RoundDTO } from '@bnbplay/shared/dto';
import {
  debriefReviews,
  playerBadges,
  playerDays,
  playerProgress,
  progressionRounds,
  xpLedger,
} from '../db/schema/progression.ts';
import { emptyDay, emptyProgress, type Award, type BadgeId, type DayState, type MissionId, type ProgressState, type RoundFacts } from './rules.ts';

export interface FinalizedRound {
  roundId: bigint;
  player: string;
  settledAtMs: number;
  day: string;
  dayIndex: number;
  dto: RoundDTO;
}

export interface ProgressionTx {
  /** Inserts the processing guard; false when the round was already processed. */
  claimRound(f: RoundFacts, dayIndex: number): Promise<boolean>;
  getRound(roundId: bigint): Promise<FinalizedRound | null>;
  progress(player: string): Promise<ProgressState>;
  day(player: string, day: string): Promise<DayState>;
  badges(player: string): Promise<Map<BadgeId, number>>;
  review(player: string, roundId: bigint): Promise<{ reviewedAtMs: number; credited: boolean } | null>;
  /** Inserts awards (ON CONFLICT DO NOTHING); returns the ones actually inserted. */
  insertAwards(player: string, day: string, awards: Award[]): Promise<Award[]>;
  saveProgress(player: string, p: ProgressState): Promise<void>;
  saveDay(player: string, day: string, d: DayState): Promise<void>;
  addBadges(player: string, ids: BadgeId[], roundId: bigint, atMs: number): Promise<void>;
  setRoundXp(roundId: bigint, xp: number): Promise<void>;
  /** False when this round's debrief was already reviewed by the player. */
  recordReview(player: string, roundId: bigint, reviewedAtMs: number): Promise<boolean>;
  markReviewCredited(player: string, roundId: bigint): Promise<void>;
}

export interface LeaderboardRow {
  player: string;
  /** XP for the requested period. */
  xp: number;
  /** Lifetime XP (drives level and title). */
  totalXp: number;
}

export interface ProgressionStore {
  transaction<T>(player: string, fn: (tx: ProgressionTx) => Promise<T>): Promise<T>;
  snapshot(player: string, day: string): Promise<{ progress: ProgressState; day: DayState | null; badges: Map<BadgeId, number> }>;
  listRounds(player: string, opts: { beforeRoundId?: bigint; limit: number }): Promise<RoundDTO[]>;
  getRound(roundId: bigint): Promise<RoundDTO | undefined>;
  leaderboard(opts: { period: 'weekly' | 'all'; weekStartDay: string; limit: number }): Promise<LeaderboardRow[]>;
}

// ── In-memory ─────────────────────────────────────────────────────────────────

interface MemState {
  rounds: Map<string, FinalizedRound & { xp: number }>;
  ledger: Map<string, { player: string; roundKey: bigint; reason: string; amount: number; day: string }>;
  progress: Map<string, ProgressState>;
  days: Map<string, DayState>;
  badges: Map<string, Map<BadgeId, number>>;
  reviews: Map<string, { reviewedAtMs: number; credited: boolean }>;
}

const ledgerKey = (player: string, roundKey: bigint, reason: string) => `${player}|${roundKey}|${reason}`;
const dayKey = (player: string, day: string) => `${player}|${day}`;
const reviewKey = (player: string, roundId: bigint) => `${player}|${roundId}`;

const cloneDay = (d: DayState): DayState => ({ ...d, missionsCompleted: [...d.missionsCompleted] });

export function createMemoryProgressionStore(now: () => number = Date.now): ProgressionStore {
  const state: MemState = {
    rounds: new Map(),
    ledger: new Map(),
    progress: new Map(),
    days: new Map(),
    badges: new Map(),
    reviews: new Map(),
  };
  const locks = new Map<string, Promise<unknown>>();

  const withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (locks.get(key) === tail) locks.delete(key);
    }
  };

  return {
    transaction(player, fn) {
      return withLock(player, async () => {
        // Stage every write; apply only if fn resolves (atomic commit).
        const staged: (() => void)[] = [];
        const pendingLedger = new Set<string>();
        const pendingRounds = new Map<string, FinalizedRound & { xp: number }>();
        const pendingReviews = new Map<string, { reviewedAtMs: number; credited: boolean }>();
        const tx: ProgressionTx = {
          async claimRound(f, dayIndex) {
            const key = f.roundId.toString();
            if (state.rounds.has(key) || pendingRounds.has(key)) return false;
            const row = { roundId: f.roundId, player: f.player, settledAtMs: f.settledAtMs, day: f.day, dayIndex, dto: f.dto, xp: 0 };
            pendingRounds.set(key, row);
            staged.push(() => state.rounds.set(key, row));
            return true;
          },
          async getRound(roundId) {
            const r = pendingRounds.get(roundId.toString()) ?? state.rounds.get(roundId.toString());
            return r ? { ...r } : null;
          },
          async progress(p) {
            return { ...(state.progress.get(p) ?? emptyProgress()) };
          },
          async day(p, day) {
            const d = state.days.get(dayKey(p, day));
            return d ? cloneDay(d) : emptyDay();
          },
          async badges(p) {
            return new Map(state.badges.get(p) ?? []);
          },
          async review(p, roundId) {
            const r = pendingReviews.get(reviewKey(p, roundId)) ?? state.reviews.get(reviewKey(p, roundId));
            return r ? { ...r } : null;
          },
          async insertAwards(p, day, awards) {
            const inserted: Award[] = [];
            for (const a of awards) {
              const k = ledgerKey(p, a.roundKey, a.reason);
              if (state.ledger.has(k) || pendingLedger.has(k)) continue;
              pendingLedger.add(k);
              inserted.push(a);
              staged.push(() => state.ledger.set(k, { player: p, roundKey: a.roundKey, reason: a.reason, amount: a.amount, day }));
            }
            return inserted;
          },
          async saveProgress(p, prog) {
            const copy = { ...prog };
            staged.push(() => state.progress.set(p, copy));
          },
          async saveDay(p, day, d) {
            const copy = cloneDay(d);
            staged.push(() => state.days.set(dayKey(p, day), copy));
          },
          async addBadges(p, ids, _roundId, atMs) {
            staged.push(() => {
              const owned = state.badges.get(p) ?? new Map<BadgeId, number>();
              for (const id of ids) if (!owned.has(id)) owned.set(id, atMs);
              state.badges.set(p, owned);
            });
          },
          async setRoundXp(roundId, xp) {
            staged.push(() => {
              const r = state.rounds.get(roundId.toString());
              if (r) r.xp = xp;
            });
          },
          async recordReview(p, roundId, reviewedAtMs) {
            const k = reviewKey(p, roundId);
            if (state.reviews.has(k) || pendingReviews.has(k)) return false;
            const row = { reviewedAtMs, credited: false };
            pendingReviews.set(k, row);
            staged.push(() => state.reviews.set(k, row));
            return true;
          },
          async markReviewCredited(p, roundId) {
            const k = reviewKey(p, roundId);
            staged.push(() => {
              const r = state.reviews.get(k);
              if (r) r.credited = true;
            });
          },
        };
        const out = await fn(tx);
        for (const apply of staged) apply();
        return out;
      });
    },
    async snapshot(player, day) {
      const d = state.days.get(dayKey(player, day));
      return {
        progress: { ...(state.progress.get(player) ?? emptyProgress()) },
        day: d ? cloneDay(d) : null,
        badges: new Map(state.badges.get(player) ?? []),
      };
    },
    async listRounds(player, opts) {
      return [...state.rounds.values()]
        .filter((r) => r.player === player && (opts.beforeRoundId === undefined || r.roundId < opts.beforeRoundId))
        .sort((a, b) => (a.roundId < b.roundId ? 1 : -1))
        .slice(0, opts.limit)
        .map((r) => r.dto);
    },
    async getRound(roundId) {
      return state.rounds.get(roundId.toString())?.dto;
    },
    async leaderboard(opts) {
      const rows = new Map<string, number>();
      if (opts.period === 'all') {
        for (const [p, prog] of state.progress) rows.set(p, prog.xp);
      } else {
        for (const l of state.ledger.values()) if (l.day >= opts.weekStartDay) rows.set(l.player, (rows.get(l.player) ?? 0) + l.amount);
      }
      void now;
      return [...rows.entries()]
        .filter(([, xp]) => xp > 0)
        .map(([player, xp]) => ({ player, xp, totalXp: state.progress.get(player)?.xp ?? 0 }))
        .sort((a, b) => b.xp - a.xp || (a.player < b.player ? -1 : 1))
        .slice(0, opts.limit);
    },
  };
}

// ── Postgres ──────────────────────────────────────────────────────────────────

type DrizzleDb = ReturnType<typeof drizzle>;
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

const toProgress = (r: typeof playerProgress.$inferSelect | undefined): ProgressState =>
  r
    ? {
        xp: r.xp,
        streakDays: r.streakDays,
        lastActiveDay: r.lastActiveDay,
        rounds: r.rounds,
        targetHits: r.targetHits,
        disciplinedExits: r.disciplinedExits,
        bestPayoutXBps: r.bestPayoutXBps,
      }
    : emptyProgress();

const toDay = (r: typeof playerDays.$inferSelect): DayState => ({
  rounds: r.rounds,
  directions: r.directions,
  reviews: r.reviews,
  missionsCompleted: (r.missionsCompleted ?? []) as MissionId[],
});

function pgTx(tx: DrizzleTx): ProgressionTx {
  return {
    async claimRound(f, dayIndex) {
      const rows = await tx
        .insert(progressionRounds)
        .values({
          roundId: f.roundId.toString(),
          player: f.player,
          assetId: f.assetId,
          tier: f.tier,
          direction: f.direction,
          outcome: f.outcome,
          stake: f.stake.toString(),
          payout: f.payout.toString(),
          payoutXBps: f.payoutXBps,
          disciplined: f.disciplined,
          day: f.day,
          dayIndex,
          settledAtMs: f.settledAtMs,
          round: f.dto,
        })
        .onConflictDoNothing()
        .returning({ roundId: progressionRounds.roundId });
      return rows.length === 1;
    },
    async getRound(roundId) {
      const [r] = await tx.select().from(progressionRounds).where(eq(progressionRounds.roundId, roundId.toString())).limit(1);
      return r ? { roundId, player: r.player, settledAtMs: r.settledAtMs, day: r.day, dayIndex: r.dayIndex, dto: r.round } : null;
    },
    async progress(player) {
      const [r] = await tx.select().from(playerProgress).where(eq(playerProgress.player, player)).for('update');
      return toProgress(r);
    },
    async day(player, day) {
      const [r] = await tx
        .select()
        .from(playerDays)
        .where(and(eq(playerDays.player, player), eq(playerDays.day, day)))
        .for('update');
      return r ? toDay(r) : emptyDay();
    },
    async badges(player) {
      const rows = await tx.select().from(playerBadges).where(eq(playerBadges.player, player));
      return new Map(rows.map((r) => [r.badgeId as BadgeId, r.unlockedAt.getTime()]));
    },
    async review(player, roundId) {
      const [r] = await tx
        .select()
        .from(debriefReviews)
        .where(and(eq(debriefReviews.player, player), eq(debriefReviews.roundId, roundId.toString())))
        .limit(1);
      return r ? { reviewedAtMs: r.reviewedAtMs, credited: r.credited } : null;
    },
    async insertAwards(player, day, awards) {
      if (awards.length === 0) return [];
      const rows = await tx
        .insert(xpLedger)
        .values(awards.map((a) => ({ player, roundId: a.roundKey.toString(), reason: a.reason, amount: a.amount, day })))
        .onConflictDoNothing()
        .returning({ roundId: xpLedger.roundId, reason: xpLedger.reason, amount: xpLedger.amount });
      return rows.map((r) => ({ reason: r.reason, amount: r.amount, roundKey: BigInt(r.roundId) }));
    },
    async saveProgress(player, p) {
      const values = { ...p, updatedAt: new Date() };
      await tx
        .insert(playerProgress)
        .values({ player, ...values })
        .onConflictDoUpdate({ target: playerProgress.player, set: values });
    },
    async saveDay(player, day, d) {
      const values = { rounds: d.rounds, directions: d.directions, reviews: d.reviews, missionsCompleted: d.missionsCompleted };
      await tx
        .insert(playerDays)
        .values({ player, day, ...values })
        .onConflictDoUpdate({ target: [playerDays.player, playerDays.day], set: values });
    },
    async addBadges(player, ids, roundId, atMs) {
      if (ids.length === 0) return;
      await tx
        .insert(playerBadges)
        .values(ids.map((badgeId) => ({ player, badgeId, roundId: roundId.toString(), unlockedAt: new Date(atMs) })))
        .onConflictDoNothing();
    },
    async setRoundXp(roundId, xp) {
      await tx.update(progressionRounds).set({ xp }).where(eq(progressionRounds.roundId, roundId.toString()));
    },
    async recordReview(player, roundId, reviewedAtMs) {
      const rows = await tx
        .insert(debriefReviews)
        .values({ player, roundId: roundId.toString(), reviewedAtMs })
        .onConflictDoNothing()
        .returning({ roundId: debriefReviews.roundId });
      return rows.length === 1;
    },
    async markReviewCredited(player, roundId) {
      await tx
        .update(debriefReviews)
        .set({ credited: true })
        .where(and(eq(debriefReviews.player, player), eq(debriefReviews.roundId, roundId.toString())));
    },
  };
}

export function createPgProgressionStore(sql: Sql): ProgressionStore {
  const db = drizzle(sql);
  return {
    transaction(player, fn) {
      return db.transaction(async (tx) => {
        await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(${`progression:${player}`}))`);
        return fn(pgTx(tx));
      });
    },
    async snapshot(player, day) {
      const [[p], [d], badges] = await Promise.all([
        db.select().from(playerProgress).where(eq(playerProgress.player, player)).limit(1),
        db
          .select()
          .from(playerDays)
          .where(and(eq(playerDays.player, player), eq(playerDays.day, day)))
          .limit(1),
        db.select().from(playerBadges).where(eq(playerBadges.player, player)),
      ]);
      return {
        progress: toProgress(p),
        day: d ? toDay(d) : null,
        badges: new Map(badges.map((b) => [b.badgeId as BadgeId, b.unlockedAt.getTime()])),
      };
    },
    async listRounds(player, opts) {
      const where =
        opts.beforeRoundId === undefined
          ? eq(progressionRounds.player, player)
          : and(eq(progressionRounds.player, player), lt(progressionRounds.roundId, opts.beforeRoundId.toString()));
      const rows = await db
        .select({ round: progressionRounds.round })
        .from(progressionRounds)
        .where(where)
        .orderBy(desc(progressionRounds.roundId))
        .limit(opts.limit);
      return rows.map((r) => r.round);
    },
    async getRound(roundId) {
      const [r] = await db
        .select({ round: progressionRounds.round })
        .from(progressionRounds)
        .where(eq(progressionRounds.roundId, roundId.toString()))
        .limit(1);
      return r?.round;
    },
    async leaderboard(opts) {
      if (opts.period === 'all') {
        const rows = await db
          .select({ player: playerProgress.player, xp: playerProgress.xp })
          .from(playerProgress)
          .where(gte(playerProgress.xp, 1))
          .orderBy(desc(playerProgress.xp), playerProgress.player)
          .limit(opts.limit);
        return rows.map((r) => ({ player: r.player, xp: r.xp, totalXp: r.xp }));
      }
      const weekly = sum(xpLedger.amount).mapWith(Number);
      const rows = await db
        .select({ player: xpLedger.player, xp: weekly, totalXp: playerProgress.xp })
        .from(xpLedger)
        .leftJoin(playerProgress, eq(playerProgress.player, xpLedger.player))
        .where(gte(xpLedger.day, opts.weekStartDay))
        .groupBy(xpLedger.player, playerProgress.xp)
        .having(dsql`sum(${xpLedger.amount}) > 0`)
        .orderBy(desc(weekly), xpLedger.player)
        .limit(opts.limit);
      return rows.map((r) => ({ player: r.player, xp: r.xp ?? 0, totalXp: r.totalXp ?? 0 }));
    },
  };
}
