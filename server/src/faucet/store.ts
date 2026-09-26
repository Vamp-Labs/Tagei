import { and, count, desc, eq, gte, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import { faucetClaims, type FaucetClaimStatus } from '../db/schema/faucet.ts';

export interface FaucetClaim {
  id: string;
  /** Lowercase address. */
  player: string;
  ipHash: string | null;
  amount: bigint;
  source: 'auto' | 'claim';
  status: FaucetClaimStatus;
  txHash: string | null;
  error: string | null;
  createdAtMs: number;
}

/** Counts and lookups ignore failed claims, so a failed drip never blocks a retry. */
export interface FaucetStore {
  insert(claim: FaucetClaim): Promise<void>;
  update(id: string, patch: { status: FaucetClaimStatus; txHash?: string | null; error?: string | null }): Promise<void>;
  lastActiveClaim(player: string): Promise<FaucetClaim | null>;
  countByIpSince(ipHash: string, sinceMs: number): Promise<number>;
  countSince(sinceMs: number): Promise<number>;
}

export function createMemoryFaucetStore(): FaucetStore {
  const claims: FaucetClaim[] = [];
  const active = (c: FaucetClaim) => c.status !== 'failed';
  return {
    async insert(claim) {
      claims.push({ ...claim });
    },
    async update(id, patch) {
      const c = claims.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    },
    async lastActiveClaim(player) {
      const mine = claims.filter((c) => c.player === player && active(c));
      return mine.length ? { ...(mine[mine.length - 1] as FaucetClaim) } : null;
    },
    async countByIpSince(ipHash, sinceMs) {
      return claims.filter((c) => c.ipHash === ipHash && c.createdAtMs >= sinceMs && active(c)).length;
    },
    async countSince(sinceMs) {
      return claims.filter((c) => c.createdAtMs >= sinceMs && active(c)).length;
    },
  };
}

export function createPgFaucetStore(sql: Sql): FaucetStore {
  const db = drizzle(sql);
  const toClaim = (r: typeof faucetClaims.$inferSelect): FaucetClaim => ({
    id: r.id,
    player: r.player,
    ipHash: r.ipHash,
    amount: BigInt(r.amount),
    source: r.source,
    status: r.status,
    txHash: r.txHash,
    error: r.error,
    createdAtMs: r.createdAt.getTime(),
  });
  return {
    async insert(c) {
      await db.insert(faucetClaims).values({
        id: c.id,
        player: c.player,
        ipHash: c.ipHash,
        amount: c.amount.toString(),
        source: c.source,
        status: c.status,
        createdAt: new Date(c.createdAtMs),
        updatedAt: new Date(c.createdAtMs),
      });
    },
    async update(id, patch) {
      await db
        .update(faucetClaims)
        .set({ status: patch.status, txHash: patch.txHash ?? null, error: patch.error ?? null, updatedAt: new Date() })
        .where(eq(faucetClaims.id, id));
    },
    async lastActiveClaim(player) {
      const [r] = await db
        .select()
        .from(faucetClaims)
        .where(and(eq(faucetClaims.player, player), ne(faucetClaims.status, 'failed')))
        .orderBy(desc(faucetClaims.createdAt))
        .limit(1);
      return r ? toClaim(r) : null;
    },
    async countByIpSince(ipHash, sinceMs) {
      const [r] = await db
        .select({ n: count() })
        .from(faucetClaims)
        .where(and(eq(faucetClaims.ipHash, ipHash), gte(faucetClaims.createdAt, new Date(sinceMs)), ne(faucetClaims.status, 'failed')));
      return r?.n ?? 0;
    },
    async countSince(sinceMs) {
      const [r] = await db
        .select({ n: count() })
        .from(faucetClaims)
        .where(and(gte(faucetClaims.createdAt, new Date(sinceMs)), ne(faucetClaims.status, 'failed')));
      return r?.n ?? 0;
    },
  };
}
