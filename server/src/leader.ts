import type { Sql } from 'postgres';

// Railway overlaps old and new deployments, so singleton workers (price hub,
// senders, recorder, indexer, progression) run only while this lock is held.
const LEADER_LOCK_KEY = 0x62_6e_62_70_6c_61_79n; // "bnbplay"

export interface Leadership {
  isLeader(): boolean;
  release(): Promise<void>;
}

export async function tryAcquireLeadership(sql: Sql): Promise<Leadership> {
  const conn = await sql.reserve();
  const [row] = await conn<{ locked: boolean }[]>`select pg_try_advisory_lock(${LEADER_LOCK_KEY.toString()}::bigint) as locked`;
  const held = Boolean(row?.locked);
  if (!held) conn.release();
  return {
    isLeader: () => held,
    release: async () => {
      if (!held) return;
      await conn`select pg_advisory_unlock(${LEADER_LOCK_KEY.toString()}::bigint)`;
      conn.release();
    },
  };
}
