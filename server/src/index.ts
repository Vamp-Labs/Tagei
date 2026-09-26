import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Bus } from './bus.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { tryAcquireLeadership, type Leadership } from './leader.ts';
import type { ReadinessCheck } from './ports.ts';

const VERSION = '0.1.0';

async function main() {
  const config = loadConfig();
  const bus = new Bus();
  const checks: ReadinessCheck[] = [];

  let leadership: Leadership | undefined;
  const db = config.DATABASE_URL ? createDb(config.DATABASE_URL, config.DB_POOL_MAX) : undefined;
  if (db) {
    checks.push({ name: 'db', check: async () => ((await db.sql`select 1`), { ok: true }) });
    leadership = await tryAcquireLeadership(db.sql);
    console.log(`leader=${leadership.isLeader()}`);
  }

  // Leader-only workers (price hub, senders, recorder, indexer, progression) and
  // the /v1 routers are wired here as the modules land (see docs/spec/F0-repo.md).
  void bus;

  const app = createApp({ version: VERSION, corsOrigins: config.CORS_ORIGINS, checks });
  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => console.log(`server listening on :${info.port}`));

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await leadership?.release();
    await db?.sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
