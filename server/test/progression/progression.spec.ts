import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { LeaderboardEntrySchema, ProfileSchema } from '@bnbplay/shared/dto';
import { E18, roundDto, tick } from '../api/helpers.ts';
import { DAY1, progressionHarness, type Updated } from './harness.ts';

const DAY_MS = 86_400_000;

const newPlayer = () => privateKeyToAccount(generatePrivateKey()).address;
const reasons = (u: Updated) => u.gained.map((g) => `${g.reason}:${g.amount}`);

describe('XP per finalized round', () => {
  it('awards flight + streak + first orbit once, idempotently', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    const id = await h.play(p);
    expect(reasons(h.last())).toEqual(['round_complete:20', 'streak:10', 'badge:first_orbit:25']);
    expect(h.last()).toMatchObject({ xpBefore: 0, xpAfter: 55, level: 2, title: 'CADET', leveledUp: true, streakDays: 1, roundId: id.toString() });
    await h.svc.onRoundFinalized(id);
    await h.svc.onRoundFinalized(id);
    expect(h.updates).toHaveLength(1);
    expect((await h.svc.progression(p)).xp).toBe(55);
  });

  it('adds target hit, hyperdrive (≥ 2.0x) and disciplined exit per F1d; XP ignores stake', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    await h.play(p, { outcome: 'win', multiplierBps: 20_000, payout: 20n * E18 });
    expect(reasons(h.last())).toEqual(['round_complete:20', 'target_hit:15', 'streak:10', 'badge:first_orbit:25', 'badge:hyperdrive_pilot:50']);

    const q = newPlayer();
    const entrySec = Math.floor(h.clock.t / 1000) - 40;
    // Cash-out after 10 s of 30 with 50 % of the stake kept → disciplined; a huge stake changes nothing.
    await h.play(q, { outcome: 'cashed_out', stake: 50n * E18, payout: 25n * E18, entrySec, cashOutRequested: true, exitSec: entrySec + 10, decisionSec: entrySec + 10 });
    expect(reasons(h.last())).toContain('disciplined_exit:10');
    await h.play(q, { outcome: 'cashed_out', payout: 9n * E18, entrySec, cashOutRequested: true, exitSec: entrySec + 3, decisionSec: entrySec + 3 });
    expect(reasons(h.last())).toEqual(['round_complete:20']); // too early to count as discipline
  });

  it('completes daily missions and reports them', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    await h.play(p, { direction: 'LONG' });
    await h.play(p, { direction: 'SHORT' });
    expect(reasons(h.last())).toContain('mission:both_directions:30');
    expect(h.last().missionJustCompleted).toBe('both_directions');
    await h.play(p, { direction: 'SHORT' });
    expect(reasons(h.last())).toEqual(['round_complete:20', 'mission:fly_3:50']);
    expect(h.last().missions.map((m) => [m.id, m.progress, m.completed])).toEqual([
      ['fly_3', 3, true],
      ['both_directions', 2, true],
      ['review_debrief', 0, false],
    ]);
  });

  it('applies diminishing returns after 30 and 60 rounds of a UTC day', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    for (let i = 0; i < 30; i++) await h.play(p);
    await h.play(p, { outcome: 'win' });
    expect(reasons(h.last())).toEqual(['round_complete:10', 'target_hit:7']);
    for (let i = 0; i < 29; i++) await h.play(p);
    const before = (await h.svc.progression(p)).xp;
    await h.play(p, { outcome: 'win' });
    expect(h.updates[h.updates.length - 1]?.xpAfter).toBe(before); // round 61: nothing to award
  });
});

describe('daily streak (UTC)', () => {
  it('grows across consecutive UTC days, caps at 5, and resets after a gap', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    const streakAward = () => h.last().gained.find((g) => g.reason === 'streak')?.amount ?? 0;
    h.clock.t = DAY1 + 14 * 3_600_000 - 1000; // 23:59:59 UTC
    await h.play(p);
    expect(streakAward()).toBe(10);
    h.clock.t += 2000; // 00:00:01 next day
    await h.play(p);
    expect(streakAward()).toBe(20);
    expect(h.last().streakDays).toBe(2);
    await h.play(p);
    expect(streakAward()).toBe(0); // not the first round of the day
    for (let d = 1; d <= 4; d++) {
      h.clock.t += DAY_MS;
      await h.play(p);
    }
    expect(h.last().streakDays).toBe(6);
    expect(streakAward()).toBe(50); // 10 × min(streak, 5)
    h.clock.t += 2 * DAY_MS; // skipped a day
    expect((await h.svc.progression(p)).streakDays).toBe(0);
    await h.play(p);
    expect(streakAward()).toBe(10);
    expect(h.last().streakDays).toBe(1);
  });
});

describe('PIX debrief review', () => {
  it('credits Learning +5 and the review mission once, within 10 minutes of settlement', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    const id = await h.play(p);
    h.clock.t += 60_000;
    await h.svc.onDebriefReviewed(p, id);
    expect(reasons(h.last())).toEqual(['debrief_review:5', 'mission:review_debrief:20']);
    const n = h.updates.length;
    await h.svc.onDebriefReviewed(p, id);
    await h.svc.onDebriefReviewed(newPlayer(), id); // not the owner
    expect(h.updates).toHaveLength(n);

    const late = await h.play(p);
    h.clock.t += 11 * 60_000;
    await h.svc.onDebriefReviewed(p, late);
    expect(h.updates).toHaveLength(n + 1); // the round itself; no Learning XP after 10 min
  });

  it('credits a review that arrives before the round is finalized', async () => {
    const h = progressionHarness();
    const p = newPlayer();
    const dto = roundDto({ roundId: 99n, player: p, entrySec: Math.floor(h.clock.t / 1000) - 40, settledAtMs: h.clock.t });
    h.book.put(dto);
    h.clock.t += 2_000;
    await h.svc.onDebriefReviewed(p, 99n);
    expect(h.updates).toHaveLength(0);
    await h.svc.onRoundFinalized(99n);
    expect(reasons(h.last())).toEqual(['round_complete:20', 'streak:10', 'badge:first_orbit:25', 'debrief_review:5', 'mission:review_debrief:20']);
  });
});

describe('profiles and leaderboard', () => {
  it('serves XP-only boards (weekly from Monday UTC) and profiles', async () => {
    const h = progressionHarness();
    const a = newPlayer();
    const b = newPlayer();
    await h.play(a, { outcome: 'win', payout: 15n * E18 });
    h.clock.t += 7 * DAY_MS; // next week
    await h.play(b);
    const weekly = LeaderboardEntrySchema.array().parse(await h.svc.leaderboard('weekly'));
    expect(weekly.map((r) => r.address)).toEqual([b]);
    const all = await h.svc.leaderboard('all');
    expect(all.map((r) => [r.rank, r.address, r.xp])).toEqual([
      [1, a, 70],
      [2, b, 55],
    ]);
    expect(Object.keys(all[0] ?? {}).sort()).toEqual(['address', 'displayName', 'level', 'rank', 'title', 'xp']);

    const profile = ProfileSchema.parse(await h.svc.profile(a));
    expect(profile.stats).toEqual({ rounds: 1, targetHits: 1, disciplinedExits: 0, bestPayoutX: 1.5 });
    expect(profile.progression.badges.find((x) => x.id === 'whale_hunter')).toMatchObject({ progress: 1, goal: 5, unlockedAtMs: null });
    expect(await h.svc.profile(newPlayer())).toBeNull();
    expect(await h.svc.history().listForPlayer(a, { limit: 5 })).toHaveLength(1);
  });

  it('runs on finalized RoundSettled chain events', async () => {
    const h = progressionHarness();
    const unbind = h.svc.bindFinalizedRounds();
    const p = newPlayer();
    h.book.put(roundDto({ roundId: 12n, player: p, entrySec: Math.floor(h.clock.t / 1000) - 40, settledAtMs: h.clock.t }));
    const ev = { name: 'RoundSettled', args: { roundId: 12n }, txHash: `0x${'aa'.repeat(32)}` as const, logIndex: 0, blockNumber: 1n };
    h.bus.emit('chain.event', { ...ev, finalized: false });
    await tick(5);
    expect(h.updates).toHaveLength(0);
    h.bus.emit('chain.event', { ...ev, finalized: true });
    h.bus.emit('chain.event', { ...ev, finalized: true });
    await tick(20);
    expect(h.updates).toHaveLength(1);
    unbind();
  });
});
