import { SUPPORTED_ASSETS, type AssetSymbol } from '../../types/market';

export interface SocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface DisplaySample {
  asset: AssetSymbol;
  price: number;
  tsMs: number;
}

export interface BinanceDisplaySourceOptions {
  createSocket?: SocketFactory | null;
  sampleMs?: number;
  reconnectMs?: number;
  streamUrl?: (pair: string) => string;
}

const defaultStreamUrl = (pair: string) => `wss://stream.binance.com:9443/ws/${pair}@trade`;

function browserSocketFactory(): SocketFactory | null {
  if (typeof WebSocket === 'undefined') return null;
  return (url) => {
    const ws = new WebSocket(url);
    const socket: SocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: () => ws.close(),
    };
    ws.onopen = (event) => socket.onopen?.(event);
    ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
    ws.onerror = (event) => socket.onerror?.(event);
    ws.onclose = (event) => socket.onclose?.(event);
    return socket;
  };
}

function parseTrade(data: unknown): { price: number; tsMs: number } | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== 'object' || parsed === null || !('p' in parsed)) return null;
    const price = typeof parsed.p === 'string' ? Number.parseFloat(parsed.p) : Number.NaN;
    const tsMs = 'T' in parsed && typeof parsed.T === 'number' ? parsed.T : Date.now();
    return Number.isFinite(price) && price > 0 ? { price, tsMs } : null;
  } catch {
    return null;
  }
}

export class BinanceDisplaySource {
  private readonly createSocket: SocketFactory | null;
  private readonly sampleMs: number;
  private readonly reconnectMs: number;
  private readonly streamUrl: (pair: string) => string;

  constructor(options: BinanceDisplaySourceOptions = {}) {
    this.createSocket = options.createSocket === undefined ? browserSocketFactory() : options.createSocket;
    this.sampleMs = options.sampleMs ?? 1000;
    this.reconnectMs = options.reconnectMs ?? 4000;
    this.streamUrl = options.streamUrl ?? defaultStreamUrl;
  }

  isAvailable(): boolean {
    return this.createSocket !== null;
  }

  start(asset: AssetSymbol, onSample: (sample: DisplaySample) => void): () => void {
    const factory = this.createSocket;
    if (!factory) return () => undefined;
    let socket: SocketLike | null = null;
    let stopped = false;
    let pending: { price: number; tsMs: number } | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const flush = setInterval(() => {
      if (!pending) return;
      const sample = pending;
      pending = null;
      onSample({ asset, price: sample.price, tsMs: sample.tsMs });
    }, this.sampleMs);

    const open = () => {
      if (stopped) return;
      socket = factory(this.streamUrl(SUPPORTED_ASSETS[asset].binancePair));
      socket.onmessage = (event) => {
        const trade = parseTrade(event.data);
        if (trade) pending = trade;
      };
      socket.onerror = () => undefined;
      socket.onclose = () => {
        socket = null;
        if (!stopped) reconnect = setTimeout(open, this.reconnectMs);
      };
    };
    open();

    return () => {
      stopped = true;
      clearInterval(flush);
      if (reconnect !== null) clearTimeout(reconnect);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        socket = null;
      }
    };
  }
}
