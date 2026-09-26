// Per-test Postgres schema (DATABASE_URL, e.g. bnbplay_a3 on :55432) with the A3 tables created
// from the drizzle schema files. Migrations stay with A0; this only mirrors them for tests.

import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import postgres from 'postgres';
import * as chain from '../../../src/db/schema/chain.ts';
import * as oracle from '../../../src/db/schema/oracle.ts';
import * as relayer from '../../../src/db/schema/relayer.ts';
import * as rounds from '../../../src/db/schema/rounds.ts';

export const DATABASE_URL = process.env.DATABASE_URL;

export interface TestDb {
  db: ReturnType<typeof drizzle>;
  sql: postgres.Sql;
  schema: string;
  drop(): Promise<void>;
}

export async function ddl(): Promise<string[]> {
  const { bytea: _b, ...oracleTables } = oracle;
  void _b;
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...chain, ...oracleTables, ...relayer, ...rounds }));
}

export async function createTestDb(): Promise<TestDb> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const schema = `a3t_${randomBytes(4).toString('hex')}`;
  const admin = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
  for (const st of await ddl()) await sql.unsafe(st.replaceAll('"public".', ''));
  return {
    db: drizzle(sql),
    sql,
    schema,
    drop: async () => {
      await sql.unsafe(`drop schema ${schema} cascade`);
      await sql.end({ timeout: 2 });
    },
  };
}
