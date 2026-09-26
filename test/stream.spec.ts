import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerClock } from '../src/api/clock';
import { createSseParser, type SseMessage } from '../src/api/sse';
import { StreamClient, type StreamTransport, type StreamTransportRequest } from '../src/api/stream';

const helloFrame = (serverTimeMs: number) =>
  `event: hello\ndata: ${JSON.stringify({ v: 1, serverTimeMs, oracle: { source: 'supra-dora2', status: 'ok', lagMsP50: 400 }, player: null })}\n\n`;

const priceFrame = (sec: number, price = '612340000000000000000') =>
  `event: price\ndata: ${JSON.stringify({ asset: 'BNB', pairId: 49, round: String(sec * 1000), tsMs: sec * 1000 + 250, price, lagMs: 300 })}\n\n`;

const balanceFrame = (id: string, available: string) =>
  `id: ${id}\nevent: balance\ndata: ${JSON.stringify({ available, locked: '0' })}\n\n`;

describe('SSE parser', () => {
  it('handles CRLF split across chunks, comments, ids, retry and multi-line data', () => {
    const messages: SseMessage[] = [];
    const comments: string[] = [];
    const retries: number[] = [];
    const parser = createSseParser({ onMessage: (m) => messages.push(m), onComment: (c) => comments.push(c), onRetry: (r) => retries.push(r) });
    parser.push('﻿: ping\r');
    parser.push('\nretry: 2500\r\nid: 7\r\nevent: bal');
    parser.push('ance\r\ndata: {"a":\r\ndata: 1}\r\n\r');
    parser.push('\ndata: plain\n\n');
    parser.end();
    expect(comments).toEqual(['ping']);
    expect(retries).toEqual([2500]);
    expect(messages).toEqual([
      { event: 'balance', data: '{"a":\n1}', id: '7', lastEventId: '7' },
      { event: 'message', data: 'plain', id: null, lastEventId: '7' },
    ]);
  });

  it('drops a frame without data and ignores unknown fields', () => {
    const messages: SseMessage[] = [];
    const parser = createSseParser({ onMessage: (m) => messages.push(m) });
    parser.push('event: price\n\nfoo: bar\ndata: x\n\n');
    expect(messages).toEqual([{ event: 'message', data: 'x', id: null, lastEventId: '' }]);
  });
});

describe('ServerClock / serverNow', () => {
  it('anchors on the server time and advances on the monotonic clock', () => {
    let mono = 500;
    const clock = new ServerClock({ monotonic: () => mono, wall: () => 1_000 });
    expect(clock.isSynced()).toBe(false);
    expect(clock.now()).toBe(1_000);
    clock.sync(1_790_000_000_000, 500);
    mono = 1_750;
    expect(clock.now()).toBe(1_790_000_001_250);
    expect(clock.nowSec()).toBe(1_790_000_001);
    expect(clock.offsetMs()).toBe(1_790_000_001_250 - 1_000);
  });
});

interface Connection {
  request: StreamTransportRequest;
  push(chunk: string): void;
  close(): void;
}

function controlledTransport() {
  const connections: Connection[] = [];
  const transport: StreamTransport = async (request) => {
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const connection: Connection = {
      request,
      push(chunk) {
        queue.push(chunk);
        wake?.();
      },
      close() {
        closed = true;
        wake?.();
      },
    };
    request.signal.addEventListener('abort', () => connection.close());
    connections.push(connection);
    async function* chunks(): AsyncGenerator<string> {
      for (;;) {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next !== undefined) yield next;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    }
    return chunks();
  };
  return { transport, connections };
}

describe('StreamClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches typed, validated events and syncs serverNow from hello', async () => {
    const { transport, connections } = controlledTransport();
    let mono = 0;
    const client = new StreamClient({ baseUrl: 'https://api.test', transport, clock: new ServerClock({ monotonic: () => mono }), monotonic: () => mono });
    const prices: string[] = [];
    const errors: unknown[] = [];
    client.on('price', (payload) => prices.push(payload.price));
    client.onError((error) => errors.push(error));
    const release = client.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status()).toBe('open');
    expect(connections[0].request.url).toBe('https://api.test/v1/stream');

    mono = 10;
    connections[0].push(helloFrame(1_790_000_000_000));
    await vi.advanceTimersByTimeAsync(0);
    mono = 510;
    expect(client.serverNow()).toBe(1_790_000_000_500);

    connections[0].push(priceFrame(1_790_000_000));
    connections[0].push('event: price\ndata: {"asset":"XRP"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(prices).toEqual(['612340000000000000000']);
    expect(errors).toHaveLength(1);
    release();
    expect(client.status()).toBe('closed');
  });

  it('reconnects with backoff, sends Last-Event-ID and drops replayed player events', async () => {
    const { transport, connections } = controlledTransport();
    const client = new StreamClient({ baseUrl: 'https://api.test', transport, backoff: { initialMs: 1000, jitter: 0 } });
    const balances: string[] = [];
    client.on('balance', (payload) => balances.push(payload.available));
    client.setPlayer('0xAbC0000000000000000000000000000000000001');
    client.retain();
    await vi.advanceTimersByTimeAsync(0);
    expect(connections[0].request.url).toBe('https://api.test/v1/stream?player=0xabc0000000000000000000000000000000000001');
    expect(connections[0].request.headers).toEqual({});

    connections[0].push(balanceFrame('41', '1000'));
    connections[0].push(balanceFrame('42', '2000'));
    await vi.advanceTimersByTimeAsync(0);
    connections[0].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.status()).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(2);
    expect(connections[1].request.headers).toEqual({ 'Last-Event-ID': '42' });

    connections[1].push(balanceFrame('42', '2000'));
    connections[1].push(balanceFrame('43', '3000'));
    await vi.advanceTimersByTimeAsync(0);
    expect(balances).toEqual(['1000', '2000', '3000']);

    connections[1].close();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1999);
    expect(connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connections).toHaveLength(3);
    client.stop();
  });

  it('resets backoff after a hello and restarts on player change', async () => {
    const { transport, connections } = controlledTransport();
    const client = new StreamClient({ baseUrl: 'https://api.test', transport, backoff: { initialMs: 1000, jitter: 0 } });
    client.retain();
    await vi.advanceTimersByTimeAsync(0);
    connections[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    connections[1].push(helloFrame(Date.now()));
    await vi.advanceTimersByTimeAsync(0);
    connections[1].close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connections).toHaveLength(3);

    client.setPlayer('0x00000000000000000000000000000000000000aa');
    await vi.advanceTimersByTimeAsync(0);
    expect(connections).toHaveLength(4);
    expect(connections[3].request.url).toContain('player=0x00000000000000000000000000000000000000aa');
    client.stop();
  });

  it('aborts an idle connection so a silent proxy never freezes the feed', async () => {
    const { transport, connections } = controlledTransport();
    const client = new StreamClient({ baseUrl: 'https://api.test', transport, idleTimeoutMs: 45_000, backoff: { initialMs: 500, jitter: 0 } });
    client.retain();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    connections[0].push(': ping\n\n');
    await vi.advanceTimersByTimeAsync(44_000);
    expect(connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(connections).toHaveLength(2);
    client.stop();
  });

  it('never connects without a configured base URL', () => {
    const transport = vi.fn<StreamTransport>();
    const client = new StreamClient({ baseUrl: null, transport });
    client.retain();
    expect(transport).not.toHaveBeenCalled();
    expect(client.isConfigured()).toBe(false);
  });
});
