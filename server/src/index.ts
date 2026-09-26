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

  // Bind the HTTP port immediately, on a liveness-only app (/healthz has no dependencies).
  // Railway overlaps the old and new deployment during a rollout; the new one only replaces
  // the old one once ITS healthcheck passes. If that healthcheck — or binding the port at
  // all — waited on leadership, a single-replica service could never redeploy: the new
  // instance can't become leader until the old one exits, and the old one is only asked to
  // exit once the new one is healthy. `/healthz` is therefore what Railway's healthcheckPath
  // must point at; `/readyz` stays a full operational-readiness report for humans and
  // `demo:check`, not a rollout gate.
  let currentApp = createApp({ version: VERSION, corsOrigins: config.CORS_ORIGINS, checks: [] });
  const server = serve({ fetch: (req) => currentApp.fetch(req), port: config.PORT }, (info) =>
    console.log(`listening on :${info.port} (booting)`),
  );

  let leadership: Leadership | undefined;
  let stopChain: (() => Promise<void>) | undefined;
  let stopA4: (() => void) | undefined;
  const db = config.DATABASE_URL ? createDb(config.DATABASE_URL, config.DB_POOL_MAX) : undefined;

  registerShutdown(async () => {
    server.close();
    stopA4?.();
    await stopChain?.();
    await leadership?.release();
    await db?.sql.end({ timeout: 5 });
  });

  const checks: ReadinessCheck[] = [];
  if (db) {
    checks.push({ name: 'db', check: async () => ((await db.sql`select 1`), { ok: true }) });
    // Singleton workers (and migrations) run only on the leader; this can block for as long
    // as the previous deployment's instance is still alive and holding the lock.
    leadership = await waitForLeadership(db.sql);
    await migrate(db.db, { migrationsFolder: MIGRATIONS });
    console.log('leader acquired, migrations applied');
  }

  if (config.ROLE === 'archiver') {
    if (!db) throw new Error('ROLE=archiver needs DATABASE_URL');
    const hub = await startArchiver({ config, db: db.db });
    stopChain = () => hub.stop();
    currentApp = createApp({ version: VERSION, corsOrigins: [], checks });
    console.log('archiver ready');
    return;
  }

  const chain = await startChainServices({ config, bus, db: db?.db });
  stopChain = chain.stop;
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
  stopA4 = a4.stop;

  currentApp = createApp({
    version: VERSION,
    corsOrigins: config.CORS_ORIGINS,
    checks: [...checks, ...chain.checks, ...a4.checks],
    routers: a4.routers,
  });
  a4.start();

  console.log(`server ready (arena ${config.ARENA_ADDRESS ?? 'not deployed'})`);
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
