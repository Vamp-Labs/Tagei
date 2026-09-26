// SSE event catalog for GET /v1/stream (F1b). Player events carry monotonically
// increasing ids and replay on Last-Event-ID; price events carry no id.

import { z } from 'zod';
import {
  AssetSymbolSchema,
  BalanceSchema,
  DebriefSchema,
  ErrorCode,
  Hash32,
  MissionSchema,
  RoundSchema,
  UintString,
  VoidReasonLabelSchema,
} from './dto.ts';

export const OracleStatusSchema = z.enum(['ok', 'degraded', 'down']);
export const SettlementStepSchema = z.enum(['idle', 'preparing', 'signing', 'submitted', 'confirmed', 'failed']);

const PriceRoundTuple = z.tuple([UintString, z.number().int(), UintString]); // [round, tsMs, price18]

export const SSE_EVENTS = {
  hello: z.object({
    v: z.literal(1),
    serverTimeMs: z.number().int(),
    oracle: z.object({ source: z.literal('supra-dora2'), status: OracleStatusSchema, lagMsP50: z.number().nullable() }),
    player: z.object({ activeRound: RoundSchema.nullable(), lastSettled: RoundSchema.nullable() }).nullable(),
  }),
  'prices.snapshot': z.object({
    assets: z.partialRecord(AssetSymbolSchema, z.object({ pairId: z.number().int(), rounds: z.array(PriceRoundTuple) })),
    stats: z.partialRecord(
      AssetSymbolSchema,
      z.object({ open24h: UintString.nullable(), change24hPct: z.number().nullable(), high24h: UintString.nullable(), low24h: UintString.nullable() }),
    ),
  }),
  price: z.object({
    asset: AssetSymbolSchema,
    pairId: z.number().int(),
    round: UintString,
    tsMs: z.number().int(),
    price: UintString,
    lagMs: z.number().int(),
  }),
  stats: z.object({
    asset: AssetSymbolSchema,
    change24hPct: z.number().nullable(),
    sigma1sPpm: z.number(),
    momentum60sPpm: z.number(),
  }),
  'oracle.status': z.object({
    status: OracleStatusSchema,
    pairs: z.partialRecord(AssetSymbolSchema, z.object({ ageMs: z.number().int() })),
  }),
  'settlement.step': z.object({
    kind: z.enum(['open', 'cashout', 'settle', 'withdraw', 'faucet', 'void']),
    intentId: z.string().nullable(),
    roundId: UintString.nullable(),
    step: SettlementStepSchema,
    txHash: Hash32.nullable(),
    error: z.object({ code: ErrorCode, message: z.string() }).nullable(),
  }),
  'round.opened': RoundSchema,
  'round.open_failed': z.object({ intentId: z.string(), code: ErrorCode, message: z.string(), stakeTaken: z.literal(false) }),
  'round.entry_locked': z.object({ roundId: UintString, entrySec: z.number().int(), entryPrice: UintString }),
  'round.touch': z.object({
    roundId: UintString,
    kind: z.enum(['target', 'stop']),
    sec: z.number().int(),
    price: UintString,
    thresholdPrice: UintString,
  }),
  'round.cashout_requested': z.object({ roundId: UintString, exitSec: z.number().int(), txHash: Hash32 }),
  'round.exit_locked': z.object({ roundId: UintString, exitSec: z.number().int(), exitPrice: UintString }),
  'round.settled': RoundSchema,
  'round.voided': z.object({ roundId: UintString, reason: VoidReasonLabelSchema, payout: UintString }),
  balance: BalanceSchema,
  'progression.updated': z.object({
    roundId: UintString.nullable(),
    xpBefore: z.number().int(),
    xpAfter: z.number().int(),
    gained: z.array(z.object({ reason: z.string(), amount: z.number().int() })),
    level: z.number().int(),
    title: z.string(),
    levelStartXp: z.number().int(),
    nextLevelXp: z.number().int(),
    leveledUp: z.boolean(),
    missions: z.array(MissionSchema),
    missionJustCompleted: z.string().nullable(),
    streakDays: z.number().int(),
    badgesUnlocked: z.array(z.object({ id: z.string(), title: z.string() })),
  }),
  'pix.debrief': z.object({ roundId: UintString, debrief: DebriefSchema }),
} as const;

export type SseEventName = keyof typeof SSE_EVENTS;
export type SsePayload<E extends SseEventName> = z.infer<(typeof SSE_EVENTS)[E]>;

/** Events that are persisted per player and replayable via Last-Event-ID. */
export const PLAYER_EVENTS: readonly SseEventName[] = [
  'settlement.step',
  'round.opened',
  'round.open_failed',
  'round.entry_locked',
  'round.touch',
  'round.cashout_requested',
  'round.exit_locked',
  'round.settled',
  'round.voided',
  'balance',
  'progression.updated',
  'pix.debrief',
];
