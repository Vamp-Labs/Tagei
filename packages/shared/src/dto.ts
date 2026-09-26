// REST DTOs (F1b). bigints travel as decimal strings; prices are 18-decimal integers.

import { z } from 'zod';

export const UintString = z.string().regex(/^\d+$/, 'unsigned integer string');
export const IntString = z.string().regex(/^-?\d+$/, 'integer string');
export const AddressString = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'address');
export const HexString = z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex');
export const Hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '32-byte hash');

export const AssetSymbolSchema = z.enum(['BNB', 'BTC', 'ETH', 'SOL', 'DOGE']);
export const DirectionLabelSchema = z.enum(['LONG', 'SHORT']);
export const OutcomeLabelSchema = z.enum(['win', 'loss', 'timeout', 'cashed_out', 'voided']);
export const VoidReasonLabelSchema = z.enum(['entry_invalid', 'terminal_invalid', 'checkpoint_gap', 'stalled']);

export const ErrorCode = z.enum([
  'VALIDATION',
  'SESSION_REQUIRED',
  'BAD_SIGNATURE',
  'INTENT_EXPIRED',
  'INSUFFICIENT_CREDITS',
  'ROUND_ALREADY_ACTIVE',
  'LANE_VERSION_MISMATCH',
  'TIER_DISABLED',
  'ORACLE_UNAVAILABLE',
  'RELAYER_BUSY',
  'RELAYER_UNFUNDED',
  'CASHOUT_TOO_LATE',
  'ROUND_NOT_FOUND',
  'RATE_LIMITED',
  'FAUCET_COOLDOWN',
  'PIX_QUOTA',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), retryAfterMs: z.number().int().optional() }),
});

// ── Config ───────────────────────────────────────────────────────────────────

export const TierSchema = z.object({
  tier: z.number().int(),
  label: z.enum(['CRUISE', 'BOOST', 'HYPER', 'WARP']),
  laneVersion: z.number().int(),
  multiplierBps: z.number().int(),
  targetPpm: z.number().int(),
  stopPpm: z.number().int(),
  feeBps: z.number().int(),
  durationSec: z.number().int(),
  minStake: UintString,
  maxStake: UintString,
  enabled: z.boolean(),
});
export type TierDTO = z.infer<typeof TierSchema>;

export const AssetConfigSchema = z.object({
  assetId: z.number().int(),
  symbol: AssetSymbolSchema,
  pairId: z.number().int(),
  maxJumpPpm: z.number().int(),
  gapMarginPpm: z.number().int(),
  enabled: z.boolean(),
  tiers: z.array(TierSchema),
});

export const ConfigSchema = z.object({
  chainId: z.number().int(),
  explorer: z.string(),
  contracts: z.object({
    arena: AddressString,
    checkpointOracle: AddressString,
    testUsd: AddressString,
    faucet: AddressString,
  }).nullable(),
  activeOracleIdx: z.number().int(),
  oracleTrusted: z.boolean(),
  stakeDecimals: z.number().int(),
  priceDecimals: z.number().int(),
  entryDelaySec: z.number().int(),
  exitDelaySec: z.number().int(),
  stallAfterSec: z.number().int(),
  assets: z.array(AssetConfigSchema),
  features: z.object({ pixLlm: z.boolean(), faucet: z.boolean(), walletConnect: z.boolean() }),
});
export type ConfigDTO = z.infer<typeof ConfigSchema>;

// ── Rounds ───────────────────────────────────────────────────────────────────

export const RoundTermsSchema = z.object({
  tier: z.number().int(),
  direction: DirectionLabelSchema,
  stake: UintString,
  maxPayout: UintString,
  entrySec: z.number().int(),
  endSec: z.number().int(),
  laneVersion: z.number().int(),
  oracleIdx: z.number().int(),
  pairId: z.number().int(),
  targetPpm: z.number().int(),
  stopPpm: z.number().int(),
  multiplierBps: z.number().int(),
  feeBps: z.number().int(),
  maxJumpPpm: z.number().int(),
});
export type RoundTermsDTO = z.infer<typeof RoundTermsSchema>;

export const RoundStatusSchema = z.enum(['open', 'settled']);

export const RoundSchema = z.object({
  roundId: UintString,
  player: AddressString,
  assetId: z.number().int(),
  asset: AssetSymbolSchema,
  status: RoundStatusSchema,
  terms: RoundTermsSchema,
  entryPrice: UintString.nullable(),
  cashOutRequested: z.boolean(),
  exitSec: z.number().int().nullable(),
  outcome: OutcomeLabelSchema.nullable(),
  voidReason: VoidReasonLabelSchema.nullable(),
  payout: UintString.nullable(),
  pnl: IntString.nullable(),
  exitPrice: UintString.nullable(),
  decisionSec: z.number().int().nullable(),
  openTx: Hash32,
  settleTx: Hash32.nullable(),
  openedAtMs: z.number().int(),
  settledAtMs: z.number().int().nullable(),
});
export type RoundDTO = z.infer<typeof RoundSchema>;

export const OpenRoundIntentSchema = z.object({
  player: AddressString,
  assetId: z.number().int(),
  tier: z.number().int(),
  direction: z.number().int().min(0).max(1),
  stake: UintString,
  laneVersion: z.number().int(),
  oracleIdx: z.number().int(),
  nonce: UintString,
  deadline: z.number().int(),
});

export const OpenRoundRequestSchema = z.object({ intent: OpenRoundIntentSchema, signature: HexString });
export const OpenRoundResponseSchema = z.object({ intentId: z.string(), intentHash: Hash32 });

export const CashOutRequestSchema = z.object({
  intent: z.object({ player: AddressString, roundId: UintString, deadline: z.number().int() }),
  signature: HexString,
});
export const CashOutResponseSchema = z.object({ intentId: z.string() });

export const WithdrawRequestSchema = z.object({
  intent: z.object({ player: AddressString, to: AddressString, amount: UintString, nonce: UintString, deadline: z.number().int() }),
  signature: HexString,
});

// ── Auth ─────────────────────────────────────────────────────────────────────

export const AuthChallengeRequestSchema = z.object({ address: AddressString });
export const AuthChallengeResponseSchema = z.object({ salt: Hash32, expiresAt: z.number().int(), chainId: z.number().int() });
export const AuthSessionRequestSchema = z.object({
  address: AddressString,
  salt: Hash32,
  expiresAt: z.number().int(),
  signature: HexString,
  kind: z.enum(['guest', 'wallet']),
});
export const AuthSessionResponseSchema = z.object({ token: z.string(), player: AddressString, expiresAt: z.number().int() });

// ── Player ───────────────────────────────────────────────────────────────────

export const BalanceSchema = z.object({ available: UintString, locked: UintString });
export type BalanceDTO = z.infer<typeof BalanceSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  progress: z.number().int(),
  goal: z.number().int(),
  xp: z.number().int(),
  completed: z.boolean(),
});

export const BadgeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  progress: z.number().int(),
  goal: z.number().int(),
  unlockedAtMs: z.number().int().nullable(),
});

export const ProgressionSchema = z.object({
  xp: z.number().int(),
  level: z.number().int(),
  title: z.string(),
  levelStartXp: z.number().int(),
  nextLevelXp: z.number().int(),
  streakDays: z.number().int(),
  missions: z.array(MissionSchema),
  badges: z.array(BadgeSchema),
});
export type ProgressionDTO = z.infer<typeof ProgressionSchema>;

export const ProfileSchema = z.object({
  address: AddressString,
  displayName: z.string(),
  kind: z.enum(['guest', 'wallet']),
  progression: ProgressionSchema,
  stats: z.object({
    rounds: z.number().int(),
    targetHits: z.number().int(),
    disciplinedExits: z.number().int(),
    bestPayoutX: z.number(),
  }),
});
export type ProfileDTO = z.infer<typeof ProfileSchema>;

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int(),
  address: AddressString,
  displayName: z.string(),
  level: z.number().int(),
  title: z.string(),
  xp: z.number().int(),
});

// ── Market & PIX ─────────────────────────────────────────────────────────────

export const MarketSnapshotSchema = z.object({
  asset: AssetSymbolSchema,
  pairId: z.number().int(),
  price: UintString,
  round: UintString,
  tsMs: z.number().int(),
  change24hPct: z.number().nullable(),
  high24h: UintString.nullable(),
  low24h: UintString.nullable(),
});

export const InsightFactorSchema = z.object({ label: z.string(), value: z.string(), positive: z.boolean().optional() });

export const MarketInsightSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']),
  factors: z.array(InsightFactorSchema),
  learningTip: z.string(),
  source: z.enum(['llm', 'template']),
  generatedAtMs: z.number().int(),
});
export type MarketInsightDTO = z.infer<typeof MarketInsightSchema>;

export const DebriefSchema = z.object({
  headline: z.string(),
  analysis: z.string(),
  keyFactors: z.array(InsightFactorSchema),
  coachingTip: z.string(),
  source: z.enum(['llm', 'template']),
});
export type DebriefDTO = z.infer<typeof DebriefSchema>;
