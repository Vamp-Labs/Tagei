import { z } from 'zod';
import { Hash32, HexString, RoundSchema, UintString } from '@bnbplay/shared/dto';

export const HealthSchema = z.object({ ok: z.boolean(), version: z.string() });

export const ReadinessSchema = z.object({
  ok: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.unknown().optional() })),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

export const OracleRoundRecordSchema = z.object({
  sec: z.number().int(),
  tsMs: z.number().int(),
  price: UintString,
  proofHash: Hash32,
});
export type OracleRoundRecord = z.infer<typeof OracleRoundRecordSchema>;

export const OracleProofSchema = z.object({ proof: HexString });

export const FaucetClaimSchema = z.object({ claimId: z.string() });

export const WithdrawResponseSchema = z.object({ intentId: z.string().optional() });

export const PlayerRoundsPageSchema = z.object({
  items: z.array(RoundSchema),
  nextCursor: z.string().nullable(),
});
export type PlayerRoundsPage = z.infer<typeof PlayerRoundsPageSchema>;

export const PIX_CHAT_EVENTS = {
  'pix.delta': z.object({ text: z.string() }),
  'pix.done': z.object({ usage: z.unknown().optional() }),
  'pix.error': z.object({ code: z.string(), message: z.string().optional() }),
} as const;

export type PixChatEvent =
  | { type: 'pix.delta'; text: string }
  | { type: 'pix.done'; usage: unknown }
  | { type: 'pix.error'; code: string; message: string | null };

export interface PixChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
