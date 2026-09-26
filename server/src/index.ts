import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Address } from 'viem';
import { createApp } from './app.ts';
import { createA4 } from './api/index.ts';
import { Bus } from './bus.ts';
import { loadConfig, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { tryAcquireLeadership, type Leadership } from './leader.ts';
import { startChainServices } from './ops/services.ts';
import { startArchiver } from './pricehub/index.ts';
import type { ReadinessCheck, RoundBook } from './ports.ts';

const VERSION = '0.3.0';
const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Used until the Arena is deployed (no indexer): nothing is ever open. */
const emptyRoundBook: RoundBook = {
  open: () => [],
  get: () => undefined,
  activeFor: (_player: Address) => undefined,
  toDTO: () => undefined,
};

async function waitForLeadership(sql: ReturnType<typeof createDb>['sql']): Promise<Leadership> {
  for (;;) {
    const l = await tryAcquireLeadership(sql);
    if (l.isLeader()) return l;
    console.log('standby: another instance holds the leader lock, retrying in 5 s');
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function main() {
  const config: Config = loadConfig();
  const bus = new Bus();
  const checks: ReadinessCheck[] = [];

  const db = config.DATABASE_URL ? createDb(config.DATABASE_URL, config.DB_POOL_MAX) : undefined;
  let leadership: Leadership | undefined;
  if (db) {
    checks.push({ name: 'db', check: async () => ((await db.sql`select 1`), { ok: true }) });
    // Railway overlaps deployments: singleton workers (and migrations) run only on the leader.
    leadership = await waitForLeadership(db.sql);
    await migrate(db.db, { migrationsFolder: MIGRATIONS });
    console.log('leader acquired, migrations applied');
  }

  if (config.ROLE === 'archiver') {
    if (!db) throw new Error('ROLE=archiver needs DATABASE_URL');
    const hub = await startArchiver({ config, db: db.db });
    const app = createApp({ version: VERSION, corsOrigins: [], checks });
    const server = serve({ fetch: app.fetch, port: config.PORT });
    registerShutdown(async () => {
      server.close();
      await hub.stop();
      await leadership?.release();
      await db.sql.end({ timeout: 5 });
    });
    return;
  }

  const chain = await startChainServices({ config, bus, db: db?.db });
  const roundBook = chain.indexer?.roundBook ?? emptyRoundBook;

  const a4 = createA4({
    config,
    bus,
    sql: db?.sql,
    priceHub: chain.hub,
    roundBook,
    senders: { relayer: chain.senders?.relayer, ops: chain.senders?.ops },
    publicClient: chain.chain.read,
    isLeader: () => leadership?.isLeader() ?? true,
  });

  const app = createApp({
    version: VERSION,
    corsOrigins: config.CORS_ORIGINS,
    checks: [...checks, ...chain.checks, ...a4.checks],
    routers: a4.routers,
  });
  a4.start();

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) =>
    console.log(`server listening on :${info.port} (arena ${config.ARENA_ADDRESS ?? 'not deployed'})`),
  );

  registerShutdown(async () => {
    server.close();
    a4.stop();
    await chain.stop();
    await leadership?.release();
    await db?.sql.end({ timeout: 5 });
  });
}

function registerShutdown(stop: () => Promise<void>) {
  let stopping = false;
  const handler = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, shutting down`);
    stop()
      .catch((err) => console.error(err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
