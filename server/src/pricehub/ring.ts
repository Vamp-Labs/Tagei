// In-memory windows (30 min) of rounds per pair and of the raw proofs behind them.

import type { Hex } from 'viem';
import type { OracleRound } from '../ports.ts';

export class RoundRing {
  private readonly rows: OracleRound[] = [];
  private readonly bySec = new Map<number, OracleRound>();

  private readonly windowSec: number;


  constructor(windowSec: number) {

    this.windowSec = windowSec;

  }

  get size(): number {
    return this.rows.length;
  }

  latest(): OracleRound | undefined {
    return this.rows[this.rows.length - 1];
  }

  get(sec: number): OracleRound | undefined {
    return this.bySec.get(sec);
  }

  /** Appends a round newer than the latest one; returns false if it is not newer. */
  push(r: OracleRound): boolean {
    const last = this.latest();
    if (last && r.sec <= last.sec) return false;
    this.rows.push(r);
    this.bySec.set(r.sec, r);
    this.trim(r.sec);
    return true;
  }

  /** Inserts rounds in any order (warm-up from the archive); keeps ascending order. */
  load(rounds: OracleRound[]): void {
    for (const r of rounds) if (!this.bySec.has(r.sec)) this.bySec.set(r.sec, r);
    this.rows.length = 0;
    this.rows.push(...[...this.bySec.values()].sort((a, b) => a.sec - b.sec));
    const last = this.latest();
    if (last) this.trim(last.sec);
  }

  /** The last `limit` rounds, oldest first. */
  tail(limit: number): OracleRound[] {
    return limit >= this.rows.length ? [...this.rows] : this.rows.slice(this.rows.length - limit);
  }

  /** Rounds with sec in [fromSec, toSec], oldest first. */
  range(fromSec: number, toSec: number): OracleRound[] {
    return this.rows.filter((r) => r.sec >= fromSec && r.sec <= toSec);
  }

  private trim(newestSec: number): void {
    const cutoff = newestSec - this.windowSec;
    let drop = 0;
    while (drop < this.rows.length && this.rows[drop].sec < cutoff) {
      this.bySec.delete(this.rows[drop].sec);
      drop++;
    }
    if (drop > 0) this.rows.splice(0, drop);
  }
}

export interface ProofEntry {
  hash: Hex;
  proof: Hex;
  /** Round second of the proof's feeds (min if mixed). */
  sec: number;
  firstSeenMs: number;
}

export class ProofIndex {
  private readonly byHash = new Map<Hex, ProofEntry>();
  private readonly byPairSec = new Map<string, Hex>();
  private readonly bySec = new Map<number, Hex>();

  private readonly windowSec: number;


  constructor(windowSec: number) {

    this.windowSec = windowSec;

  }

  has(hash: Hex): boolean {
    return this.byHash.has(hash);
  }

  add(entry: ProofEntry, pairSecs: { pairId: number; sec: number }[]): void {
    if (!this.byHash.has(entry.hash)) this.byHash.set(entry.hash, entry);
    for (const { pairId, sec } of pairSecs) {
      const k = `${pairId}:${sec}`;
      if (!this.byPairSec.has(k)) this.byPairSec.set(k, entry.hash);
      if (!this.bySec.has(sec)) this.bySec.set(sec, entry.hash);
    }
  }

  forPair(pairId: number, sec: number): ProofEntry | undefined {
    const h = this.byPairSec.get(`${pairId}:${sec}`);
    return h ? this.byHash.get(h) : undefined;
  }

  forSecond(sec: number): ProofEntry | undefined {
    const h = this.bySec.get(sec);
    return h ? this.byHash.get(h) : undefined;
  }

  get(hash: Hex): ProofEntry | undefined {
    return this.byHash.get(hash);
  }

  prune(newestSec: number): void {
    const cutoff = newestSec - this.windowSec;
    for (const [h, e] of this.byHash) if (e.sec < cutoff) this.byHash.delete(h);
    for (const [k, h] of this.byPairSec) if (!this.byHash.has(h)) this.byPairSec.delete(k);
    for (const [s, h] of this.bySec) if (!this.byHash.has(h)) this.bySec.delete(s);
  }
}
