// Postgres-backed store tests. They run only with TEST_DATABASE_URL (CI has no
// Postgres); each run creates a throwaway schema from the A4 Drizzle schema files
// via drizzle-kit's generator and drops it afterwards.

import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as players from '../../src/db/schema/players.ts';
import * as events from '../../src/db/schema/events.ts';
import * as faucet from '../../src/db/schema/faucet.ts';
import * as progression from '../../src/db/schema/progression.ts';
import * as pix from '../../src/db/schema/pix.ts';
import { createPgAuthStore } from '../../src/auth/store.ts';
import { createPgFaucetStore } from '../../src/faucet/store.ts';
import { createPgPixStore } from '../../src/pix/store.ts';
import { createPgProgressionStore } from '../../src/progression/store.ts';
import { createPgEventStore } from '../../src/sse/store.ts';
import { progressionHarness } from '../progression/harness.ts';
import { E18 } from './helpers.ts';

const url = process.env.TEST_DATABASE_URL;
const schema = `a4t_${randomBytes(4).toString('hex')}`;
let sql: Sql;

describe.skipIf(!url)('Postgres stores', () => {
  beforeAll(async () => {
    const admin = postgres(url as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    await admin.end();
    sql = postgres(url as string, { max: 5, onnotice: () => {}, connection: { search_path: schema } });
    const { generateDrizzleJson, generateMigration } = await import('drizzle-kit/api');
    const ddl = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...players, ...events, ...faucet, ...progression, ...pix }));
    for (const stmt of ddl) await sql.unsafe(stmt);
  }, 60_000);

  afterAll(async () => {
    await sql?.unsafe(`drop schema ${schema} cascade`);
    await sql?.end();
  });

  it('player events: monotonic ids, replay after an id, latest, prune', async () => {
    const store = createPgEventStore(sql);
    const a = await store.append('0xabc', 'balance', { available: '1', locked: '0' });
    const b = await store.append('0xabc', 'balance', { available: '2', locked: '0' });
    await store.append('0xdef', 'balance', { available: '9', locked: '0' });
    expect(b.id).toBeGreaterThan(a.id);
    expect((await store.since('0xabc', a.id, 10)).map((r) => r.payload)).toEqual([{ available: '2', locked: '0' }]);
    expect((await store.latest('0xabc', 'balance'))?.id).toBe(b.id);
    expect(await store.prune(Date.now() + 1000)).toBe(3);
  });

  it('auth: single-use challenges and session counting', async () => {
    const store = createPgAuthStore(sql);
    await store.createChallenge({ salt: '0x01', address: '0xabc', expiresAt: 2000 });
    expect(await store.consumeChallenge('0x01', '0xdef', 1000)).toBe(false);
    expect(await store.consumeChallenge('0x01', '0xabc', 1000)).toBe(true);
    expect(await store.consumeChallenge('0x01', '0xabc', 1000)).toBe(false);
    const first = await store.recordSession({ address: '0xabc', kind: 'guest', displayName: 'Pilot 0ABC' });
    const second = await store.recordSession({ address: '0xabc', kind: 'wallet', displayName: 'x' });
    expect([first.firstSession, second.firstSession]).toEqual([true, false]);
    expect(second.player).toMatchObject({ kind: 'guest', sessions: 2, displayName: 'Pilot 0ABC' });
  });

  it('faucet: counts ignore failed claims', async () => {
    const store = createPgFaucetStore(sql);
    const now = Date.now();
    await store.insert({ id: 'fc1', player: '0xabc', ipHash: 'ip', amount: 100n * E18, source: 'claim', status: 'queued', txHash: null, error: null, createdAtMs: now });
    await store.insert({ id: 'fc2', player: '0xabc', ipHash: 'ip', amount: 100n * E18, source: 'claim', status: 'queued', txHash: null, error: null, createdAtMs: now + 1 });
    await store.update('fc2', { status: 'failed', error: 'x' });
    expect((await store.lastActiveClaim('0xabc'))?.id).toBe('fc1');
    expect(await store.countByIpSince('ip', now - 1)).toBe(1);
    expect(await store.countSince(now - 1)).toBe(1);
  });

  it('pix: first debrief wins, usage sums, chat quota increments', async () => {
    const store = createPgPixStore(sql);
    const d = { headline: 'h', analysis: 'a', keyFactors: [], coachingTip: 't', source: 'template' as const };
    await store.putDebrief(1n, '0xabc', d);
    expect(await store.putDebrief(1n, '0xabc', { ...d, headline: 'other' })).toEqual(d);
    await store.recordUsage({ day: '2026-09-26', kind: 'insight', model: 'm', player: null, inputTokens: 1, outputTokens: 1, costMicroUsd: 6, outcome: 'ok' });
    await store.recordUsage({ day: '2026-09-26', kind: 'chat', model: 'm', player: '0xabc', inputTokens: 1, outputTokens: 1, costMicroUsd: 4, outcome: 'ok' });
    expect(await store.spentMicroUsd('2026-09-26')).toBe(10);
    expect(await store.bumpChat('0xabc', '2026-09-26')).toBe(1);
    expect(await store.bumpChat('0xabc', '2026-09-26')).toBe(2);
  });

  it('progression: idempotent under concurrent finalization, missions, review and boards', async () => {
    const h = progressionHarness(createPgProgressionStore(sql));
    const p = privateKeyToAccount(generatePrivateKey()).address;
    const id = await h.play(p, { outcome: 'win', payout: 15n * E18 });
    await Promise.all([h.svc.onRoundFinalized(id), h.svc.onRoundFinalized(id), h.svc.onRoundFinalized(id)]);
    expect(h.updates).toHaveLength(1);
    expect(h.last().xpAfter).toBe(70);
    await h.play(p, { direction: 'SHORT' });
    await h.play(p);
    expect(h.last().gained.map((g) => g.reason)).toEqual(['round_complete', 'mission:fly_3']);
    h.clock.t += 30_000;
    await h.svc.onDebriefReviewed(p, id);
    expect(h.last().gained.map((g) => `${g.reason}:${g.amount}`)).toEqual(['debrief_review:5', 'mission:review_debrief:20']);
    const profile = await h.svc.profile(p);
    expect(profile?.stats).toMatchObject({ rounds: 3, targetHits: 1 });
    expect(profile?.progression.xp).toBe(70 + 20 + 30 + 20 + 50 + 25);
    const weekly = await h.svc.leaderboard('weekly');
    expect(weekly.find((r) => r.address === p)?.xp).toBe(profile?.progression.xp);
    const hist = await h.svc.history().listForPlayer(p, { limit: 2 });
    expect(hist.map((r) => r.roundId)).toEqual(['3', '2']);
    expect((await h.svc.history().listForPlayer(p, { beforeRoundId: 2n, limit: 5 })).map((r) => r.roundId)).toEqual(['1']);
  });
});
