// Error envelope and revert mapping (F1b §Conventions): every failure is
// `{ error: { code, message, retryAfterMs? } }` with `code` from the shared ErrorCode.

import type { Context } from 'hono';
import { toFunctionSelector } from 'viem';
import type { ErrorCode } from '@bnbplay/shared/dto';
import type { Logger } from './log.ts';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  SESSION_REQUIRED: 401,
  BAD_SIGNATURE: 401,
  INTENT_EXPIRED: 400,
  INSUFFICIENT_CREDITS: 409,
  ROUND_ALREADY_ACTIVE: 409,
  LANE_VERSION_MISMATCH: 409,
  TIER_DISABLED: 409,
  ORACLE_UNAVAILABLE: 503,
  RELAYER_BUSY: 503,
  RELAYER_UNFUNDED: 503,
  CASHOUT_TOO_LATE: 409,
  ROUND_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  FAUCET_COOLDOWN: 429,
  PIX_QUOTA: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(code: ErrorCode, message: string, opts: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts.status ?? ERROR_STATUS[code];
    this.retryAfterMs = opts.retryAfterMs === undefined ? undefined : Math.max(0, Math.ceil(opts.retryAfterMs));
  }
}

export function errorBody(code: ErrorCode, message: string, retryAfterMs?: number) {
  return { error: retryAfterMs === undefined ? { code, message } : { code, message, retryAfterMs } };
}

export function errorResponse(c: Context, err: ApiError): Response {
  if (err.retryAfterMs !== undefined) c.header('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
  return c.json(errorBody(err.code, err.message, err.retryAfterMs), err.status as 400);
}

export function createErrorHandler(log: Logger) {
  return (err: Error, c: Context): Response => {
    if (err instanceof ApiError) return errorResponse(c, err);
    log.error('unhandled api error', { path: c.req.path, err: String(err), stack: err.stack });
    return c.json(errorBody('INTERNAL', 'internal error'), 500);
  };
}

// ── Revert → API code (F1b table) ─────────────────────────────────────────────

const REVERT_CODES: readonly [string, string, ErrorCode][] = [
  ['InvalidSignature', 'InvalidSignature()', 'BAD_SIGNATURE'],
  ['IntentExpired', 'IntentExpired(uint48)', 'INTENT_EXPIRED'],
  ['InsufficientBalance', 'InsufficientBalance(uint256,uint256)', 'INSUFFICIENT_CREDITS'],
  ['PlayerHasOpenRound', 'PlayerHasOpenRound(uint256)', 'ROUND_ALREADY_ACTIVE'],
  ['LaneVersionMismatch', 'LaneVersionMismatch(uint32,uint32)', 'LANE_VERSION_MISMATCH'],
  ['LaneDisabled', 'LaneDisabled(uint8,uint8)', 'TIER_DISABLED'],
  ['AssetDisabled', 'AssetDisabled(uint8)', 'TIER_DISABLED'],
  ['CashOutTooLate', 'CashOutTooLate(uint256,uint40,uint40)', 'CASHOUT_TOO_LATE'],
];

const SELECTOR_CODES = new Map(REVERT_CODES.map(([, sig, code]) => [toFunctionSelector(sig).toLowerCase(), code]));

/** Maps a sender/simulation error (decoded name or raw revert data) to an API code; anything else is INTERNAL. */
export function mapRevertToCode(error: string | undefined | null): ErrorCode {
  if (!error) return 'INTERNAL';
  for (const [name, , code] of REVERT_CODES) {
    if (new RegExp(`\\b${name}\\b`).test(error)) return code;
  }
  for (const m of error.toLowerCase().matchAll(/0x[0-9a-f]{8}/g)) {
    const code = SELECTOR_CODES.get(m[0]);
    if (code) return code;
  }
  return 'INTERNAL';
}

const PUBLIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  BAD_SIGNATURE: 'The signature could not be verified.',
  INTENT_EXPIRED: 'The signed request expired before it reached the chain.',
  INSUFFICIENT_CREDITS: 'Not enough credits for this stake.',
  ROUND_ALREADY_ACTIVE: 'You already have a round in flight.',
  LANE_VERSION_MISMATCH: 'Lane terms changed. Refresh and sign again.',
  TIER_DISABLED: 'This lane is not available right now.',
  CASHOUT_TOO_LATE: 'Round ending — settling at the final price.',
  RELAYER_BUSY: 'The launch queue is full. Try again in a moment.',
  RELAYER_UNFUNDED: 'Launches are paused while the relayer is refilled.',
  INTERNAL: 'The transaction was not confirmed.',
};

/** A player-safe message for a code (raw revert strings are logged, never shown). */
export const publicMessage = (code: ErrorCode): string => PUBLIC_MESSAGES[code] ?? 'Request failed.';
