import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SSE_EVENTS } from '@bnbplay/shared/sse';
import { Bus } from '../../src/bus.ts';
import { SseHub } from '../../src/sse/hub.ts';
import { createMemoryEventStore } from '../../src/sse/store.ts';
import { E18, FakePriceHub, FakeRoundBook, makeHarness, roundDto, sseReader, tick } from '../api/helpers.ts';

const player = privateKeyToAccount(generatePrivateKey()).address;
const balance = (n: bigint) => ({ player, event: 'balance' as const, payload: { available: (n * E18).toString(), locked: '0' } });

describe('GET /v1/stream', () => {
  it('opens with hello + prices.snapshot, then fans out public and player events', async () => {
    const h = makeHarness();
    h.hub.seed(49, 2000, [600n * E18, 601n * E18]);
    h.roundBook.put(roundDto({ roundId: 4n, player, entrySec: 1_790_000_000, status: 'open' }));
    const res = await h.request(`/v1/stream?player=${player}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const s = sseReader(res);
    await s.until((f) => f.some((x) => x.event === 'prices.snapshot'));
    const hello = SSE_EVENTS.hello.parse(JSON.parse(s.events()[0]?.data ?? '{}'));
    expect(hello.player?.activeRound?.roundId).toBe('4');
    expect(hello.oracle).toMatchObject({ source: 'supra-dora2', status: 'ok' });
    const snap = SSE_EVENTS['prices.snapshot'].parse(JSON.parse(s.events()[1]?.data ?? '{}'));
    expect(snap.assets.BNB?.rounds).toHaveLength(2);

    h.bus.emit('public.event', { event: 'oracle.status', payload: { status: 'degraded', pairs: {} } });
    h.bus.emit('player.event', balance(90n));
    h.bus.emit('player.event', { ...balance(1n), player: privateKeyToAccount(generatePrivateKey()).address }); // someone else
    await s.until((f) => f.some((x) => x.event === 'balance'));
    const live = s.events().slice(2);
    expect(live.map((f) => f.event)).toEqual(['oracle.status', 'balance']);
    expect(live[0]?.id).toBeUndefined(); // public events carry no id
    expect(Number(live[1]?.id)).toBeGreaterThan(0);
    await s.close();
  });

  it('replays player events after Last-Event-ID and then continues live without duplicates', async () => {
    const h = makeHarness();
    for (const n of [1n, 2n, 3n]) h.bus.emit('player.event', balance(n));
    await tick(10);
    const first = sseReader(await h.request(`/v1/stream?player=${player}`));
    await first.until((f) => f.some((x) => x.event === 'prices.snapshot'));
    await first.close();

    const res = await h.request(`/v1/stream?player=${player}`, { headers: { 'Last-Event-ID': '1' } });
    const s = sseReader(res);
    await s.until((f) => f.filter((x) => x.event === 'balance').length === 2);
    h.bus.emit('player.event', balance(4n));
    await s.until((f) => f.filter((x) => x.event === 'balance').length === 3);
    const ids = s.events().filter((f) => f.event === 'balance').map((f) => Number(f.id));
    expect(ids).toEqual([2, 3, 4]);
    const amounts = s.events().filter((f) => f.event === 'balance').map((f) => JSON.parse(f.data ?? '{}').available);
    expect(amounts).toEqual([2n, 3n, 4n].map((n) => (n * E18).toString()));
    await s.close();

    const viaQuery = sseReader(await h.request(`/v1/stream?player=${player}&lastEventId=3`));
    await viaQuery.until((f) => f.some((x) => x.event === 'balance'));
    expect(viaQuery.events().filter((f) => f.event === 'balance').map((f) => f.id)).toEqual(['4']);
    await viaQuery.close();
  });

  it('drops events that fail their schema and caps concurrent streams per IP', async () => {
    const h = makeHarness();
    h.bus.emit('player.event', { player, event: 'balance', payload: { available: '-1', locked: '0' } });
    await tick(5);
    const streams = [];
    for (let i = 0; i < 3; i++) streams.push(sseReader(await h.request('/v1/stream', { ip: '10.1.1.1' })));
    const fourth = await h.request('/v1/stream', { ip: '10.1.1.1' });
    expect(fourth.status).toBe(429);
    expect((await h.request('/v1/stream', { ip: '10.1.1.2' })).status).toBe(200);
    await streams[0]?.until((f) => f.some((x) => x.event === 'hello'));
    await streams[0]?.close();
    await tick(10);
    const again = await h.request('/v1/stream', { ip: '10.1.1.1' });
    expect(again.status).toBe(200);
    for (const s of streams.slice(1)) await s.close();
    const replay = sseReader(await h.request(`/v1/stream?player=${player}&lastEventId=0`, { ip: '10.1.1.3' }));
    await replay.until((f) => f.some((x) => x.event === 'prices.snapshot'));
    await tick(20);
    expect(replay.events().some((f) => f.event === 'balance')).toBe(false);
    await replay.close();
  });

  it('pings idle connections', async () => {
    const bus = new Bus();
    const hub = new SseHub({ bus, store: createMemoryEventStore(), priceHub: new FakePriceHub(), roundBook: new FakeRoundBook(), pingMs: 20 });
    hub.start();
    const { streamSSE } = await import('hono/streaming');
    const { Hono } = await import('hono');
    const app = new Hono();
    app.get('/s', (c) => streamSSE(c, (stream) => hub.serve(stream, { player: null, lastEventId: null, slot: hub.reserve('ip') })));
    const s = sseReader(await app.request('/s'));
    await s.until((f) => f.some((x) => x.comment === 'ping'), 1000);
    await s.close();
    await tick(5);
    expect(hub.stats().connections).toBe(0);
    await hub.stop();
  });
});
