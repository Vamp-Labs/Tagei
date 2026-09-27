import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeStream } from '../src/api/fakeStream';
import type { StreamLike } from '../src/api/stream';
import { toPrice18 } from '../src/game/units';
import { FakeBackend } from '../src/services/fakeBackend';
import { MarketFeedService } from '../src/services/marketFeed';
import { BinanceDisplaySource, type SocketLike } from '../src/services/priceSources/binance';
import type { ExactRound, PriceTick } from '../src/types/market';

const START = Date.parse('2026-09-26T12:00:00.000Z');

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  closed = false;
  constructor(readonly url: string) {}
  close() {
    this.closed = true;
  }
  trade(price: number) {
    this.onmessage?.({ data: JSON.stringify({ p: price.toFixed(2), T: Date.now() }) });
  }
}

function setup() {
  const stream = new FakeStream();
  const sockets: FakeSocket[] = [];
  const binance = new BinanceDisplaySource({
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  const feed = new MarketFeedService({ stream: () => stream, binance });
  const emitPrice = (sec: number, price: number, asset: 'BNB' | 'ETH' = 'BNB') =>
    stream.emit('price', { asset, pairId: asset === 'BNB' ? 49 : 1, round: String(sec * 1000), tsMs: sec * 1000 + 200, price: toPrice18(price).toString(), lagMs: 250 });
  const snapshot = (prices: number[], startSec: number) =>
    stream.emit('prices.snapshot', {
      assets: { BNB: { pairId: 49, rounds: prices.map((price, i) => [String((startSec + i) * 1000), (startSec + i) * 1000 + 200, toPrice18(price).toString()]) } },
      stats: { BNB: { open24h: null, change24hPct: 1.75, high24h: null, low24h: null } },
    });
  return { stream, sockets, feed, emitPrice, snapshot };
}

describe('MarketFeedService — live mode (hub + Binance fallback)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds a 4 Hz track from the hub snapshot and uses the real 24 h change', () => {
    const { feed, snapshot, stream } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    expect(stream.refCount()).toBe(1);
    const nowSec = Math.floor(START / 1000);
    snapshot(Array.from({ length: 30 }, (_, i) => 600 + i * 0.1), nowSec - 29);
    const history = feed.getHistory();
    expect(history).toHaveLength(100);
    expect(history[history.length - 1].price).toBeCloseTo(602.9, 9);
    expect(history[1].timestamp - history[0].timestamp).toBe(250);
    expect(feed.getCurrentPrice()).toBeCloseTo(602.9, 9);
    let tick: PriceTick | null = null;
    feed.subscribe((t) => {
      tick = t;
    });
    expect(tick).toMatchObject({ change24h: 1.75 });
    expect(feed.getStatus()).toMatchObject({ mode: 'live', source: 'hub', exact: true, stale: false });
    feed.cleanup();
    expect(stream.refCount()).toBe(0);
  });

  it('emits 4 display ticks per exact round but only exact rounds to subscribeRounds', async () => {
    const { feed, emitPrice } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const ticks: PriceTick[] = [];
    const rounds: ExactRound[] = [];
    feed.subscribe((t) => ticks.push(t));
    feed.subscribeRounds((r) => rounds.push(r));
    ticks.length = 0;
    const sec = Math.floor(START / 1000);
    emitPrice(sec, 600);
    for (let i = 1; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      emitPrice(sec + i, 600 + i);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(rounds.map((r) => r.price)).toEqual([600, 601, 602, 603, 604, 605]);
    expect(rounds.every((r) => r.source === 'hub')).toBe(true);
    const displayTicks = ticks.filter((t) => t.timestamp > START);
    expect(displayTicks.length).toBeGreaterThanOrEqual(22);
    expect(displayTicks.length).toBeLessThanOrEqual(25);
    expect(displayTicks[displayTicks.length - 1].price).toBe(605);
    expect(feed.getCurrentPrice()).toBe(605);
    feed.cleanup();
  });

  it('keeps every exact round out of the display path of other assets', () => {
    const { feed, emitPrice } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const all: string[] = [];
    const bnb: string[] = [];
    feed.subscribeRounds((r) => all.push(r.asset), { asset: 'all' });
    feed.subscribeRounds((r) => bnb.push(r.asset));
    const sec = Math.floor(START / 1000);
    emitPrice(sec, 600, 'BNB');
    emitPrice(sec, 2850, 'ETH');
    expect(all).toEqual(['BNB', 'ETH']);
    expect(bnb).toEqual(['BNB']);
    expect(feed.getCurrentPrice()).toBe(600);
    feed.cleanup();
  });

  it('falls back to Binance for display only when the hub goes stale, then returns to the hub', async () => {
    const { feed, emitPrice, sockets } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const rounds: ExactRound[] = [];
    feed.subscribeRounds((r) => rounds.push(r));
    const sec = Math.floor(START / 1000);
    emitPrice(sec, 600);
    expect(sockets).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(4_500);
    expect(feed.getStatus()).toMatchObject({ source: 'binance', exact: false, stale: false });
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://stream.binance.com:9443/ws/bnbusdt@trade');

    sockets[0].trade(598.5);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(feed.getHistory().at(-1)?.price).toBe(598.5);
    expect(rounds).toHaveLength(1);

    emitPrice(sec + 7, 601);
    expect(feed.getStatus().source).toBe('hub');
    expect(sockets[0].closed).toBe(true);
    expect(rounds.map((r) => r.price)).toEqual([600, 601]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(feed.getHistory().at(-1)?.price).toBe(601);
    feed.cleanup();
  });

  it('snaps the display onto a registered level within 150 ms', async () => {
    const { feed, emitPrice } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const sec = Math.floor(START / 1000);
    emitPrice(sec, 600);
    await vi.advanceTimersByTimeAsync(1000);
    feed.setLevels([600.5]);
    emitPrice(sec + 1, 601);
    await vi.advanceTimersByTimeAsync(150);
    expect(feed.getHistory().at(-1)?.price).toBe(601);
    feed.cleanup();
  });

  it('seeds from the hello and snapshot a synchronous stream sends on retain', () => {
    const backend = new FakeBackend({ autoPrices: false });
    const feed = new MarketFeedService({ stream: () => backend.stream, binance: new BinanceDisplaySource({ createSocket: null }) });
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    expect(feed.getExactHistory('BNB').length).toBe(120);
    expect(feed.getStatus()).toMatchObject({ source: 'hub', oracle: 'ok' });
    const history = feed.getHistory();
    expect(new Set(history.map((tick) => tick.price)).size).toBeGreaterThan(20);
    feed.cleanup();
    backend.dispose();
  });

  it('reconcileWithKnownPrice re-seeds a synthetic feed around the given price', () => {
    const { feed } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true); // hub configured, no round/snapshot sent yet: still synthetic
    feed.reconcileWithKnownPrice(772.5, START);
    const history = feed.getHistory();
    expect(history).toHaveLength(41);
    expect(history.every((tick) => tick.price === 772.5)).toBe(true);
    expect(history[1].timestamp - history[0].timestamp).toBe(400);
    expect(feed.getCurrentPrice()).toBe(772.5);
    feed.cleanup();
  });

  it('reconcileWithKnownPrice is a no-op once seedFromHub has run', () => {
    const { feed, snapshot } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const nowSec = Math.floor(START / 1000);
    snapshot(Array.from({ length: 30 }, (_, i) => 600 + i * 0.1), nowSec - 29);
    const before = feed.getHistory();
    feed.reconcileWithKnownPrice(1);
    expect(feed.getHistory()).toEqual(before);
    expect(feed.getCurrentPrice()).toBeCloseTo(602.9, 9);
    feed.cleanup();
  });

  it('a subsequent seedFromHub still fully replaces a reconciled seed with real hub data', () => {
    const { feed, snapshot } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    feed.reconcileWithKnownPrice(772.5, START); // stand-in, before any real hub data
    const nowSec = Math.floor(START / 1000);
    snapshot(Array.from({ length: 30 }, (_, i) => 600 + i * 0.1), nowSec - 29);
    const history = feed.getHistory();
    expect(history).toHaveLength(100);
    expect(history[history.length - 1].price).toBeCloseTo(602.9, 9);
    expect(feed.getCurrentPrice()).toBeCloseTo(602.9, 9);
    feed.cleanup();
  });

  it('reconcileWithKnownPrice ignores a non-finite or non-positive price', () => {
    const { feed } = setup();
    feed.setAsset('ETH', true);
    feed.setAsset('BNB', true);
    const before = feed.getHistory();
    feed.reconcileWithKnownPrice(Number.NaN);
    feed.reconcileWithKnownPrice(0);
    feed.reconcileWithKnownPrice(-5);
    expect(feed.getHistory()).toEqual(before);
    feed.cleanup();
  });

  it('uses the mock walk when neither the hub nor WebSocket is available', () => {
    const offline: StreamLike = {
      on: () => () => undefined,
      onAny: () => () => undefined,
      onStatus: () => () => undefined,
      status: () => 'idle',
      retain: () => () => undefined,
      setPlayer: () => undefined,
      player: () => null,
      serverNow: () => Date.now(),
      isConfigured: () => false,
    };
    const feed = new MarketFeedService({ stream: () => offline, binance: new BinanceDisplaySource({ createSocket: null }) });
    feed.setAsset('ETH', true);
    expect(feed.getStatus()).toMatchObject({ mode: 'live', source: 'mock' });
    feed.cleanup();
  });
});

describe('MarketFeedService — practice mode stays today’s mock feed', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks every 250 ms, keeps 100 points and applies SIM bumps', async () => {
    const stream = new FakeStream();
    const feed = new MarketFeedService({ stream: () => stream });
    feed.setAsset('BNB', false);
    expect(feed.getHistory()).toHaveLength(41);
    expect(stream.refCount()).toBe(0);
    const ticks: PriceTick[] = [];
    const rounds: ExactRound[] = [];
    feed.subscribe((t) => ticks.push(t));
    feed.subscribeRounds((r) => rounds.push(r));
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toHaveLength(5);
    expect(rounds).toHaveLength(4);
    expect(rounds.every((r) => r.source === 'mock')).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(feed.getHistory()).toHaveLength(100);

    const before = feed.getCurrentPrice();
    feed.pushPriceDelta(1);
    expect(feed.getCurrentPrice()).toBeCloseTo(before * 1.01, 9);
    expect(feed.getStatus()).toMatchObject({ mode: 'practice', source: 'mock', exact: true, stale: false });
    feed.cleanup();
  });
});
