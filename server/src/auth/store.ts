// Players and login challenges: Postgres (Drizzle) and in-memory implementations.

import { and, eq, gt, inArray, isNull, lt, sql as dsql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import { authChallenges, players } from '../db/schema/players.ts';

export type PlayerKind = 'guest' | 'wallet';

export interface PlayerRecord {
  /** Lowercase address. */
  address: string;
  kind: PlayerKind;
  displayName: string;
  sessions: number;
  createdAtMs: number;
}

export interface ChallengeRecord {
  salt: string;
  address: string;
  expiresAt: number;
  used: boolean;
}

export interface AuthStore {
  createChallenge(c: { salt: string; address: string; expiresAt: number }): Promise<void>;
  getChallenge(salt: string): Promise<ChallengeRecord | null>;
  /** Marks the challenge used; false if it was already used, expired or belongs to someone else. */
  consumeChallenge(salt: string, address: string, nowSec: number): Promise<boolean>;
  /** Creates the player on first login (kind + display name stick) and counts the session. */
  recordSession(p: { address: string; kind: PlayerKind; displayName: string }): Promise<{ player: PlayerRecord; firstSession: boolean }>;
  getPlayer(address: string): Promise<PlayerRecord | null>;
  getPlayers(addresses: string[]): Promise<Map<string, PlayerRecord>>;
  pruneChallenges(nowSec: number): Promise<number>;
}

export function createMemoryAuthStore(now: () => number = Date.now): AuthStore {
  const challenges = new Map<string, ChallengeRecord>();
  const playersByAddr = new Map<string, PlayerRecord>();
  return {
    async createChallenge(c) {
      challenges.set(c.salt, { ...c, used: false });
    },
    async getChallenge(salt) {
      const c = challenges.get(salt);
      return c ? { ...c } : null;
    },
    async consumeChallenge(salt, address, nowSec) {
      const c = challenges.get(salt);
      if (!c || c.used || c.address !== address || c.expiresAt < nowSec) return false;
      c.used = true;
      return true;
    },
    async recordSession(p) {
      const existing = playersByAddr.get(p.address);
      if (existing) {
        existing.sessions++;
        return { player: { ...existing }, firstSession: false };
      }
      const created: PlayerRecord = { ...p, sessions: 1, createdAtMs: now() };
      playersByAddr.set(p.address, created);
      return { player: { ...created }, firstSession: true };
    },
    async getPlayer(address) {
      const p = playersByAddr.get(address);
      return p ? { ...p } : null;
    },
    async getPlayers(addresses) {
      const out = new Map<string, PlayerRecord>();
      for (const a of addresses) {
        const p = playersByAddr.get(a);
        if (p) out.set(a, { ...p });
      }
      return out;
    },
    async pruneChallenges(nowSec) {
      let n = 0;
      for (const [salt, c] of challenges) {
        if (c.expiresAt < nowSec - 3600) {
          challenges.delete(salt);
          n++;
        }
      }
      return n;
    },
  };
}

const toRecord = (r: typeof players.$inferSelect): PlayerRecord => ({
  address: r.address,
  kind: r.kind,
  displayName: r.displayName,
  sessions: r.sessions,
  createdAtMs: r.createdAt.getTime(),
});

export function createPgAuthStore(sql: Sql): AuthStore {
  const db = drizzle(sql);
  return {
    async createChallenge(c) {
      await db.insert(authChallenges).values({ salt: c.salt, address: c.address, expiresAt: c.expiresAt });
    },
    async getChallenge(salt) {
      const [r] = await db.select().from(authChallenges).where(eq(authChallenges.salt, salt)).limit(1);
      return r ? { salt: r.salt, address: r.address, expiresAt: r.expiresAt, used: r.usedAt !== null } : null;
    },
    async consumeChallenge(salt, address, nowSec) {
      const rows = await db
        .update(authChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(authChallenges.salt, salt),
            eq(authChallenges.address, address),
            isNull(authChallenges.usedAt),
            gt(authChallenges.expiresAt, nowSec - 1),
          ),
        )
        .returning({ salt: authChallenges.salt });
      return rows.length === 1;
    },
    async recordSession(p) {
      const [row] = await db
        .insert(players)
        .values({ address: p.address, kind: p.kind, displayName: p.displayName, sessions: 1, lastSessionAt: new Date() })
        .onConflictDoUpdate({
          target: players.address,
          set: { sessions: dsql`${players.sessions} + 1`, lastSessionAt: new Date() },
        })
        .returning();
      if (!row) throw new Error('player upsert returned no row');
      return { player: toRecord(row), firstSession: row.sessions === 1 };
    },
    async getPlayer(address) {
      const [r] = await db.select().from(players).where(eq(players.address, address)).limit(1);
      return r ? toRecord(r) : null;
    },
    async getPlayers(addresses) {
      const out = new Map<string, PlayerRecord>();
      if (addresses.length === 0) return out;
      const rows = await db.select().from(players).where(inArray(players.address, addresses));
      for (const r of rows) out.set(r.address, toRecord(r));
      return out;
    },
    async pruneChallenges(nowSec) {
      const rows = await db
        .delete(authChallenges)
        .where(lt(authChallenges.expiresAt, nowSec - 3600))
        .returning({ salt: authChallenges.salt });
      return rows.length;
    },
  };
}
