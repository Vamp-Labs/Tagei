import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.ts';

export function createDb(url: string, max = 10) {
  const sql = postgres(url, { max });
  return { sql, db: drizzle(sql, { schema }) };
}

export type Db = ReturnType<typeof createDb>['db'];
