import type { SseEventName } from '@bnbplay/shared/sse';
import { ServerClock } from './clock';
import { SseDispatcher, type DeliveryResult, type StreamEvent, type StreamListener } from './dispatcher';
import { ApiError } from './errors';
import { createSseParser, type SseMessage } from './sse';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StreamLike {
  on<E extends SseEventName>(name: E, listener: StreamListener<E>): () => void;
  onAny(listener: (event: StreamEvent) => void): () => void;
  onStatus(listener: (status: StreamStatus) => void): () => void;
  status(): StreamStatus;
  retain(): () => void;
  setPlayer(address: string | null): void;
  player(): string | null;
  serverNow(): number;
  isConfigured(): boolean;
}

export interface StreamTransportRequest {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export type StreamTransport = (request: StreamTransportRequest) => Promise<AsyncIterable<string>>;

async function* decodeBody(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export const fetchStreamTransport: StreamTransport = async ({ url, headers, signal }) => {
  const response = await fetch(url, { headers: { Accept: 'text/event-stream', ...headers }, signal, cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new ApiError('NETWORK', `stream responded ${response.status}`, { status: response.status });
  }
  return decodeBody(response.body);
};

export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 500, maxMs: 15_000, factor: 2, jitter: 0.3 };

export interface StreamClientOptions {
  baseUrl: string | null;
  transport?: StreamTransport;
  clock?: ServerClock;
  backoff?: Partial<BackoffOptions>;
  idleTimeoutMs?: number;
  random?: () => number;
  monotonic?: () => number;
}

const SEEN_ID_LIMIT = 512;

export class StreamClient implements StreamLike {
  private readonly dispatcher = new SseDispatcher();
  private readonly statusListeners = new Set<(status: StreamStatus) => void>();
  private readonly errorListeners = new Set<(error: DeliveryResult | Error) => void>();
  private readonly transport: StreamTransport;
  private readonly clock: ServerClock;
  private readonly backoff: BackoffOptions;
  private readonly idleTimeoutMs: number;
  private readonly random: () => number;
  private readonly monotonic: () => number;
  private readonly baseUrl: string | null;

  private currentStatus: StreamStatus = 'idle';
  private refs = 0;
  private generation = 0;
  private running = false;
  private attempt = 0;
  private retryBaseMs: number;
  private lastEventId: string | null = null;
  private playerAddress: string | null = null;
  private seenIds = new Set<string>();
  private seenOrder: string[] = [];
  private abort: AbortController | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private wake: (() => void) | null = null;

  constructor(options: StreamClientOptions) {
    this.baseUrl = options.baseUrl;
    this.transport = options.transport ?? fetchStreamTransport;
    this.clock = options.clock ?? new ServerClock();
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.retryBaseMs = this.backoff.initialMs;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
    this.random = options.random ?? Math.random;
    this.monotonic = options.monotonic ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.dispatcher.on('hello', (hello) => {
      this.clock.sync(hello.serverTimeMs, this.monotonic());
      this.attempt = 0;
      this.retryBaseMs = this.backoff.initialMs;
    });
  }

  on<E extends SseEventName>(name: E, listener: StreamListener<E>): () => void {
    return this.dispatcher.on(name, listener);
  }

  onAny(listener: (event: StreamEvent) => void): () => void {
    return this.dispatcher.onAny(listener);
  }

  onStatus(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onError(listener: (error: DeliveryResult | Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  status(): StreamStatus {
    return this.currentStatus;
  }

  isConfigured(): boolean {
    return this.baseUrl !== null;
  }

  serverNow(): number {
    return this.clock.now();
  }

  getLastEventId(): string | null {
    return this.lastEventId;
  }

  player(): string | null {
    return this.playerAddress;
  }

  retain(): () => void {
    this.refs++;
    if (this.refs === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) this.stop();
    };
  }

  setPlayer(address: string | null): void {
    const normalized = address ? address.toLowerCase() : null;
    if (normalized === this.playerAddress) return;
    this.playerAddress = normalized;
    this.lastEventId = null;
    this.seenIds = new Set();
    this.seenOrder = [];
    if (this.running) this.restart();
  }

  start(): void {
    if (this.running || !this.baseUrl) return;
    this.running = true;
    this.attempt = 0;
    const generation = ++this.generation;
    void this.run(generation);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    this.clearIdle();
    this.wake?.();
    this.setStatus('closed');
  }

  private restart(): void {
    this.stop();
    this.start();
  }

  private buildUrl(): string {
    const url = `${this.baseUrl ?? ''}/v1/stream`;
    return this.playerAddress ? `${url}?player=${encodeURIComponent(this.playerAddress)}` : url;
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private async run(generation: number): Promise<void> {
    while (this.isCurrent(generation)) {
      const controller = new AbortController();
      this.abort = controller;
      this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        const headers: Record<string, string> = this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {};
        const chunks = await this.transport({ url: this.buildUrl(), headers, signal: controller.signal });
        if (!this.isCurrent(generation)) break;
        this.setStatus('open');
        this.armIdle(controller);
        const parser = createSseParser({
          onMessage: (message) => this.handleMessage(message),
          onComment: () => this.armIdle(controller),
          onRetry: (delayMs) => {
            this.retryBaseMs = delayMs;
          },
        });
        for await (const chunk of chunks) {
          if (!this.isCurrent(generation)) break;
          this.armIdle(controller);
          parser.push(chunk);
        }
        parser.end();
      } catch (error) {
        if (this.isCurrent(generation) && !controller.signal.aborted) {
          this.emitError(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        this.clearIdle();
      }
      if (!this.isCurrent(generation)) break;
      this.setStatus('reconnecting');
      await this.sleep(this.nextDelayMs(), generation);
    }
  }

  private nextDelayMs(): number {
    const raw = Math.min(this.backoff.maxMs, this.retryBaseMs * this.backoff.factor ** this.attempt);
    this.attempt++;
    const spread = raw * this.backoff.jitter;
    return Math.max(0, Math.round(raw - spread + this.random() * 2 * spread));
  }

  private sleep(ms: number, generation: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      if (!this.isCurrent(generation)) this.wake();
    });
  }

  private armIdle(controller: AbortController): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => controller.abort(), this.idleTimeoutMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private rememberId(id: string): boolean {
    if (this.seenIds.has(id)) return false;
    this.seenIds.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > SEEN_ID_LIMIT) {
      const dropped = this.seenOrder.shift();
      if (dropped !== undefined) this.seenIds.delete(dropped);
    }
    return true;
  }

  private handleMessage(message: SseMessage): void {
    if (message.id !== null) {
      this.lastEventId = message.id;
      if (!this.rememberId(message.id)) return;
    }
    const result = this.dispatcher.deliverRaw(message.event, message.data, message.id);
    if (!result.ok) this.emitError(result);
  }

  private setStatus(status: StreamStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  private emitError(error: DeliveryResult | Error): void {
    for (const listener of [...this.errorListeners]) listener(error);
  }
}
