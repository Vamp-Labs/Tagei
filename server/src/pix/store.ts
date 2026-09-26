import { eq, sql as dsql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';
import type { DebriefDTO } from '@bnbplay/shared/dto';
import { llmUsage, pixChatQuota, pixDebriefs } from '../db/schema/pix.ts';

export type LlmKind = 'insight' | 'debrief' | 'chat';
export type LlmOutcome = 'ok' | 'refusal' | 'timeout' | 'null_parse' | 'parse_error' | 'max_tokens' | 'guardrail' | 'error';

export interface UsageRow {
  day: string;
  kind: LlmKind;
  model: string;
  player: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  outcome: LlmOutcome;
}

export interface PixStore {
  getDebrief(roundId: bigint): Promise<DebriefDTO | null>;
  /** First writer wins; returns the stored debrief. */
  putDebrief(roundId: bigint, player: string, debrief: DebriefDTO): Promise<DebriefDTO>;
  recordUsage(row: UsageRow): Promise<void>;
  spentMicroUsd(day: string): Promise<number>;
  /** Increments and returns the player's chat count for `day`. */
  bumpChat(player: string, day: string): Promise<number>;
}

export function createMemoryPixStore(): PixStore {
  const debriefs = new Map<string, DebriefDTO>();
  const usage: UsageRow[] = [];
  const chats = new Map<string, number>();
  return {
    async getDebrief(roundId) {
      return debriefs.get(roundId.toString()) ?? null;
    },
    async putDebrief(roundId, _player, d) {
      const k = roundId.toString();
      if (!debriefs.has(k)) debriefs.set(k, d);
      return debriefs.get(k) as DebriefDTO;
    },
    async recordUsage(row) {
      usage.push(row);
    },
    async spentMicroUsd(day) {
      return usage.filter((u) => u.day === day).reduce((s, u) => s + u.costMicroUsd, 0);
    },
    async bumpChat(player, day) {
      const k = `${player}|${day}`;
      const n = (chats.get(k) ?? 0) + 1;
      chats.set(k, n);
      return n;
    },
  };
}

export function createPgPixStore(sql: Sql): PixStore {
  const db = drizzle(sql);
  return {
    async getDebrief(roundId) {
      const [r] = await db.select({ d: pixDebriefs.debrief }).from(pixDebriefs).where(eq(pixDebriefs.roundId, roundId.toString())).limit(1);
      return r?.d ?? null;
    },
    async putDebrief(roundId, player, d) {
      await db.insert(pixDebriefs).values({ roundId: roundId.toString(), player, debrief: d, source: d.source }).onConflictDoNothing();
      return (await this.getDebrief(roundId)) ?? d;
    },
    async recordUsage(row) {
      await db.insert(llmUsage).values(row);
    },
    async spentMicroUsd(day) {
      const [r] = await db.select({ s: sum(llmUsage.costMicroUsd).mapWith(Number) }).from(llmUsage).where(eq(llmUsage.day, day));
      return r?.s ?? 0;
    },
    async bumpChat(player, day) {
      const [r] = await db
        .insert(pixChatQuota)
        .values({ player, day, count: 1 })
        .onConflictDoUpdate({ target: [pixChatQuota.player, pixChatQuota.day], set: { count: dsql`${pixChatQuota.count} + 1` } })
        .returning({ count: pixChatQuota.count });
      return r?.count ?? 1;
    },
  };
}
