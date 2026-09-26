import type { SseEventName, SsePayload } from '@bnbplay/shared/sse';
import { ServerClock } from './clock';
import { SseDispatcher, parseSsePayload, type StreamEvent, type StreamListener } from './dispatcher';
import type { StreamLike, StreamStatus } from './stream';

export interface FakeStreamOptions {
  clock?: ServerClock;
  onRetain?: () => void;
  onRelease?: () => void;
  onPlayer?: (address: string | null) => void;
}

export class FakeStream implements StreamLike {
  readonly clock: ServerClock;
  private readonly dispatcher = new SseDispatcher();
  private readonly statusListeners = new Set<(status: StreamStatus) => void>();
  private currentStatus: StreamStatus = 'idle';
  private refs = 0;
  private nextId = 1;
  private playerAddress: string | null = null;
  private readonly options: FakeStreamOptions;
  readonly emitted: StreamEvent[] = [];

  constructor(options: FakeStreamOptions = {}) {
    this.options = options;
    this.clock = options.clock ?? new ServerClock();
    this.dispatcher.on('hello', (hello) => this.clock.sync(hello.serverTimeMs));
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

  status(): StreamStatus {
    return this.currentStatus;
  }

  isConfigured(): boolean {
    return true;
  }

  serverNow(): number {
    return this.clock.now();
  }

  player(): string | null {
    return this.playerAddress;
  }

  refCount(): number {
    return this.refs;
  }

  retain(): () => void {
    this.refs++;
    if (this.refs === 1) {
      this.setStatus('open');
      this.options.onRetain?.();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) {
        this.setStatus('closed');
        this.options.onRelease?.();
      }
    };
  }

  setPlayer(address: string | null): void {
    const normalized = address ? address.toLowerCase() : null;
    if (normalized === this.playerAddress) return;
    this.playerAddress = normalized;
    this.options.onPlayer?.(normalized);
  }

  setStatus(status: StreamStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of [...this.statusListeners]) listener(status);
  }

  emit<E extends SseEventName>(name: E, payload: SsePayload<E>, options: { id?: string | null } = {}): void {
    const parsed = parseSsePayload(name, JSON.parse(JSON.stringify(payload)));
    if (!parsed.ok) throw new Error(`FakeStream: invalid ${name} payload: ${parsed.error.message}`);
    const id = options.id === undefined ? this.defaultId(name) : options.id;
    this.emitted.push({ type: name, payload: parsed.payload, id } as StreamEvent);
    this.dispatcher.deliver(name, parsed.payload, id);
  }

  emitRaw(name: string, data: string, id: string | null = null): ReturnType<SseDispatcher['deliverRaw']> {
    return this.dispatcher.deliverRaw(name, data, id);
  }

  private defaultId(name: SseEventName): string | null {
    const isPublic = name === 'hello' || name === 'prices.snapshot' || name === 'price' || name === 'stats' || name === 'oracle.status';
    return isPublic ? null : String(this.nextId++);
  }
}
