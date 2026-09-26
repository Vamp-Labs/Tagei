import { afterEach, describe, expect, it } from 'vitest';
import { Bus } from '../../src/bus.ts';
import type { OracleRound } from '../../src/ports.ts';
import { SecondMissedError, SupraPriceHub } from '../../src/pricehub/hub.ts';
import { MemoryOracleStore } from '../../src/pricehub/store.ts';
import { BASE_PRICES, encodeProof, startFakeSupra, type FakeSupra } from './fakeSupra.ts';

const opts = { restUrl: 'http://unused', pollMs: 200, staleMs: 3000, proofRetentionH: 6, roundRetentionD: 3 };
const proofAt = (sec: number, bump = 0n) => encodeProof(sec, Object.fromEntries(Object.entries(BASE_PRICES).map(([p, v]) => [p, v + bump])));

describe('SupraPriceHub ingestion', () => {
  it('emits each new round once, in order, and archives every proof', () => {
    const bus = new Bus();
    const store = new MemoryOracleStore();
    const hub = new SupraPriceHub({ ...opts, bus, store });
    const seen: OracleRound[] = [];
    const prices: string[] = [];
    bus.on('oracle.round', (r) => seen.push(r));
    bus.on('public.event', (e) => e.event === 'price' && prices.push(e.payload.asset));
    const t = 1_790_000_000;
    expect(hub.ingestProof(proofAt(t), Date.now())).toHaveLength(5);
    expect(hub.ingestProof(proofAt(t), Date.now())).toHaveLength(0); // same proof polled again
    expect(hub.ingestProof(proofAt(t + 1), Date.now())).toHaveLength(5);
    expect(hub.ingestProof(proofAt(t, 1n), Date.now())).toHaveLength(0); // older round: archived, not emitted
    expect(seen.map((r) => r.sec)).toEqual([...Array(5).fill(t), ...Array(5).fill(t + 1)]);
    expect(prices).toHaveLength(10);
    expect(hub.metrics.duplicateProofs).toBe(1);
    expect(hub.metrics.regressions).toBe(0);
    expect(hub.metrics.conflicts).toBe(5);
    expect(store.proofs.size).toBe(3);
    expect(hub.latest(49)?.sec).toBe(t + 1);
    expect(hub.history(49, 10).map((r) => r.sec)).toEqual([t, t + 1]);
    expect(hub.proofForSecond(t)?.proofHash).toBe(seen[0].proofHash);
    expect(hub.proofFor(0, t + 1)?.proofHash).toBe(seen[5].proofHash);
  });

  it('counts missed seconds and rejects waiters for them', async () => {
    const hub = new SupraPriceHub(opts);
    const t = 1_790_000_100;
    hub.ingestProof(proofAt(t), Date.now());
    const waitMissed = hub.waitForSecond(49, t + 1, 5000);
    const waitHit = hub.waitForSecond(49, t + 3, 5000);
    hub.ingestProof(proofAt(t + 3), Date.now());
    await expect(waitMissed).rejects.toBeInstanceOf(SecondMissedError);
    expect((await waitHit).sec).toBe(t + 3);
    expect(hub.metrics.missingByPair[49]).toBe(2);
    await expect(hub.waitForSecond(49, t + 2, 10)).rejects.toBeInstanceOf(SecondMissedError);
    await expect(hub.waitForSecond(49, t + 9, 20)).rejects.toThrow(/timed out/);
  });

  it('reports ok / degraded / down from the age of the newest round', () => {
    let now = 1_790_000_200_000;
    const hub = new SupraPriceHub({ ...opts, now: () => now });
    expect(hub.status().status).toBe('down');
    hub.ingestProof(proofAt(1_790_000_200), now);
    now += 900;
    expect(hub.status().status).toBe('ok');
    expect(hub.status().lagMsP50).toBe(0);
    now += 4000;
    expect(hub.status().status).toBe('degraded');
    now += 8000;
    expect(hub.status().status).toBe('down');
  });

  it('schedules polls on the phase grid inside each second', () => {
    const hub = new SupraPriceHub({ ...opts, jitterMs: 0 });
    const slots: number[] = [];
    let now = 1_790_000_300_020;
    for (let i = 0; i < 7; i++) {
      const s = hub.nextSlotMs(now);
      slots.push(s % 1000);
      now = s + 30;
    }
    expect(slots).toEqual([150, 350, 550, 750, 950, 150, 350]);
  });
});

describe('SupraPriceHub polling (fake Supra REST)', () => {
  let fake: FakeSupra | undefined;
  let hub: SupraPriceHub | undefined;
  afterEach(async () => {
    await hub?.stop();
    await fake?.close();
  });

  it('captures every second at 5 Hz and backs off during an outage', async () => {
    fake = await startFakeSupra();
    const bus = new Bus();
    const statuses: string[] = [];
    bus.on('oracle.status', (s) => statuses.push(s.status));
    hub = new SupraPriceHub({ ...opts, restUrl: fake.url, bus });
    await hub.start();
    await new Promise((r) => setTimeout(r, 3300));
    const secs = hub.history(49, 100).map((r) => r.sec);
    expect(secs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < secs.length; i++) expect(secs[i]).toBe(secs[i - 1] + 1);
    expect(fake.requests).toBeGreaterThanOrEqual(12);
    expect(fake.requests).toBeLessThanOrEqual(18);
    expect(statuses[statuses.length - 1]).toBe('ok');
    const before = fake.requests;
    fake.outageUntilMs = Date.now() + 1500;
    await new Promise((r) => setTimeout(r, 1500));
    expect(fake.requests - before).toBeLessThan(8);
    expect(hub.metrics.httpErrors).toBeGreaterThan(0);
  }, 15_000);
});
