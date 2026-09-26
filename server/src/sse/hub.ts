// SSE hub for GET /v1/stream (F1b §SSE). One connection per browser carries the
// public events (all assets) and that player's events. Player events are
// validated, persisted to player_events (their id is the SSE id) and fanned out;
// a reconnect with Last-Event-ID replays everything after that id. Public events
// carry no id. `hello` + `prices.snapshot` open every connection; `: ping` every 15 s.

import type { SSEStreamingApi } from 'hono/streaming';
import type { Address } from 'viem';
import { ASSETS } from '@bnbplay/shared/assets';
import { RoundSchema, type RoundDTO } from '@bnbplay/shared/dto';
import { SSE_EVENTS, type SseEventName, type SsePayload } from '@bnbplay/shared/sse';
import type { Bus, BusEvents } from '../bus.ts';
import type { PriceHub, RoundBook } from '../ports.ts';
import type { MarketData, RoundHistory } from '../api/deps.ts';
import { ApiError } from '../api/errors.ts';
import { silentLogger, type Logger } from '../api/log.ts';
import { decimalTo18 } from '../api/units.ts';
import type { PlayerEventStore } from './store.ts';

export interface SseHubDeps {
  bus: Bus;
  store: PlayerEventStore;
  priceHub: PriceHub;
  roundBook: RoundBook;
  /** Fallback for `hello.player.lastSettled` once events have aged out. */
  history?: RoundHistory;
  marketData?: MarketData;
  now?: () => number;
  log?: Logger;
  pingMs?: number;
  retentionMs?: number;
  pruneEveryMs?: number;
  maxPerIp?: number;
  maxTotal?: number;
  /** Queued writes after which a connection counts as stuck and is dropped (the client reconnects and replays). */
  maxPendingWrites?: number;
  /** Only the leader prunes the shared table. */
  isLeader?: () => boolean;
}

interface Frame {
  event: string;
  data: string;
  id?: number;
}

interface Conn {
  id: number;
  /** Lowercase key for fan-out; `address` keeps the checksummed form for port calls. */
  player: string | null;
  address: Address | null;
  ipHash: string;
  stream: SSEStreamingApi;
  replaying: boolean;
  buffer: Frame[];
  lastSentId: number;
  pending: number;
  closed: boolean;
  resolve: () => void;
}

export interface SseSlot {
  ipHash: string;
  release(): void;
}

const REPLAY_PAGE = 200;
const REPLAY_MAX_PAGES = 10;

const formatFrame = (f: Frame): string => `event: ${f.event}\n${f.id !== undefined ? `id: ${f.id}\n` : ''}data: ${f.data}\n\n`;

export class SseHub {
  private readonly deps: SseHubDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly conns = new Set<Conn>();
  private readonly byPlayer = new Map<string, Set<Conn>>();
  private readonly perIp = new Map<string, number>();
  private reserved = 0;
  private nextConnId = 1;
  private persistTail: Promise<void> = Promise.resolve();
  private unsubs: (() => void)[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private invalidLogged = new Set<string>();

  constructor(deps: SseHubDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
  }

  start(): void {
    if (this.unsubs.length) return;
    this.unsubs.push(
      this.deps.bus.on('player.event', (e) => this.onPlayerEvent(e)),
      this.deps.bus.on('public.event', (e) => this.onPublicEvent(e)),
    );
    const ping = setInterval(() => this.ping(), this.deps.pingMs ?? 15_000);
    const prune = setInterval(() => void this.prune(), this.deps.pruneEveryMs ?? 5 * 60_000);
    ping.unref?.();
    prune.unref?.();
    this.timers.push(ping, prune);
  }

  async stop(): Promise<void> {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.persistTail;
    for (const conn of [...this.conns]) {
      this.drop(conn);
      void conn.stream.close();
    }
  }

  stats(): { connections: number; players: number } {
    return { connections: this.conns.size, players: this.byPlayer.size };
  }

  /** Reserves a connection slot (≤ 3 per IP hash, ≤ 2000 total) or throws RATE_LIMITED. */
  reserve(ipHash: string): SseSlot {
    const perIp = this.perIp.get(ipHash) ?? 0;
    if (perIp >= (this.deps.maxPerIp ?? 3)) throw new ApiError('RATE_LIMITED', 'too many open streams from this network', { retryAfterMs: 5_000 });
    if (this.reserved >= (this.deps.maxTotal ?? 2000)) throw new ApiError('RATE_LIMITED', 'stream capacity reached', { retryAfterMs: 10_000 });
    this.perIp.set(ipHash, perIp + 1);
    this.reserved++;
    let released = false;
    return {
      ipHash,
      release: () => {
        if (released) return;
        released = true;
        this.reserved--;
        const n = (this.perIp.get(ipHash) ?? 1) - 1;
        if (n <= 0) this.perIp.delete(ipHash);
        else this.perIp.set(ipHash, n);
      },
    };
  }

  /** Runs one SSE connection until the client goes away (or the hub stops). */
  async serve(stream: SSEStreamingApi, opts: { player: Address | null; lastEventId: number | null; slot: SseSlot }): Promise<void> {
    const player = opts.player ? opts.player.toLowerCase() : null;
    const done = new Promise<void>((resolve) => {
      const conn: Conn = {
        id: this.nextConnId++,
        player,
        address: opts.player,
        ipHash: opts.slot.ipHash,
        stream,
        replaying: true,
        buffer: [],
        lastSentId: opts.lastEventId ?? 0,
        pending: 0,
        closed: false,
        resolve,
      };
      this.register(conn);
      stream.onAbort(() => {
        this.drop(conn);
        opts.slot.release();
      });
      void this.open(conn, opts.lastEventId);
    });
    try {
      await done;
    } finally {
      opts.slot.release();
    }
  }

  private async open(conn: Conn, lastEventId: number | null): Promise<void> {
    try {
      this.write(conn, 'retry: 3000\n\n');
      this.write(conn, { event: 'hello', data: JSON.stringify(await this.hello(conn.address)) });
      this.write(conn, { event: 'prices.snapshot', data: JSON.stringify(this.snapshot()) });
      if (conn.player && lastEventId !== null) {
        let after = lastEventId;
        for (let page = 0; page < REPLAY_MAX_PAGES && !conn.closed; page++) {
          const rows = await this.deps.store.since(conn.player, after, REPLAY_PAGE);
          for (const r of rows) {
            this.write(conn, { event: r.event, data: JSON.stringify(r.payload), id: r.id });
            after = r.id;
          }
          if (rows.length < REPLAY_PAGE) break;
        }
        conn.lastSentId = after;
      }
    } catch (err) {
      this.log.warn('sse connect setup failed', { err: String(err) });
    } finally {
      conn.replaying = false;
      const buffered = conn.buffer;
      conn.buffer = [];
      for (const f of buffered) this.deliver(conn, f);
    }
  }

  private register(conn: Conn): void {
    this.conns.add(conn);
    if (conn.player) {
      let set = this.byPlayer.get(conn.player);
      if (!set) this.byPlayer.set(conn.player, (set = new Set()));
      set.add(conn);
    }
  }

  private drop(conn: Conn): void {
    if (conn.closed) return;
    conn.closed = true;
    this.conns.delete(conn);
    if (conn.player) {
      const set = this.byPlayer.get(conn.player);
      set?.delete(conn);
      if (set && set.size === 0) this.byPlayer.delete(conn.player);
    }
    conn.resolve();
  }

  private write(conn: Conn, frame: Frame | string): void {
    if (conn.closed) return;
    if (conn.pending >= (this.deps.maxPendingWrites ?? 512)) {
      this.log.warn('dropping stuck sse connection', { conn: conn.id });
      this.drop(conn);
      void conn.stream.close();
      return;
    }
    conn.pending++;
    void conn.stream.write(typeof frame === 'string' ? frame : formatFrame(frame)).finally(() => {
      conn.pending--;
    });
  }

  private deliver(conn: Conn, frame: Frame): void {
    if (conn.replaying) {
      conn.buffer.push(frame);
      return;
    }
    if (frame.id !== undefined) {
      if (frame.id <= conn.lastSentId) return; // already replayed
      conn.lastSentId = frame.id;
    }
    this.write(conn, frame);
  }

  private validate<E extends SseEventName>(event: E, payload: unknown): SsePayload<E> | null {
    const schema = SSE_EVENTS[event];
    if (!schema) return null;
    const parsed = schema.safeParse(payload);
    if (parsed.success) return parsed.data as SsePayload<E>;
    if (!this.invalidLogged.has(event)) {
      this.invalidLogged.add(event);
      this.log.error('dropping sse event that fails its schema', { event, issues: parsed.error.issues.slice(0, 3) });
    }
    return null;
  }

  private onPublicEvent(e: BusEvents['public.event']): void {
    const payload = this.validate(e.event, e.payload);
    if (!payload) return;
    const frame: Frame = { event: e.event, data: JSON.stringify(payload) };
    for (const conn of this.conns) this.deliver(conn, frame);
  }

  private onPlayerEvent(e: BusEvents['player.event']): void {
    const payload = this.validate(e.event, e.payload);
    if (!payload) return;
    const player = e.player.toLowerCase();
    const event = e.event;
    // One chain keeps ids (and therefore replay order) identical to fan-out order.
    this.persistTail = this.persistTail.then(async () => {
      let id: number | undefined;
      try {
        id = (await this.deps.store.append(player, event, payload)).id;
      } catch (err) {
        this.log.error('player event persist failed; delivering without id', { event, err: String(err) });
      }
      const frame: Frame = { event, data: JSON.stringify(payload), ...(id !== undefined ? { id } : {}) };
      for (const conn of this.byPlayer.get(player) ?? []) this.deliver(conn, frame);
    });
  }

  private ping(): void {
    for (const conn of this.conns) if (!conn.replaying) this.write(conn, ': ping\n\n');
  }

  private async prune(): Promise<void> {
    if (this.deps.isLeader && !this.deps.isLeader()) return;
    try {
      await this.deps.store.prune(this.now() - (this.deps.retentionMs ?? 3_600_000));
    } catch (err) {
      this.log.warn('player event prune failed', { err: String(err) });
    }
  }

  private async hello(addr: Address | null): Promise<SsePayload<'hello'>> {
    const st = this.deps.priceHub.status();
    const base = { v: 1 as const, serverTimeMs: this.now(), oracle: { source: 'supra-dora2' as const, status: st.status, lagMsP50: st.lagMsP50 } };
    if (!addr) return { ...base, player: null };
    const player = addr.toLowerCase();
    const active = this.deps.roundBook.activeFor(addr);
    const activeRound = active && active.status === 'open' ? validRound(this.deps.roundBook.toDTO(active.roundId)) : null;
    const candidates: RoundDTO[] = [];
    const ev = await this.deps.store.latest(player, 'round.settled').catch(() => null);
    const fromEvent = validRound(ev?.payload);
    if (fromEvent) candidates.push(fromEvent);
    if (this.deps.history) {
      const [fromHistory] = await this.deps.history.listForPlayer(addr, { limit: 1 }).catch(() => []);
      const valid = validRound(fromHistory);
      if (valid) candidates.push(valid);
    }
    const lastSettled = candidates.sort((a, b) => (BigInt(b.roundId) > BigInt(a.roundId) ? 1 : -1))[0] ?? null;
    return { ...base, player: { activeRound, lastSettled } };
  }

  private snapshot(): SsePayload<'prices.snapshot'> {
    const assets: SsePayload<'prices.snapshot'>['assets'] = {};
    const stats: SsePayload<'prices.snapshot'>['stats'] = {};
    for (const a of ASSETS) {
      const rounds = [...this.deps.priceHub.history(a.supraPairId, 120)].sort((x, y) => x.sec - y.sec);
      assets[a.symbol] = {
        pairId: a.supraPairId,
        rounds: rounds.map((r) => [r.roundMs.toString(), r.tsMs, r.price18.toString()] as [string, number, string]),
      };
      const t = this.deps.marketData?.cachedTicker24h(a.symbol);
      stats[a.symbol] = {
        open24h: decimalTo18(t?.openPrice),
        change24hPct: t ? t.changePct : null,
        high24h: decimalTo18(t?.highPrice),
        low24h: decimalTo18(t?.lowPrice),
      };
    }
    return { assets, stats };
  }
}

function validRound(v: unknown): RoundDTO | null {
  if (!v) return null;
  const parsed = RoundSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}
