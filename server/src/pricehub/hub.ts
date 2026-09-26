// Supra DORA-2 price hub (PriceHub port).
//
// Polls POST {SUPRA_REST_URL}/get_proof for the 5 pairs at 5 Hz, phase-aligned to +150,
// +350, … +950 ms into each second (rounds appear +0.2–0.65 s after the round start,
// spike-report §2), with a few ms of jitter, never overlapping, with exponential backoff.
// Every proof is archived (dedupe by hash); each new canonical round is emitted once and in
// order per pair on `oracle.round`, plus `price` / `stats` / `oracle.status` public events.
// Health: ok while the newest round of every pair is < ORACLE_STALE_MS old, degraded < 10 s.

import { keccak256, type Hex } from 'viem';
import { ASSETS, SUPRA_PAIR_IDS, assetByPair, type AssetSymbol } from '@bnbplay/shared/assets';
import { decodeSupraProof, isCanonicalRound, toPrice18 } from '@bnbplay/shared/supra';
import type { Bus } from '../bus.ts';
import type { OracleRound, OracleStatus, PriceHub } from '../ports.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import { ProofIndex, RoundRing } from './ring.ts';
import { EwmaSigma, backtestTouchRates, bipowerSigmaPpm, momentumPpm, percentile, plainSigmaPpm, type TouchRates } from './stats.ts';
import { MemoryOracleStore, type OracleStore } from './store.ts';

export const DEGRADED_AFTER_MS = 10_000;
const WINDOW_SEC = 30 * 60;
const TRACKED = new Set<number>(SUPRA_PAIR_IDS);

export class SecondMissedError extends Error {
  constructor(
    readonly pairId: number,
    readonly sec: number,
  ) {
    super(`round ${sec} of pair ${pairId} was never observed (a newer round arrived first)`);
    this.name = 'SecondMissedError';
  }
}

export class WaitTimeoutError extends Error {
  constructor(
    readonly pairId: number,
    readonly sec: number,
  ) {
    super(`timed out waiting for round ${sec} of pair ${pairId}`);
    this.name = 'WaitTimeoutError';
  }
}

export interface MarketStats {
  change24hPct(asset: AssetSymbol): number | null;
}

export interface ProofArchive {
  /** A captured proof that carries (pairId, sec): memory first, then the shared archive. */
  find(pairId: number, sec: number): Promise<{ proof: Hex; proofHash: Hex } | undefined>;
  getProof(hash: Hex): Promise<Hex | undefined>;
  markReferenced(hashes: Hex[], txHash: Hex): Promise<void>;
}

export interface ProofEvent {
  hash: Hex;
  proof: Hex;
  rounds: OracleRound[];
}

export interface PriceHubOptions {
  restUrl: string;
  pollMs: number;
  staleMs: number;
  proofRetentionH: number;
  roundRetentionD: number;
  bus?: Bus;
  store?: OracleStore;
  market?: MarketStats;
  log?: Logger;
  /** `leader` publishes events; `archiver` only captures and archives (ROLE=archiver, P1). */
  role?: 'leader' | 'archiver';
  /** Written to oracle_proofs.source. */
  instanceId?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  jitterMs?: number;
  /** First poll offset inside each second (ms). */
  phaseMs?: number;
  statsEveryMs?: number;
  summaryEveryMs?: number;
  pruneEveryMs?: number;
  now?: () => number;
}

export interface HubMetrics {
  startedAtMs: number;
  polls: number;
  ok: number;
  http429: number;
  httpErrors: number;
  netErrors: number;
  decodeErrors: number;
  duplicateProofs: number;
  newProofs: number;
  nonCanonical: number;
  regressions: number;
  roundsByPair: Record<number, number>;
  missingByPair: Record<number, number>;
  missingSeconds: { pairId: number; sec: number }[];
}

export interface PairStats {
  pairId: number;
  asset: AssetSymbol;
  rounds: number;
  sigma1sEwmaPpm: number | null;
  sigma1sBipower30mPpm: number | null;
  sigma1sPlain30mPpm: number | null;
  momentum60sPpm: number | null;
}

interface Waiter {
  pairId: number;
  sec: number;
  resolve: (r: OracleRound) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export class SupraPriceHub implements PriceHub {
  readonly archive: ProofArchive;
  private readonly opts: Required<Pick<PriceHubOptions, 'restUrl' | 'pollMs' | 'staleMs' | 'proofRetentionH' | 'roundRetentionD'>> & PriceHubOptions;
  private readonly store: OracleStore;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly rings = new Map<number, RoundRing>();
  private readonly ewma = new Map<number, EwmaSigma>();
  private readonly proofs = new ProofIndex(WINDOW_SEC);
  private readonly waiters = new Set<Waiter>();
  private readonly proofListeners = new Set<(e: ProofEvent) => void>();
  private readonly lagSamples: { atMs: number; lagMs: number }[] = [];
  private readonly minuteLags: number[] = [];
  private readonly minuteRtts: number[] = [];
  private lastProofHex: string | undefined;
  private running = false;
  private loopDone: Promise<void> | undefined;
  private timers: NodeJS.Timeout[] = [];
  private consecutiveFailures = 0;
  private backoffUntilMs = 0;
  private currentStatus: OracleStatus | undefined;
  private lastSlotMs = 0;
  private minuteBase: HubMetrics | undefined;
  readonly metrics: HubMetrics;

  constructor(opts: PriceHubOptions) {
    this.opts = opts as typeof this.opts;
    this.store = opts.store ?? new MemoryOracleStore();
    this.log = opts.log ?? silentLogger;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    for (const p of SUPRA_PAIR_IDS) {
      this.rings.set(p, new RoundRing(WINDOW_SEC));
      this.ewma.set(p, new EwmaSigma());
    }
    this.metrics = {
      startedAtMs: this.now(),
      polls: 0,
      ok: 0,
      http429: 0,
      httpErrors: 0,
      netErrors: 0,
      decodeErrors: 0,
      duplicateProofs: 0,
      newProofs: 0,
      nonCanonical: 0,
      regressions: 0,
      roundsByPair: Object.fromEntries(SUPRA_PAIR_IDS.map((p) => [p, 0])),
      missingByPair: Object.fromEntries(SUPRA_PAIR_IDS.map((p) => [p, 0])),
      missingSeconds: [],
    };
    this.archive = {
      find: async (pairId, sec) => {
        const e = this.proofs.forPair(pairId, sec);
        if (e) return { proof: e.proof, proofHash: e.hash };
        return this.store.findProof(pairId, sec);
      },
      getProof: async (hash) => this.proofs.get(hash.toLowerCase() as Hex)?.proof ?? this.store.getProof(hash),
      markReferenced: (hashes, txHash) => this.store.markReferenced(hashes, txHash),
    };
  }

  // ── PriceHub port ─────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const since = Math.floor(this.now() / 1000) - WINDOW_SEC;
      const rows = await this.store.loadRecentRounds(since);
      for (const p of SUPRA_PAIR_IDS) {
        const ring = this.rings.get(p) as RoundRing;
        ring.load(rows.filter((r) => r.pairId === p));
        const ew = this.ewma.get(p) as EwmaSigma;
        for (const r of ring.tail(ring.size)) ew.update(r.sec, r.price18);
      }
      if (rows.length > 0) this.log.info('warmed from archive', { rounds: rows.length });
    } catch (err) {
      this.log.warn('warm-up from archive failed', { error: errorMessage(err) });
    }
    this.minuteBase = structuredClone(this.metrics);
    this.loopDone = this.pollLoop();
    this.timers.push(setInterval(() => this.checkHealth(), 250));
    if (this.role() === 'leader') this.timers.push(setInterval(() => this.publishStats(), this.opts.statsEveryMs ?? 30_000));
    this.timers.push(setInterval(() => this.logSummary(), this.opts.summaryEveryMs ?? 60_000));
    this.timers.push(setInterval(() => void this.prune(), this.opts.pruneEveryMs ?? 10 * 60_000));
    this.log.info('price hub started', { url: this.opts.restUrl, pollMs: this.opts.pollMs, role: this.role() });
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await this.loopDone;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('price hub stopped'));
    }
    this.waiters.clear();
    await this.store.stop();
  }

  status(): { status: OracleStatus; lagMsP50: number | null; pairs: Record<number, { ageMs: number }> } {
    const now = this.now();
    const pairs: Record<number, { ageMs: number }> = {};
    let worst = 0;
    for (const p of SUPRA_PAIR_IDS) {
      const r = this.rings.get(p)?.latest();
      const age = r ? Math.max(0, now - Number(r.roundMs)) : Number.POSITIVE_INFINITY;
      pairs[p] = { ageMs: Number.isFinite(age) ? Math.round(age) : -1 };
      worst = Math.max(worst, age);
    }
    const status: OracleStatus = worst < this.opts.staleMs ? 'ok' : worst < DEGRADED_AFTER_MS ? 'degraded' : 'down';
    const recent = this.lagSamples.filter((s) => now - s.atMs <= 60_000).map((s) => s.lagMs);
    return { status, lagMsP50: percentile(recent, 0.5), pairs };
  }

  latest(pairId: number): OracleRound | undefined {
    return this.rings.get(pairId)?.latest();
  }

  history(pairId: number, limit: number): OracleRound[] {
    return this.rings.get(pairId)?.tail(limit) ?? [];
  }

  proofForSecond(sec: number): { proof: Hex; proofHash: Hex } | undefined {
    const e = this.proofs.forSecond(sec);
    return e ? { proof: e.proof, proofHash: e.hash } : undefined;
  }

  waitForSecond(pairId: number, sec: number, timeoutMs: number): Promise<OracleRound> {
    const ring = this.rings.get(pairId);
    if (!ring) return Promise.reject(new Error(`unknown pair ${pairId}`));
    const hit = ring.get(sec);
    if (hit) return Promise.resolve(hit);
    const last = ring.latest();
    if (last && last.sec > sec) return Promise.reject(new SecondMissedError(pairId, sec));
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        pairId,
        sec,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(w);
          reject(new WaitTimeoutError(pairId, sec));
        }, timeoutMs),
      };
      this.waiters.add(w);
    });
  }

  // ── extensions (A3-internal) ──────────────────────────────────────────────

  /** Raw proof carrying (pairId, sec) from the 30-min window. */
  proofFor(pairId: number, sec: number): { proof: Hex; proofHash: Hex } | undefined {
    const e = this.proofs.forPair(pairId, sec);
    return e ? { proof: e.proof, proofHash: e.hash } : undefined;
  }

  onProof(cb: (e: ProofEvent) => void): () => void {
    this.proofListeners.add(cb);
    return () => this.proofListeners.delete(cb);
  }

  rounds(pairId: number, fromSec: number, toSec: number): OracleRound[] {
    return this.rings.get(pairId)?.range(fromSec, toSec) ?? [];
  }

  stats(pairId: number): PairStats {
    const ring = this.rings.get(pairId);
    const all = ring ? ring.tail(ring.size) : [];
    const last = all[all.length - 1];
    const window = last ? all.filter((r) => r.sec > last.sec - WINDOW_SEC) : [];
    return {
      pairId,
      asset: assetByPair(pairId).symbol,
      rounds: all.length,
      sigma1sEwmaPpm: this.ewma.get(pairId)?.value() ?? null,
      sigma1sBipower30mPpm: bipowerSigmaPpm(window).sigmaPpm,
      sigma1sPlain30mPpm: plainSigmaPpm(window),
      momentum60sPpm: momentumPpm(all, 60),
    };
  }

  /** Robust σ₁ₛ over the last `windowSec` of rounds (adaptive lanes). */
  sigmaBipower(pairId: number, windowSec = WINDOW_SEC): { sigmaPpm: number | null; samples: number } {
    const last = this.latest(pairId);
    if (!last) return { sigmaPpm: null, samples: 0 };
    return bipowerSigmaPpm(this.rounds(pairId, last.sec - windowSec + 1, last.sec));
  }

  touchRates(pairId: number, lane: { targetPpm: number; stopPpm: number; durationSec: number }, windowSec = 600): TouchRates {
    const last = this.latest(pairId);
    if (!last) return { starts: 0, pTP: 0, pSL: 0, pTimeout: 0 };
    return backtestTouchRates(this.rounds(pairId, last.sec - windowSec, last.sec), lane);
  }

  // ── polling ───────────────────────────────────────────────────────────────

  private role(): 'leader' | 'archiver' {
    return this.opts.role ?? 'leader';
  }

  /** Next phase slot strictly after both `now` and the previous slot. */
  nextSlotMs(now: number): number {
    const step = Math.max(50, this.opts.pollMs);
    const phase = this.opts.phaseMs ?? 150;
    const jitter = this.opts.jitterMs ?? 15;
    const after = Math.max(now, this.lastSlotMs + step / 2);
    const base = Math.floor(after / 1000) * 1000;
    let slot: number | undefined;
    for (let s = base - 1000; s <= base + 1000 && slot === undefined; s += 1000) {
      for (let o = phase; o < 1000; o += step) {
        if (s + o > after) {
          slot = s + o;
          break;
        }
      }
    }
    const chosen = slot ?? base + 1000 + phase;
    this.lastSlotMs = chosen;
    return chosen + Math.round((Math.random() * 2 - 1) * jitter);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const at = this.nextSlotMs(this.now());
      await sleep(at - this.now());
      if (!this.running) break;
      if (this.now() < this.backoffUntilMs) continue;
      await this.pollOnce();
    }
  }

  async pollOnce(): Promise<void> {
    const sentAtMs = this.now();
    this.metrics.polls++;
    try {
      const res = await this.fetchImpl(`${this.opts.restUrl.replace(/\/$/, '')}/get_proof`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pair_indexes: SUPRA_PAIR_IDS, chain_type: 'evm' }),
        signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 900),
      });
      this.minuteRtts.push(this.now() - sentAtMs);
      if (res.status === 429) {
        this.metrics.http429++;
        const retryAfter = Number(res.headers.get('retry-after'));
        await res.body?.cancel();
        this.fail(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
        return;
      }
      if (!res.ok) {
        this.metrics.httpErrors++;
        await res.body?.cancel();
        this.fail();
        return;
      }
      const body = (await res.json()) as { proof_bytes?: string };
      const raw = body.proof_bytes;
      if (typeof raw !== 'string' || raw.length < 10) {
        this.metrics.decodeErrors++;
        this.fail();
        return;
      }
      this.metrics.ok++;
      this.consecutiveFailures = 0;
      this.ingestProof((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex, this.now());
    } catch (err) {
      this.metrics.netErrors++;
      if (this.consecutiveFailures === 0) this.log.warn('supra poll failed', { error: errorMessage(err) });
      this.fail();
    }
  }

  private fail(retryAfterMs?: number): void {
    this.consecutiveFailures++;
    const backoff = retryAfterMs ?? Math.min(2000, 100 * 2 ** Math.min(this.consecutiveFailures, 5));
    // One failed poll does not back off: the next phase slot is the retry.
    if (this.consecutiveFailures > 1 || retryAfterMs !== undefined) this.backoffUntilMs = this.now() + backoff;
  }

  /** Decodes, validates and fans out one /get_proof response (also used by tests). */
  ingestProof(proof: Hex, receivedAtMs: number): OracleRound[] {
    if (proof === this.lastProofHex) {
      this.metrics.duplicateProofs++;
      return [];
    }
    const hash = keccak256(proof);
    if (this.proofs.has(hash)) {
      this.metrics.duplicateProofs++;
      this.lastProofHex = proof;
      return [];
    }
    let feeds: ReturnType<typeof decodeSupraProof>;
    try {
      feeds = decodeSupraProof(proof);
    } catch (err) {
      this.metrics.decodeErrors++;
      this.log.warn('undecodable proof', { hash, error: errorMessage(err) });
      return [];
    }
    this.lastProofHex = proof;
    const rounds: OracleRound[] = [];
    for (const f of feeds) {
      if (!TRACKED.has(f.pairId)) continue;
      if (!isCanonicalRound(f)) {
        this.metrics.nonCanonical++;
        continue;
      }
      if (f.decimals !== 18) this.log.warn('feed decimals != 18 (the verifier will reject it)', { pairId: f.pairId, decimals: f.decimals });
      rounds.push({
        pairId: f.pairId,
        roundMs: f.roundMs,
        sec: Number(f.roundMs / 1000n),
        tsMs: Number(f.tsMs),
        price18: toPrice18(f.price, f.decimals),
        proofHash: hash,
        receivedAtMs,
      });
    }
    if (rounds.length === 0) return [];
    this.metrics.newProofs++;
    const sec = Math.min(...rounds.map((r) => r.sec));
    this.proofs.add({ hash, proof, sec, firstSeenMs: receivedAtMs }, rounds);
    this.store.saveProof({ hash, proof, sec, firstSeenMs: receivedAtMs, source: this.opts.instanceId ?? this.role() });

    const fresh: OracleRound[] = [];
    const late: OracleRound[] = [];
    for (const r of rounds.sort((a, b) => a.pairId - b.pairId || a.sec - b.sec)) {
      const ring = this.rings.get(r.pairId) as RoundRing;
      const last = ring.latest();
      if (last && r.sec <= last.sec) {
        if (!ring.get(r.sec)) {
          this.metrics.regressions++;
          late.push(r); // archived for backfill, never emitted out of order
        }
        continue;
      }
      if (last && r.sec > last.sec + 1) {
        const gap = r.sec - last.sec - 1;
        this.metrics.missingByPair[r.pairId] += gap;
        for (let s = last.sec + 1; s < r.sec && this.metrics.missingSeconds.length < 10_000; s++) this.metrics.missingSeconds.push({ pairId: r.pairId, sec: s });
        this.log.warn('missed seconds', { pairId: r.pairId, from: last.sec + 1, to: r.sec - 1, count: gap });
      }
      ring.push(r);
      this.ewma.get(r.pairId)?.update(r.sec, r.price18);
      this.metrics.roundsByPair[r.pairId]++;
      fresh.push(r);
    }
    if (late.length > 0) this.store.saveRounds(late);
    if (fresh.length > 0) {
      this.store.saveRounds(fresh);
      const lag = receivedAtMs - Number(fresh[0].roundMs);
      this.lagSamples.push({ atMs: receivedAtMs, lagMs: lag });
      this.minuteLags.push(lag);
      while (this.lagSamples.length > 0 && receivedAtMs - this.lagSamples[0].atMs > 60_000) this.lagSamples.shift();
      this.proofs.prune(fresh[fresh.length - 1].sec);
    }
    for (const r of fresh) this.fanOut(r);
    const event: ProofEvent = { hash, proof, rounds };
    for (const cb of this.proofListeners) {
      try {
        cb(event);
      } catch (err) {
        this.log.error('proof listener failed', { error: errorMessage(err) });
      }
    }
    return fresh;
  }

  private fanOut(r: OracleRound): void {
    for (const w of [...this.waiters]) {
      if (w.pairId !== r.pairId) continue;
      if (w.sec === r.sec) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.resolve(r);
      } else if (w.sec < r.sec && !this.rings.get(r.pairId)?.get(w.sec)) {
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.reject(new SecondMissedError(w.pairId, w.sec));
      }
    }
    if (this.role() !== 'leader' || !this.opts.bus) return;
    this.opts.bus.emit('oracle.round', r);
    const asset = assetByPair(r.pairId).symbol;
    this.opts.bus.emit('public.event', {
      event: 'price',
      payload: {
        asset,
        pairId: r.pairId,
        round: r.roundMs.toString(),
        tsMs: r.tsMs,
        price: r.price18.toString(),
        lagMs: Math.max(0, Math.round(r.receivedAtMs - Number(r.roundMs))),
      },
    });
  }

  // ── timers ────────────────────────────────────────────────────────────────

  private checkHealth(): void {
    const s = this.status();
    if (s.status === this.currentStatus) return;
    const prev = this.currentStatus;
    this.currentStatus = s.status;
    if (prev !== undefined || s.status !== 'down') this.log.info('oracle status', { from: prev ?? null, to: s.status });
    if (this.role() !== 'leader' || !this.opts.bus) return;
    this.opts.bus.emit('oracle.status', { status: s.status });
    const pairs: Partial<Record<AssetSymbol, { ageMs: number }>> = {};
    for (const a of ASSETS) pairs[a.symbol] = s.pairs[a.supraPairId];
    this.opts.bus.emit('public.event', { event: 'oracle.status', payload: { status: s.status, pairs } });
  }

  publishStats(): void {
    if (!this.opts.bus) return;
    for (const a of ASSETS) {
      const st = this.stats(a.supraPairId);
      if (st.sigma1sEwmaPpm === null) continue;
      this.opts.bus.emit('public.event', {
        event: 'stats',
        payload: {
          asset: a.symbol,
          change24hPct: this.opts.market?.change24hPct(a.symbol) ?? null,
          sigma1sPpm: Math.round(st.sigma1sEwmaPpm * 100) / 100,
          momentum60sPpm: Math.round((st.momentum60sPpm ?? 0) * 100) / 100,
        },
      });
    }
  }

  private logSummary(): void {
    const base = this.minuteBase ?? this.metrics;
    const m = this.metrics;
    const d = (k: 'polls' | 'ok' | 'http429' | 'httpErrors' | 'netErrors' | 'duplicateProofs' | 'newProofs') => m[k] - base[k];
    const rounds = Object.fromEntries(SUPRA_PAIR_IDS.map((p) => [p, m.roundsByPair[p] - base.roundsByPair[p]]));
    const missing = Object.fromEntries(SUPRA_PAIR_IDS.map((p) => [p, m.missingByPair[p] - base.missingByPair[p]]));
    const lags = this.minuteLags.splice(0);
    const rtts = this.minuteRtts.splice(0);
    this.log.info('minute summary', {
      polls: d('polls'),
      ok: d('ok'),
      http429: d('http429'),
      httpErrors: d('httpErrors'),
      netErrors: d('netErrors'),
      newProofs: d('newProofs'),
      rounds,
      missing,
      lagMs: { p50: percentile(lags, 0.5), p95: percentile(lags, 0.95), p99: percentile(lags, 0.99), max: lags.length ? Math.max(...lags) : null },
      rttMs: { p50: percentile(rtts, 0.5), p95: percentile(rtts, 0.95), max: rtts.length ? Math.max(...rtts) : null },
      status: this.status().status,
    });
    this.minuteBase = structuredClone(this.metrics);
  }

  private async prune(): Promise<void> {
    if (this.role() !== 'leader') return;
    try {
      const r = await this.store.prune(this.now(), this.opts.roundRetentionD, this.opts.proofRetentionH);
      if (r.rounds + r.proofs > 0) this.log.info('archive pruned', r);
    } catch (err) {
      this.log.warn('archive prune failed', { error: errorMessage(err) });
    }
  }
}
