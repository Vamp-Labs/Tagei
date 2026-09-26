import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupraPriceHub } from '../../src/pricehub/hub.ts';
import { PgOracleStore } from '../../src/pricehub/store.ts';
import { createTestDb, DATABASE_URL, type TestDb } from '../recorder/harness/db.ts';
import { BASE_PRICES, encodeProof } from './fakeSupra.ts';

const opts = { restUrl: 'http://unused', pollMs: 200, staleMs: 3000, proofRetentionH: 6, roundRetentionD: 3 };
const proofAt = (sec: number) => encodeProof(sec, BASE_PRICES);

describe.skipIf(!DATABASE_URL)('oracle archive (Postgres)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it('leader and archiver share one idempotent archive; the recorder finds any captured second', async () => {
    const leader = new SupraPriceHub({ ...opts, store: new PgOracleStore(t.db), instanceId: 'leader' });
    const archiver = new SupraPriceHub({ ...opts, store: new PgOracleStore(t.db), role: 'archiver', instanceId: 'archiver-test' });
    const s = Math.floor(Date.now() / 1000) - 100;
    leader.ingestProof(proofAt(s), Date.now());
    archiver.ingestProof(proofAt(s), Date.now()); // duplicate capture on the other instance
    archiver.ingestProof(proofAt(s + 1), Date.now()); // the leader missed this second
    leader.ingestProof(proofAt(s + 2), Date.now());
    await leader.stop();
    await archiver.stop();
    const rows = await t.sql`select sec, source from oracle_proofs order by sec`;
    expect(rows.map((r) => Number(r.sec))).toEqual([s, s + 1, s + 2]);
    const fresh = new SupraPriceHub({ ...opts, store: new PgOracleStore(t.db) });
    const found = await fresh.archive.find(49, s + 1);
    expect(found?.proof).toBe(proofAt(s + 1));
    await fresh.archive.markReferenced([found!.proofHash], `0x${'ab'.repeat(32)}`);
    const [ref] = await t.sql`select referenced, recorded_tx from oracle_proofs where sec = ${s + 1}`;
    expect(ref.referenced).toBe(true);
    await fresh.start(); // warm-up loads the last 30 min from oracle_rounds
    expect(fresh.history(49, 10).map((r) => r.sec)).toEqual([s, s + 1, s + 2]);
    await fresh.stop();
  });

  it('prunes rounds after 3 d and unreferenced proofs after 6 h, keeping referenced ones', async () => {
    const store = new PgOracleStore(t.db);
    const now = Date.now();
    const old = Math.floor(now / 1000) - 4 * 86_400;
    const hub = new SupraPriceHub({ ...opts, store });
    hub.ingestProof(proofAt(old), now - 7 * 3_600_000);
    hub.ingestProof(proofAt(old + 1), now - 7 * 3_600_000);
    await store.flush();
    const keep = await hub.archive.find(49, old + 1);
    await store.markReferenced([keep!.proofHash], `0x${'cd'.repeat(32)}`);
    const r = await store.prune(now, 3, 6);
    expect(r.rounds).toBe(10);
    expect(r.proofs).toBe(1);
    expect(await store.getProof(keep!.proofHash)).toBe(proofAt(old + 1));
    await store.stop();
  });
});
