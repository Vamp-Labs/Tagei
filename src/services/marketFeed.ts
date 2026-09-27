import {
  AssetSymbol,
  ExactRound,
  FeedSource,
  MarketFeedStatus,
  OracleHealth,
  PriceTick,
  SUPPORTED_ASSETS,
} from '../types/market';
import { getStream } from '../api/runtime';
import type { StreamLike } from '../api/stream';
import { toPrice18 } from '../game/units';
import { DISPLAY_TICK_MS, DisplayInterpolator } from './displayInterpolator';
import { BinanceDisplaySource, type DisplaySample } from './priceSources/binance';
import { HubPriceSource } from './priceSources/hub';
import { MOCK_SEED_POINTS, MOCK_SEED_SPACING_MS, MOCK_TICK_MS, MockRandomWalk, seedMockHistory } from './priceSources/mock';

type TickListener = (tick: PriceTick) => void;

export type RoundListener = (round: ExactRound) => void;

export interface SubscribeRoundsOptions {
  asset?: AssetSymbol | 'all';
}

export interface MarketFeedDeps {
  stream?: () => StreamLike;
  binance?: BinanceDisplaySource;
  interpolator?: DisplayInterpolator;
  hubStaleMs?: number;
  displayTickMs?: number;
  now?: () => number;
  random?: () => number;
}

const HUB_STALE_MS = 4_000;
const SEED_WINDOW_ROUNDS = 26;

export class MarketFeedService {
  private currentAsset: AssetSymbol = 'BNB';
  private listeners: Set<TickListener> = new Set();
  private mockInterval: ReturnType<typeof setInterval> | null = null;
  private currentPrice: number;
  private basePrice24h: number;
  private isUsingLiveFeed: boolean = true;
  private history: PriceTick[] = [];
  private maxHistorySize: number = 100;

  private readonly deps: MarketFeedDeps;
  private readonly interpolator: DisplayInterpolator;
  private readonly hubStaleMs: number;
  private readonly displayTickMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private binanceSource: BinanceDisplaySource | null = null;
  private hub: HubPriceSource | null = null;
  private liveCleanups: (() => void)[] = [];
  private displayTimer: ReturnType<typeof setInterval> | null = null;
  private snapTimer: ReturnType<typeof setTimeout> | null = null;
  private stopBinance: (() => void) | null = null;
  private source: FeedSource = 'mock';
  private lastExact: ExactRound | null = null;
  private lastHubAtMs: number | null = null;
  private lastPriceAtMs: number | null = null;
  private liveStartedAtMs = 0;
  private synthetic = true;
  private oracle: OracleHealth | null = null;
  private readonly roundListeners = new Map<RoundListener, SubscribeRoundsOptions>();
  private readonly statusListeners = new Set<(status: MarketFeedStatus) => void>();
  private lastStatusKey = '';

  constructor(deps: MarketFeedDeps = {}) {
    this.deps = deps;
    this.interpolator = deps.interpolator ?? new DisplayInterpolator();
    this.hubStaleMs = deps.hubStaleMs ?? HUB_STALE_MS;
    this.displayTickMs = deps.displayTickMs ?? DISPLAY_TICK_MS;
    this.now = deps.now ?? (() => Date.now());
    this.random = deps.random ?? Math.random;
    this.currentPrice = SUPPORTED_ASSETS['BNB'].basePrice;
    this.basePrice24h = this.currentPrice * 0.9786;
    this.initHistory();
  }

  private initHistory() {
    const seeded = seedMockHistory(this.currentPrice, SUPPORTED_ASSETS[this.currentAsset].volatility, this.basePrice24h, Date.now(), this.random);
    this.history = seeded.history;
    this.currentPrice = seeded.price;
    this.synthetic = true;
  }

  public setAsset(asset: AssetSymbol, useLive: boolean = true) {
    if (this.currentAsset === asset && this.isUsingLiveFeed === useLive) return;

    this.currentAsset = asset;
    this.isUsingLiveFeed = useLive;
    this.currentPrice = SUPPORTED_ASSETS[asset].basePrice;
    this.basePrice24h = this.currentPrice * 0.98;
    this.lastExact = null;
    this.interpolator.clear();
    this.initHistory();
    this.connect();
  }

  public setLiveMode(useLive: boolean) {
    this.isUsingLiveFeed = useLive;
    this.connect();
  }

  public subscribe(listener: TickListener): () => void {
    this.listeners.add(listener);
    listener({
      price: this.currentPrice,
      timestamp: Date.now(),
      change24h: this.change24h(this.currentPrice),
    });
    return () => this.listeners.delete(listener);
  }

  public subscribeRounds(listener: RoundListener, options: SubscribeRoundsOptions = {}): () => void {
    this.roundListeners.set(listener, options);
    return () => {
      this.roundListeners.delete(listener);
    };
  }

  public subscribeStatus(listener: (status: MarketFeedStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public getStatus(): MarketFeedStatus {
    const live = this.isUsingLiveFeed;
    const hubStale = this.source === 'hub' && !this.isHubFresh();
    return {
      mode: live ? 'live' : 'practice',
      asset: this.currentAsset,
      source: this.source,
      exact: this.source === 'mock' || (this.source === 'hub' && !hubStale),
      stale: live && (this.source === 'none' || hubStale),
      oracle: this.oracle,
      lastPriceAtMs: this.lastPriceAtMs,
    };
  }

  public setLevels(levels: readonly number[] | null): void {
    this.interpolator.setLevels(levels);
  }

  public getLevels(): readonly number[] {
    return this.interpolator.getLevels();
  }

  public getCurrentPrice(): number {
    return this.currentPrice;
  }

  /**
   * Re-seeds the feed around a known-real price (e.g. a round's on-chain entry price)
   * while the feed is still on its synthetic placeholder seed. This closes the gap that
   * opens on resume/reload: roundService can present a real entry/target/stop the instant
   * the `hello` SSE event lands, before this feed's own hub connection has delivered its
   * first round. It is a no-op once real hub/Binance data has arrived (`synthetic` is
   * false), so it can never override or fight real data — a subsequent seedFromHub() still
   * fully replaces this seed, since it never flips `synthetic` itself.
   */
  public reconcileWithKnownPrice(price: number, atMs: number = this.now()): void {
    if (!this.synthetic || !Number.isFinite(price) || price <= 0) return;
    this.history = Array.from({ length: MOCK_SEED_POINTS }, (_, index) => ({
      price,
      timestamp: atMs - (MOCK_SEED_POINTS - 1 - index) * MOCK_SEED_SPACING_MS,
      change24h: this.change24h(price),
    }));
    this.currentPrice = price;
    this.interpolator.reset(price, atMs);
  }

  public getDisplayPrice(): number {
    const last = this.history[this.history.length - 1];
    return last ? last.price : this.currentPrice;
  }

  public getLastExactRound(): ExactRound | null {
    return this.lastExact;
  }

  public getExactHistory(asset: AssetSymbol = this.currentAsset): readonly ExactRound[] {
    return this.hub ? this.hub.history(asset) : [];
  }

  public getHistory(): PriceTick[] {
    return [...this.history];
  }

  public getCurrentAsset(): AssetSymbol {
    return this.currentAsset;
  }

  public isLive(): boolean {
    return this.isUsingLiveFeed;
  }

  public pushPriceDelta(pctDelta: number) {
    if (this.isUsingLiveFeed && this.source !== 'mock') return;
    const delta = this.currentPrice * (pctDelta / 100);
    const nextPrice = Math.max(0.0001, this.currentPrice + delta);
    this.handleNewTick(nextPrice);
  }

  public connect() {
    this.cleanup();

    if (!this.isUsingLiveFeed) {
      this.source = 'mock';
      this.startMockFeed();
      this.emitStatus();
      return;
    }

    this.startLiveFeed();
  }

  private startMockFeed() {
    if (this.mockInterval) return;

    const walk = new MockRandomWalk(SUPPORTED_ASSETS[this.currentAsset].volatility, this.random);

    this.mockInterval = setInterval(() => {
      this.handleNewTick(walk.next(this.currentPrice));
    }, MOCK_TICK_MS);
  }

  private startLiveFeed() {
    this.liveStartedAtMs = this.now();
    const hub = this.getHub();
    const binance = this.getBinance();
    if (!hub.isConfigured() && !binance.isAvailable()) {
      this.source = 'mock';
      this.startMockFeed();
      this.emitStatus();
      return;
    }
    if (hub.isConfigured()) {
      this.source = 'hub';
      this.liveCleanups.push(
        hub.onRound((round) => this.onHubRound(round)),
        hub.onSnapshot((assets) => {
          if (assets.includes(this.currentAsset)) this.onHubSnapshot();
        }),
        hub.onStats(() => this.emitStatus()),
        hub.onOracle((status) => {
          this.oracle = status;
          this.emitStatus();
        }),
        hub.start(),
      );
      this.oracle = hub.oracle();
      if (hub.history(this.currentAsset).length > 0) this.seedFromHub();
    }
    this.displayTimer = setInterval(() => this.tickDisplay(), this.displayTickMs);
    this.checkFallback();
  }

  private getHub(): HubPriceSource {
    this.hub ??= new HubPriceSource((this.deps.stream ?? getStream)(), { now: this.now });
    return this.hub;
  }

  private getBinance(): BinanceDisplaySource {
    this.binanceSource ??= this.deps.binance ?? new BinanceDisplaySource();
    return this.binanceSource;
  }

  private isHubFresh(): boolean {
    const hub = this.hub;
    if (!hub || !hub.isConfigured()) return false;
    if (this.lastHubAtMs === null) return this.now() - this.liveStartedAtMs < this.hubStaleMs;
    return this.now() - this.lastHubAtMs <= this.hubStaleMs;
  }

  private checkFallback() {
    if (!this.isUsingLiveFeed || this.source === 'mock') return;
    if (this.isHubFresh()) {
      if (this.stopBinance) {
        this.stopBinance();
        this.stopBinance = null;
      }
      this.source = 'hub';
    } else {
      const binance = this.getBinance();
      if (binance.isAvailable()) {
        if (!this.stopBinance) {
          const asset = this.currentAsset;
          this.stopBinance = binance.start(asset, (sample) => this.onBinanceSample(sample));
        }
        this.source = 'binance';
      } else {
        this.source = this.hub?.isConfigured() ? 'hub' : 'none';
      }
    }
    this.emitStatus();
  }

  private tickDisplay() {
    this.checkFallback();
    if (!this.interpolator.isInitialized()) return;
    this.handleNewTick(this.interpolator.sample(this.now()));
  }

  private onHubRound(round: ExactRound) {
    if (round.asset === this.currentAsset && this.isUsingLiveFeed) {
      this.lastHubAtMs = this.now();
      this.lastExact = round;
      this.currentPrice = round.price;
      this.checkFallback();
      if (this.synthetic || !this.interpolator.isInitialized()) {
        this.seedFromHub();
      } else {
        const pushed = this.interpolator.push(round.price, this.now());
        if (pushed.snapped) this.scheduleSnapTick(pushed.durationMs);
      }
    }
    this.emitRound(round);
  }

  private onHubSnapshot() {
    if (this.synthetic || !this.interpolator.isInitialized()) this.seedFromHub();
  }

  private seedFromHub() {
    const rounds = this.hub?.history(this.currentAsset) ?? [];
    const last = rounds[rounds.length - 1];
    if (!last) return;
    const now = this.now();
    const window = rounds.slice(-SEED_WINDOW_ROUNDS);
    const endMs = last.sec * 1000;
    const points: PriceTick[] = [];
    for (let i = this.maxHistorySize - 1; i >= 0; i--) {
      const atMs = endMs - i * this.displayTickMs;
      const price = priceAt(window, atMs);
      points.push({ price, timestamp: now - i * this.displayTickMs, change24h: this.change24h(price) });
    }
    this.history = points;
    this.currentPrice = last.price;
    this.lastExact = last;
    this.lastHubAtMs = now;
    this.lastPriceAtMs = now;
    this.synthetic = false;
    this.interpolator.reset(last.price, now);
    this.notify(points[points.length - 1]);
    this.emitStatus();
  }

  private onBinanceSample(sample: DisplaySample) {
    if (sample.asset !== this.currentAsset || this.source !== 'binance') return;
    const now = this.now();
    if (this.synthetic || !this.interpolator.isInitialized()) {
      this.history = Array.from({ length: MOCK_SEED_POINTS }, (_, index) => ({
        price: sample.price,
        timestamp: now - (MOCK_SEED_POINTS - 1 - index) * MOCK_SEED_SPACING_MS,
        change24h: this.change24h(sample.price),
      }));
      this.synthetic = false;
      this.currentPrice = sample.price;
      this.interpolator.reset(sample.price, now);
      return;
    }
    this.interpolator.push(sample.price, now);
  }

  private scheduleSnapTick(delayMs: number) {
    if (this.snapTimer !== null) clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => {
      this.snapTimer = null;
      if (this.interpolator.isInitialized()) this.handleNewTick(this.interpolator.sample(this.now()));
    }, delayMs);
  }

  private change24h(price: number): number {
    if (this.isUsingLiveFeed && this.source !== 'mock') return this.hub?.change24h(this.currentAsset) ?? 0;
    return ((price - this.basePrice24h) / this.basePrice24h) * 100;
  }

  private handleNewTick(rawPrice: number) {
    const liveExact = this.isUsingLiveFeed && this.source === 'hub' && this.lastExact !== null;
    if (!liveExact) this.currentPrice = rawPrice;
    const now = Date.now();
    this.lastPriceAtMs = now;

    const tick: PriceTick = {
      price: rawPrice,
      timestamp: now,
      change24h: this.change24h(rawPrice),
    };

    this.history.push(tick);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    this.notify(tick);
    if (this.source === 'mock') this.emitRound(this.mockRound(rawPrice, now));
  }

  private mockRound(price: number, now: number): ExactRound {
    return {
      asset: this.currentAsset,
      price,
      price18: toPrice18(price),
      sec: Math.floor(now / 1000),
      roundMs: now,
      tsMs: now,
      source: 'mock',
      lagMs: 0,
      receivedAtMs: now,
    };
  }

  private notify(tick: PriceTick) {
    this.listeners.forEach((fn) => fn(tick));
  }

  private emitRound(round: ExactRound) {
    for (const [listener, options] of [...this.roundListeners]) {
      const target = options.asset ?? this.currentAsset;
      if (target === 'all' || target === round.asset) listener(round);
    }
  }

  private emitStatus() {
    if (this.statusListeners.size === 0) return;
    const status = this.getStatus();
    const key = `${status.mode}|${status.asset}|${status.source}|${status.exact}|${status.stale}|${status.oracle}`;
    if (key === this.lastStatusKey) return;
    this.lastStatusKey = key;
    this.statusListeners.forEach((fn) => fn(status));
  }

  public cleanup() {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }
    if (this.displayTimer) {
      clearInterval(this.displayTimer);
      this.displayTimer = null;
    }
    if (this.snapTimer) {
      clearTimeout(this.snapTimer);
      this.snapTimer = null;
    }
    if (this.stopBinance) {
      this.stopBinance();
      this.stopBinance = null;
    }
    this.liveCleanups.forEach((stop) => stop());
    this.liveCleanups = [];
    this.lastHubAtMs = null;
  }
}

function priceAt(rounds: readonly ExactRound[], atMs: number): number {
  const first = rounds[0];
  if (!first) return 0;
  if (atMs <= first.sec * 1000) return first.price;
  for (let i = 1; i < rounds.length; i++) {
    const next = rounds[i];
    const prev = rounds[i - 1];
    const nextMs = next.sec * 1000;
    if (atMs <= nextMs) {
      const prevMs = prev.sec * 1000;
      const t = nextMs === prevMs ? 1 : (atMs - prevMs) / (nextMs - prevMs);
      return prev.price + (next.price - prev.price) * t;
    }
  }
  return rounds[rounds.length - 1].price;
}

export const marketFeed = new MarketFeedService();
