// PIX AI contract (F1b): the LLM only writes copy and picks factor keys; every
// number shown to the player is computed in code. The guardrail filter is shared
// by the server post-filter and the red-team tests.

import { z } from 'zod';

export const FactorKey = z.enum([
  'momentum_1m',
  'momentum_5m',
  'volume_spike',
  'buy_pressure',
  'volatility',
  'range_position',
  'lane_reach',
  'change_24h',
  'entry_timing',
  'time_to_touch',
  'exit_choice',
  'stop_honored',
  'secured_gain',
]);
export type FactorKey = z.infer<typeof FactorKey>;

export const InsightLLMSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  factorKeys: z.array(FactorKey),
  learningTip: z.string(),
});

export const DebriefLLMSchema = z.object({
  headline: z.string(),
  analysis: z.string(),
  factorKeys: z.array(FactorKey),
  coachingTip: z.string(),
});

export const COPY_LIMITS = { headlineWords: 6, summarySentences: 2, factorCount: 3 } as const;

export const BANNED_PATTERNS: readonly RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bdefinitely\b/i,
  /\bsure (thing|win|bet)\b/i,
  /\bcan'?t lose\b/i,
  /\b100 ?%/i,
  /\brisk[- ]free\b/i,
  /\bdouble (down|up)\b/i,
  /\bwin (it )?back\b/i,
  /\brecover\b.*\bloss/i,
  /\b(increase|raise|bump)\b.*\b(stake|bet|amount)\b/i,
  /\ball[- ]in\b/i,
  /\b(buy|sell|long|short) now\b/i,
  /\byou should (buy|sell|go long|go short)\b/i,
  /\beasy money\b/i,
  /\bdue for\b/i,
  /\bbound to\b/i,
  /\bwill (definitely|surely|certainly)\b/i,
  /\byou (lost|failed)\b/i,
];

/** Returns the patterns a piece of copy violates (empty = safe to show). */
export function guardrailViolations(text: string): string[] {
  return BANNED_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

export const PIX_DISCLAIMER = "Markets can move either way; PIX explains, it doesn't predict.";
