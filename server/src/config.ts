import { z } from 'zod';
import { bscTestnet, DEPLOYMENTS } from '@bnbplay/shared/chain';

const csv = (fallback: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [...fallback]));

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  ROLE: z.enum(['all', 'api', 'worker', 'archiver']).default('all'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().default(10),

  CHAIN_ID: z.coerce.number().int().default(bscTestnet.chainId),
  RPC_HTTP_URLS: csv(bscTestnet.rpcHttp),
  RPC_WS_URL: z.string().optional(),
  ARENA_ADDRESS: z.string().optional(),
  CHECKPOINT_ORACLE_ADDRESS: z.string().optional(),
  FAUCET_ADDRESS: z.string().optional(),
  ARENA_DEPLOY_BLOCK: z.coerce.number().int().optional(),

  RELAYER_PRIVATE_KEY: z.string().optional(),
  RECORDER_PRIVATE_KEY: z.string().optional(),
  OPS_PRIVATE_KEY: z.string().optional(),
  RELAYER_MIN_BALANCE_BNB: z.coerce.number().default(0.05),
  GAS_PRICE_FLOOR_GWEI: z.coerce.number().default(0.1),
  GAS_PRICE_MAX_GWEI: z.coerce.number().default(3),
  RECORDER_GAS_PREMIUM: z.coerce.number().default(2),
  RECORDER_REPLACE_AFTER_MS: z.coerce.number().int().default(1500),

  SUPRA_REST_URL: z.string().default(bscTestnet.supra.restUrl),
  SUPRA_POLL_MS: z.coerce.number().int().default(200),
  ORACLE_STALE_MS: z.coerce.number().int().default(3000),
  ORACLE_PROOF_RETENTION_H: z.coerce.number().int().default(6),
  ORACLE_ROUND_RETENTION_D: z.coerce.number().int().default(3),

  INDEXER_POLL_MS: z.coerce.number().int().default(1000),
  ADAPTIVE_LANES_ENABLED: bool(true),
  ADAPTIVE_LANES_INTERVAL_MIN: z.coerce.number().int().default(10),
  BINANCE_DATA_URL: z.string().default('https://data-api.binance.vision'),

  JWT_SECRET: z.string().default('dev-only-change-me'),
  CORS_ORIGINS: csv(['http://localhost:3000']),
  IP_HASH_SALT: z.string().default('dev-salt'),
  TRUST_PROXY: bool(false),

  FAUCET_ENABLED: bool(true),
  FAUCET_AMOUNT_USD: z.coerce.number().default(100),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  PIX_MODEL: z.string().default('claude-haiku-4-5'),
  PIX_LLM_ENABLED: bool(true),
  PIX_TIMEOUT_MS: z.coerce.number().int().default(3500),
  PIX_INSIGHT_TTL_S: z.coerce.number().int().default(60),
  PIX_DAILY_BUDGET_USD: z.coerce.number().default(5),
  PIX_CHAT_DAILY_LIMIT: z.coerce.number().int().default(30),

  ADMIN_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET === 'dev-only-change-me') {
    throw new Error('JWT_SECRET must be set in production');
  }
  // Fall back to the generated deployment (tools/abi-sync.ts) when no address is pinned by env,
  // so a fresh deploy is picked up automatically without touching every ARENA_* var by hand.
  const deployment = DEPLOYMENTS[cfg.CHAIN_ID];
  if (deployment) {
    cfg.ARENA_ADDRESS ??= deployment.arena;
    cfg.CHECKPOINT_ORACLE_ADDRESS ??= deployment.checkpointOracle;
    cfg.FAUCET_ADDRESS ??= deployment.faucet;
    cfg.ARENA_DEPLOY_BLOCK ??= deployment.startBlock;
  }
  return cfg;
}
