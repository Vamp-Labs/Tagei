import { AssetSymbol, PriceTick, SUPPORTED_ASSETS } from '../types/market';

type TickListener = (tick: PriceTick) => void;

class MarketFeedService {
  private currentAsset: AssetSymbol = 'BNB';
  private ws: WebSocket | null = null;
  private listeners: Set<TickListener> = new Set();
  private mockInterval: ReturnType<typeof setInterval> | null = null;
  private currentPrice: number;
  private basePrice24h: number;
  private isUsingLiveFeed: boolean = true;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private history: PriceTick[] = [];
  private maxHistorySize: number = 100;

  constructor() {
    this.currentPrice = SUPPORTED_ASSETS['BNB'].basePrice;
    this.basePrice24h = this.currentPrice * 0.9786; // mock +2.14% baseline
    this.initHistory();
  }

  private initHistory() {
    const now = Date.now();
    this.history = [];
    let p = this.currentPrice;
    const vol = SUPPORTED_ASSETS[this.currentAsset].volatility;
    
    // Seed initial historical points
    for (let i = 40; i >= 0; i--) {
      const delta = (Math.random() - 0.49) * (p * vol * 0.5);
      p = Math.max(1, p + delta);
      this.history.push({
        price: p,
        timestamp: now - i * 400,
        change24h: ((p - this.basePrice24h) / this.basePrice24h) * 100,
      });
    }
    this.currentPrice = p;
  }

  public setAsset(asset: AssetSymbol, useLive: boolean = true) {
    if (this.currentAsset === asset && this.isUsingLiveFeed === useLive) return;
    
    this.currentAsset = asset;
    this.isUsingLiveFeed = useLive;
    this.currentPrice = SUPPORTED_ASSETS[asset].basePrice;
    this.basePrice24h = this.currentPrice * 0.98;
    this.initHistory();
    this.connect();
  }

  public setLiveMode(useLive: boolean) {
    this.isUsingLiveFeed = useLive;
    this.connect();
  }

  public subscribe(listener: TickListener): () => void {
    this.listeners.add(listener);
    // Emit immediate current tick
    listener({
      price: this.currentPrice,
      timestamp: Date.now(),
      change24h: ((this.currentPrice - this.basePrice24h) / this.basePrice24h) * 100,
    });
    return () => this.listeners.delete(listener);
  }

  public getCurrentPrice(): number {
    return this.currentPrice;
  }

  public getHistory(): PriceTick[] {
    return [...this.history];
  }

  public getCurrentAsset(): AssetSymbol {
    return this.currentAsset;
  }

  public pushPriceDelta(pctDelta: number) {
    const delta = this.currentPrice * (pctDelta / 100);
    const nextPrice = Math.max(0.0001, this.currentPrice + delta);
    this.handleNewTick(nextPrice);
  }

  public connect() {
    this.cleanup();

    if (!this.isUsingLiveFeed || typeof WebSocket === 'undefined') {
      this.startMockFeed();
      return;
    }

    try {
      const pair = SUPPORTED_ASSETS[this.currentAsset].binancePair;
      // Connect to Binance trade stream
      const wsUrl = `wss://stream.binance.com:9443/ws/${pair}@trade`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Connected to Binance Live Stream
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.p) {
            const rawPrice = parseFloat(data.p);
            this.handleNewTick(rawPrice);
          }
        } catch {
          // JSON parsing error
        }
      };

      this.ws.onerror = () => {
        // Fallback to simulated feed on network or CORS restrictions
        this.fallbackToMock();
      };

      this.ws.onclose = () => {
        // Auto-reconnect or fallback
        if (this.isUsingLiveFeed) {
          this.reconnectTimeout = setTimeout(() => this.connect(), 4000);
        }
      };
    } catch {
      this.fallbackToMock();
    }
  }

  private fallbackToMock() {
    this.startMockFeed();
  }

  private startMockFeed() {
    if (this.mockInterval) return;
    
    const asset = SUPPORTED_ASSETS[this.currentAsset];
    const vol = asset.volatility;

    // Simulate high-frequency market noise and momentum
    let momentum = (Math.random() - 0.48) * 0.001;

    this.mockInterval = setInterval(() => {
      // Gentle mean-reverting momentum drift
      momentum = momentum * 0.94 + (Math.random() - 0.495) * (vol * 0.6);
      const delta = this.currentPrice * momentum;
      const nextPrice = Math.max(0.0001, this.currentPrice + delta);
      this.handleNewTick(nextPrice);
    }, 250);
  }

  private handleNewTick(rawPrice: number) {
    this.currentPrice = rawPrice;
    const now = Date.now();
    const change24h = ((rawPrice - this.basePrice24h) / this.basePrice24h) * 100;
    
    const tick: PriceTick = {
      price: rawPrice,
      timestamp: now,
      change24h,
    };

    this.history.push(tick);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    this.listeners.forEach((fn) => fn(tick));
  }

  public cleanup() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

export const marketFeed = new MarketFeedService();
