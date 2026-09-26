import type { z } from 'zod';
import { SSE_EVENTS, type SseEventName, type SsePayload } from '@bnbplay/shared/sse';

export interface EventMeta {
  id: string | null;
}

export type StreamListener<E extends SseEventName> = (payload: SsePayload<E>, meta: EventMeta) => void;

export type StreamEvent = { [E in SseEventName]: { type: E; payload: SsePayload<E>; id: string | null } }[SseEventName];

type UntypedListener = (payload: unknown, meta: EventMeta) => void;

export const isSseEventName = (name: string): name is SseEventName => Object.prototype.hasOwnProperty.call(SSE_EVENTS, name);

export function parseSsePayload<E extends SseEventName>(name: E, json: unknown): { ok: true; payload: SsePayload<E> } | { ok: false; error: z.ZodError } {
  const schema = SSE_EVENTS[name] as unknown as z.ZodType<SsePayload<E>>;
  const result = schema.safeParse(json);
  return result.success ? { ok: true, payload: result.data } : { ok: false, error: result.error };
}

export type DeliveryResult = { ok: true } | { ok: false; reason: 'unknown_event' | 'bad_json' | 'invalid_payload'; detail: string };

export class SseDispatcher {
  private readonly listeners = new Map<SseEventName, Set<UntypedListener>>();
  private readonly anyListeners = new Set<(event: StreamEvent) => void>();

  on<E extends SseEventName>(name: E, listener: StreamListener<E>): () => void {
    const set = this.listeners.get(name) ?? new Set<UntypedListener>();
    this.listeners.set(name, set);
    const untyped = listener as UntypedListener;
    set.add(untyped);
    return () => {
      set.delete(untyped);
    };
  }

  onAny(listener: (event: StreamEvent) => void): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  deliver<E extends SseEventName>(name: E, payload: SsePayload<E>, id: string | null): void {
    const meta: EventMeta = { id };
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(payload, meta);
    const event = { type: name, payload, id } as StreamEvent;
    for (const listener of [...this.anyListeners]) listener(event);
  }

  deliverRaw(name: string, data: string, id: string | null): DeliveryResult {
    if (!isSseEventName(name)) return { ok: false, reason: 'unknown_event', detail: name };
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return { ok: false, reason: 'bad_json', detail: name };
    }
    const parsed = parseSsePayload(name, json);
    if (!parsed.ok) return { ok: false, reason: 'invalid_payload', detail: `${name}: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` };
    this.deliver(name, parsed.payload, id);
    return { ok: true };
  }
}
