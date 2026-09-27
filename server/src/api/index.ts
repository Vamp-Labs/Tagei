// A4 composition root. A0 wires it in server/src/index.ts:
//
//   const a4 = createA4({ config, bus, sql: db?.sql, priceHub, roundBook, senders, publicClient, isLeader });
//   const app = createApp({ version, corsOrigins, checks, routers: a4.routers });
//   a4.start();            // bus subscriptions + timers; a4.stop() on shutdown
//   // A3 (or A0) calls a4.progression.onRoundFinalized(roundId) once a settlement is final;
//   // a4 also listens to finalized `RoundSettled` chain events itself (idempotent).
//
// Without `sql` every store is in-memory (dev only). Without ANTHROPIC_API_KEY PIX
// serves templates. Without ARENA_ADDRESS / senders, round writes answer 503.

import Anthropic from '@anthropic-ai/sdk';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import type { Address, PublicClient } from 'viem';
import { DEPLOYMENTS } from '@bnbplay/shared/chain';
import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { PriceHub, ReadinessCheck, RoundBook, TxSender } from '../ports.ts';
import { createAuthGuard } from '../auth/jwt.ts';
import { createAuthRouter } from '../auth/router.ts';
import { AuthService, createLoginVerifier } from '../auth/service.ts';
import { createMemoryAuthStore, createPgAuthStore } from '../auth/store.ts';
import { createFaucetRouter } from '../faucet/router.ts';
import { FaucetService, type DripEncoder } from '../faucet/service.ts';
import { createMemoryFaucetStore, createPgFaucetStore } from '../faucet/store.ts';
import { PixLlm, type AnthropicLike } from '../pix/llm.ts';
import { createBinanceMarketData } from '../pix/market-data.ts';
import { createPixRouter } from '../pix/router.ts';
import { PixServiceImpl } from '../pix/service.ts';
import { createMemoryPixStore, createPgPixStore } from '../pix/store.ts';
import { ProgressionServiceImpl } from '../progression/service.ts';
import { createMemoryProgressionStore, createPgProgressionStore } from '../progression/store.ts';
import { SseHub } from '../sse/hub.ts';
import { createStreamRouter } from '../sse/router.ts';
import { createMemoryEventStore, createPgEventStore } from '../sse/store.ts';
import { createChainLaneSource, createChainLedger } from './chain.ts';
import type { ContractsDTO, LaneSource, LedgerReader, MarketData } from './deps.ts';
import { createErrorHandler } from './errors.ts';
import { IntentTracker } from './intents.ts';
import { ipHashOf } from './ip.ts';
import { createFixtureLaneSource } from './lanes.fixture.ts';
import { createLogger, type Logger } from './log.ts';
import { createPublicRouter } from './public.router.ts';
import { RateLimiter, rateLimitMiddleware } from './rate-limit.ts';
import { createPlayersRouter, createRoundsRouter } from './rounds.router.ts';
import { RoundsService, createTypedDataVerifier } from './rounds.service.ts';

export interface A4Deps {
  config: Config;
  bus: Bus;
  sql?: Sql;
  priceHub: PriceHub;
  roundBook: RoundBook;
  senders?: { relayer?: TxSender; ops?: TxSender };
  publicClient?: PublicClient;
  /** Override the contract addresses shown in /v1/config (default: DEPLOYMENTS[chainId] + env). */
  contracts?: ContractsDTO | null;
  lanes?: LaneSource;
  ledger?: LedgerReader;
  marketData?: MarketData;
  anthropic?: AnthropicLike;
  encodeDrip?: DripEncoder;
  isLeader?: () => boolean;
  now?: () => number;
  log?: Logger;
  /** Also run progression for finalized `RoundSettled` chain events (default true). */
  bindFinalizedRounds?: boolean;
}

export function resolveContracts(config: Config): ContractsDTO | null {
  const d = DEPLOYMENTS[config.CHAIN_ID];
  if (!d) return null;
  return {
    arena: (config.ARENA_ADDRESS ?? d.arena) as Address,
    checkpointOracle: (config.CHECKPOINT_ORACLE_ADDRESS ?? d.checkpointOracle) as Address,
    testUsd: d.testUsd,
    faucet: (config.FAUCET_ADDRESS ?? d.faucet) as Address,
  };
}

export function createA4(deps: A4Deps) {
  const { config, bus } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? createLogger('a4', config.LOG_LEVEL);
  const isLeader = deps.isLeader ?? (() => true);
  const contracts = deps.contracts !== undefined ? deps.contracts : resolveContracts(config);
  const arena = (contracts?.arena ?? config.ARENA_ADDRESS ?? null) as Address | null;
  const faucetAddress = (contracts?.faucet ?? config.FAUCET_ADDRESS ?? null) as Address | null;
  if (!deps.sql && config.NODE_ENV === 'production') log.warn('no DATABASE_URL: A4 stores are in-memory');

  const stores = deps.sql
    ? {
        auth: createPgAuthStore(deps.sql),
        events: createPgEventStore(deps.sql),
        faucet: createPgFaucetStore(deps.sql),
        progression: createPgProgressionStore(deps.sql),
        pix: createPgPixStore(deps.sql),
      }
    : {
        auth: createMemoryAuthStore(now),
        events: createMemoryEventStore(now),
        faucet: createMemoryFaucetStore(),
        progression: createMemoryProgressionStore(),
        pix: createMemoryPixStore(),
      };

  const lanes =
    deps.lanes ??
    (arena && deps.publicClient ? createChainLaneSource({ client: deps.publicClient, arena, now, log }) : createFixtureLaneSource(now));
  const ledger = deps.ledger ?? (arena && deps.publicClient ? createChainLedger({ client: deps.publicClient, arena }) : undefined);
  const marketData = deps.marketData ?? createBinanceMarketData({ baseUrl: config.BINANCE_DATA_URL, now, log });
  const hashIpOf = (c: Context) => ipHashOf(c, { trustProxy: config.TRUST_PROXY, salt: config.IP_HASH_SALT });

  const guard = createAuthGuard({ secret: config.JWT_SECRET, now });
  const intents = new IntentTracker({ bus, roundBook: deps.roundBook, now, log });

  const progression = new ProgressionServiceImpl({ store: stores.progression, roundBook: deps.roundBook, bus, players: stores.auth, lanes, now, log });
  const history = progression.history();

  const faucet = new FaucetService({
    store: stores.faucet,
    intents,
    roundBook: deps.roundBook,
    ops: deps.senders?.ops,
    faucetAddress,
    enabled: config.FAUCET_ENABLED,
    amountUsd: config.FAUCET_AMOUNT_USD,
    ipDailyCap: config.FAUCET_IP_DAILY_CAP,
    ledger,
    encodeDrip: deps.encodeDrip,
    turnstileSecret: config.TURNSTILE_SECRET_KEY,
    now,
    log,
  });

  const auth = new AuthService({
    store: stores.auth,
    chainId: config.CHAIN_ID,
    jwtSecret: config.JWT_SECRET,
    now,
    verifyLogin: createLoginVerifier(deps.publicClient),
    onFirstGuestSession: (player, ipHash) => faucet.autoDrip(player, ipHash),
    log,
  });

  const rounds = new RoundsService({
    chainId: config.CHAIN_ID,
    arena,
    relayer: deps.senders?.relayer,
    roundBook: deps.roundBook,
    priceHub: deps.priceHub,
    lanes,
    ledger,
    intents,
    bus,
    verifyTyped: createTypedDataVerifier(deps.publicClient),
    relayerMinBalanceBnb: config.RELAYER_MIN_BALANCE_BNB,
    now,
    log,
  });

  const anthropic = deps.anthropic ?? (config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 0 }) : undefined);
  const pix = new PixServiceImpl({
    store: stores.pix,
    priceHub: deps.priceHub,
    roundBook: deps.roundBook,
    bus,
    history,
    marketData,
    lanes,
    llm: anthropic ? new PixLlm({ client: anthropic, model: config.PIX_MODEL, timeoutMs: config.PIX_TIMEOUT_MS }) : undefined,
    llmEnabled: config.PIX_LLM_ENABLED,
    dailyBudgetUsd: config.PIX_DAILY_BUDGET_USD,
    chatDailyLimit: config.PIX_CHAT_DAILY_LIMIT,
    insightTtlMs: config.PIX_INSIGHT_TTL_S * 1000,
    chatFirstTokenMs: config.PIX_TIMEOUT_MS,
    now,
    log,
    isLeader,
  });

  const hub = new SseHub({ bus, store: stores.events, priceHub: deps.priceHub, roundBook: deps.roundBook, history, marketData, now, log, isLeader });

  // One v1 router: the global limiter (120 req/min per IP hash) and the error envelope apply once.
  const router = new Hono();
  router.onError(createErrorHandler(log));
  router.use('*', rateLimitMiddleware(new RateLimiter({ limit: 120, windowMs: 60_000, now }), hashIpOf));
  router.route('/auth', createAuthRouter({ service: auth, ipHashOf: hashIpOf }));
  router.route('/faucet', createFaucetRouter({ service: faucet, guard, ipHashOf: hashIpOf }));
  router.route('/pix', createPixRouter({ service: pix, guard, ipHashOf: hashIpOf, onDebriefReviewed: (p, id) => progression.onDebriefReviewed(p, id), log, now }));
  router.route(
    '/',
    createPublicRouter({
      chainId: config.CHAIN_ID,
      contracts,
      lanes,
      priceHub: deps.priceHub,
      marketData,
      features: { pixLlm: () => pix.llmAvailable(), faucet: faucet.available(), walletConnect: true },
    }),
  );
  router.route('/', createRoundsRouter({ service: rounds, guard, roundBook: deps.roundBook, history }));
  router.route('/', createPlayersRouter({ progression, roundBook: deps.roundBook, history }));
  router.route('/', createStreamRouter({ hub, ipHashOf: hashIpOf }));

  const unsubs: (() => void)[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const checks: ReadinessCheck[] = [
    { name: 'sse', check: async () => ({ ok: true, detail: hub.stats() }) },
  ];

  return {
    /** Pass to createApp({ routers }). */
    routers: [{ path: '', router }],
    router,
    checks,
    services: { auth, faucet, progression, pix, rounds, hub, intents, lanes },
    /** Implements ports.ProgressionService. */
    progression,
    /** Implements ports.PixService. */
    pix,
    start(): void {
      if (unsubs.length) return;
      unsubs.push(intents.start(), rounds.start());
      if (deps.bindFinalizedRounds ?? true) unsubs.push(progression.bindFinalizedRounds());
      hub.start();
      pix.start();
      unsubs.push(
        bus.on('chain.event', (e) => {
          if (['LaneConfigured', 'AssetConfigured', 'ActiveOracleSet', 'OracleAdded'].includes(e.name)) lanes.invalidate();
        }),
      );
      const t = setInterval(() => {
        intents.sweep();
        if (isLeader()) void stores.auth.pruneChallenges(Math.floor(now() / 1000)).catch(() => undefined);
      }, 60_000);
      t.unref?.();
      timers.push(t);
    },
    async stop(): Promise<void> {
      for (const u of unsubs.splice(0)) u();
      for (const t of timers.splice(0)) clearInterval(t);
      pix.stop();
      await hub.stop();
    },
  };
}

export type A4Modules = ReturnType<typeof createA4>;
