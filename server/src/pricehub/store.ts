// Proof + round archive. Writes are queued and flushed in batches (the poll path never
// waits on Postgres); inserts are idempotent so a second archiver instance can share the tables.

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Hex } from 'viem';
import { oracleProofs, oracleRounds } from '../db/schema/oracle.ts';
import type { OracleRound } from '../ports.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';

export interface ArchivedProof {
  hash: Hex;
  proof: Hex;
  sec: number;
  firstSeenMs: number;
  source: string;
}

export interface OracleStore {
  saveProof(p: ArchivedProof): void;
  saveRounds(rounds: OracleRound[]): void;
  flush(): Promise<void>;
  loadRecentRounds(sinceSec: number): Promise<OracleRound[]>;
  findProof(pairId: number, sec: number): Promise<{ proof: Hex; proofHash: Hex } | undefined>;
  getProof(hash: Hex): Promise<Hex | undefined>;
  markReferenced(hashes: Hex[], txHash: Hex): Promise<void>;
  prune(nowMs: number, roundRetentionDays: number, proofRetentionHours: number): Promise<{ rounds: number; proofs: number }>;
  stop(): Promise<void>;
}

const toBuf = (h: Hex): Buffer => Buffer.from(h.slice(2), 'hex');
const toHex = (b: Buffer | Uint8Array): Hex => `0x${Buffer.from(b).toString('hex')}` as Hex;

/** Bounded in-process archive (dev without Postgres, and tests). */
export class MemoryOracleStore implements OracleStore {
  readonly proofs = new Map<Hex, ArchivedProof & { referenced: boolean; recordedTx: Hex | null }>();
  readonly rounds = new Map<string, OracleRound>();

  saveProof(p: ArchivedProof): void {
    if (!this.proofs.has(p.hash)) this.proofs.set(p.hash, { ...p, referenced: false, recordedTx: null });
  }

  saveRounds(rounds: OracleRound[]): void {
    for (const r of rounds) {
      const k = `${r.pairId}:${r.sec}`;
      if (!this.rounds.has(k)) this.rounds.set(k, r);
    }
  }

  async flush(): Promise<void> {}

  async loadRecentRounds(sinceSec: number): Promise<OracleRound[]> {
    return [...this.rounds.values()].filter((r) => r.sec >= sinceSec).sort((a, b) => a.pairId - b.pairId || a.sec - b.sec);
  }

  async findProof(pairId: number, sec: number): Promise<{ proof: Hex; proofHash: Hex } | undefined> {
    const r = this.rounds.get(`${pairId}:${sec}`);
    const p = r ? this.proofs.get(r.proofHash) : undefined;
    return p ? { proof: p.proof, proofHash: p.hash } : undefined;
  }

  async getProof(hash: Hex): Promise<Hex | undefined> {
    return this.proofs.get(hash)?.proof;
  }

  async markReferenced(hashes: Hex[], txHash: Hex): Promise<void> {
    for (const h of hashes) {
      const p = this.proofs.get(h);
      if (p) {
        p.referenced = true;
        p.recordedTx ??= txHash;
      }
    }
  }

  async prune(nowMs: number, roundRetentionDays: number, proofRetentionHours: number): Promise<{ rounds: number; proofs: number }> {
    const roundCut = Math.floor(nowMs / 1000) - roundRetentionDays * 86_400;
    const proofCut = nowMs - proofRetentionHours * 3_600_000;
    let rounds = 0;
    let proofs = 0;
    for (const [k, r] of this.rounds) if (r.sec < roundCut) (this.rounds.delete(k), rounds++);
    for (const [h, p] of this.proofs) if (!p.referenced && p.firstSeenMs < proofCut) (this.proofs.delete(h), proofs++);
    return { rounds, proofs };
  }

  async stop(): Promise<void> {}
}

export class PgOracleStore implements OracleStore {
  private proofQ: ArchivedProof[] = [];
  private roundQ: OracleRound[] = [];
  private flushing: Promise<void> | undefined;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly db: AnyPgDb,
    private readonly log: Logger = silentLogger,
    flushMs = 250,
    private readonly maxQueue = 20_000,
  ) {
    this.timer = setInterval(() => void this.flush(), flushMs);
    this.timer.unref?.();
  }

  saveProof(p: ArchivedProof): void {
    this.proofQ.push(p);
    if (this.proofQ.length > this.maxQueue) this.proofQ.splice(0, this.proofQ.length - this.maxQueue);
  }

  saveRounds(rounds: OracleRound[]): void {
    this.roundQ.push(...rounds);
    if (this.roundQ.length > this.maxQueue * 5) this.roundQ.splice(0, this.roundQ.length - this.maxQueue * 5);
  }

  async flush(): Promise<void> {
    while (this.flushing) await this.flushing;
    if (this.proofQ.length === 0 && this.roundQ.length === 0) return;
    const proofs = this.proofQ;
    const rounds = this.roundQ;
    this.proofQ = [];
    this.roundQ = [];
    this.flushing = (async () => {
      try {
        if (proofs.length > 0) {
          await this.db
            .insert(oracleProofs)
            .values(proofs.map((p) => ({ hash: p.hash, sec: p.sec, proof: toBuf(p.proof), sizeBytes: (p.proof.length - 2) / 2, firstSeenMs: p.firstSeenMs, source: p.source })))
            .onConflictDoNothing({ target: oracleProofs.hash });
        }
        for (let i = 0; i < rounds.length; i += 500) {
          await this.db
            .insert(oracleRounds)
            .values(
              rounds.slice(i, i + 500).map((r) => ({
                pairId: r.pairId,
                sec: r.sec,
                roundMs: Number(r.roundMs),
                tsMs: r.tsMs,
                price18: r.price18,
                proofHash: r.proofHash,
                receivedAtMs: r.receivedAtMs,
              })),
            )
            .onConflictDoNothing({ target: [oracleRounds.pairId, oracleRounds.sec] });
        }
      } catch (err) {
        this.log.warn('oracle archive flush failed; re-queued', { proofs: proofs.length, rounds: rounds.length, error: errorMessage(err) });
        this.proofQ.unshift(...proofs);
        this.roundQ.unshift(...rounds);
      } finally {
        this.flushing = undefined;
      }
    })();
    await this.flushing;
  }

  async loadRecentRounds(sinceSec: number): Promise<OracleRound[]> {
    const rows = await this.db.select().from(oracleRounds).where(sql`${oracleRounds.sec} >= ${sinceSec}`).orderBy(oracleRounds.pairId, oracleRounds.sec);
    return rows.map((r) => ({
      pairId: r.pairId,
      roundMs: BigInt(r.roundMs),
      sec: r.sec,
      tsMs: r.tsMs,
      price18: r.price18,
      proofHash: r.proofHash as Hex,
      receivedAtMs: r.receivedAtMs,
    }));
  }

  async findProof(pairId: number, sec: number): Promise<{ proof: Hex; proofHash: Hex } | undefined> {
    const rows = await this.db
      .select({ hash: oracleProofs.hash, proof: oracleProofs.proof })
      .from(oracleRounds)
      .innerJoin(oracleProofs, eq(oracleProofs.hash, oracleRounds.proofHash))
      .where(and(eq(oracleRounds.pairId, pairId), eq(oracleRounds.sec, sec)))
      .limit(1);
    const r = rows[0];
    return r ? { proof: toHex(r.proof), proofHash: r.hash as Hex } : undefined;
  }

  async getProof(hash: Hex): Promise<Hex | undefined> {
    const rows = await this.db.select({ proof: oracleProofs.proof }).from(oracleProofs).where(eq(oracleProofs.hash, hash.toLowerCase())).limit(1);
    return rows[0] ? toHex(rows[0].proof) : undefined;
  }

  async markReferenced(hashes: Hex[], txHash: Hex): Promise<void> {
    if (hashes.length === 0) return;
    await this.flush();
    await this.db
      .update(oracleProofs)
      .set({ referenced: true, recordedTx: sql`coalesce(${oracleProofs.recordedTx}, ${txHash})` })
      .where(inArray(oracleProofs.hash, hashes.map((h) => h.toLowerCase())));
  }

  async prune(nowMs: number, roundRetentionDays: number, proofRetentionHours: number): Promise<{ rounds: number; proofs: number }> {
    const roundCut = Math.floor(nowMs / 1000) - roundRetentionDays * 86_400;
    const proofCut = nowMs - proofRetentionHours * 3_600_000;
    const r = await this.db.delete(oracleRounds).where(lt(oracleRounds.sec, roundCut)).returning({ s: oracleRounds.sec });
    const p = await this.db
      .delete(oracleProofs)
      .where(and(eq(oracleProofs.referenced, false), lt(oracleProofs.firstSeenMs, proofCut)))
      .returning({ h: oracleProofs.hash });
    return { rounds: r.length, proofs: p.length };
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
