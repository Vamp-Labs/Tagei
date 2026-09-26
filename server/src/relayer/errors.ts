// Error handling shared by the senders: broadcast-error classification, revert-data
// extraction from viem errors, custom-error decoding and the F1b revert → API code map.

import { decodeErrorResult, type Hex } from 'viem';
import type { ErrorCode } from '@bnbplay/shared/dto';
import { knownErrorsAbi } from '../recorder/abi.ts';

export type SendErrorKind =
  | 'already_known'
  | 'nonce_too_low'
  | 'replacement_underpriced'
  | 'underpriced'
  | 'insufficient_funds'
  /** Definitive rejection for any other reason (intrinsic gas, invalid sender, …). */
  | 'rejected'
  /** Transport failure: the node may or may not have accepted the transaction. */
  | 'ambiguous';

interface ErrLike {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  data?: unknown;
  cause?: unknown;
}

function chain(err: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 12 && cur && typeof cur === 'object'; i++) {
    out.push(cur as ErrLike);
    cur = (cur as ErrLike).cause;
  }
  return out;
}

const TRANSPORT_ERRORS = new Set(['HttpRequestError', 'TimeoutError', 'WebSocketRequestError', 'SocketClosedError', 'AbortError', 'TypeError']);

function text(err: unknown): string {
  return chain(err)
    .flatMap((e) => [e.details, e.shortMessage, e.message].filter((v): v is string => typeof v === 'string'))
    .join(' | ')
    .toLowerCase();
}

export function classifySendError(err: unknown): SendErrorKind {
  const t = text(err);
  if (/already known|known transaction|alreadyknown|already imported|tx already exists/.test(t)) return 'already_known';
  if (/nonce too low|nonce is too low|oldnonce|nonce has already been used/.test(t)) return 'nonce_too_low';
  if (/replacement transaction underpriced|replacement.*underpriced|replacement fee too low/.test(t)) return 'replacement_underpriced';
  if (/underpriced|gas price too low|fee too low|less than block base fee|below minimum/.test(t)) return 'underpriced';
  if (/insufficient funds/.test(t)) return 'insufficient_funds';
  const links = chain(err);
  const transport = links.some((e) => typeof e.name === 'string' && TRANSPORT_ERRORS.has(e.name));
  const rpcReply = links.some((e) => typeof e.name === 'string' && /RpcError$|RpcRequestError/.test(e.name) && !/Http/.test(e.name));
  if (transport && !rpcReply) return 'ambiguous';
  if (/fetch failed|timed out|timeout|econnreset|econnrefused|socket|network|503|502|504|429|rate limit/.test(t) && !rpcReply) return 'ambiguous';
  return 'rejected';
}

/** Finds ABI-encoded revert data anywhere in a viem error chain. */
export function extractRevertData(err: unknown): Hex | undefined {
  for (const e of chain(err)) {
    const d = e.data;
    if (typeof d === 'string' && /^0x[0-9a-fA-F]*$/.test(d) && d.length >= 10) return d as Hex;
    if (d && typeof d === 'object' && typeof (d as { data?: unknown }).data === 'string') {
      const inner = (d as { data: string }).data;
      if (/^0x[0-9a-fA-F]*$/.test(inner) && inner.length >= 10) return inner as Hex;
    }
  }
  return undefined;
}

/** True when the error chain says the call reverted (as opposed to a transport failure). */
export function isRevert(err: unknown): boolean {
  if (extractRevertData(err)) return true;
  return /execution reverted|revert|invalid opcode|out of gas/.test(text(err));
}

export interface DecodedRevert {
  name: string;
  args: readonly unknown[];
  data?: Hex;
}

const PANIC_SELECTOR = '0x4e487b71';
const ERROR_STRING_SELECTOR = '0x08c379a0';

export function decodeRevert(data: Hex | undefined): DecodedRevert | undefined {
  if (!data || data.length < 10) return undefined;
  try {
    const d = decodeErrorResult({ abi: knownErrorsAbi, data });
    return { name: d.errorName, args: (d.args ?? []) as readonly unknown[], data };
  } catch {
    const sel = data.slice(0, 10).toLowerCase();
    if (sel === ERROR_STRING_SELECTOR || sel === PANIC_SELECTOR) {
      try {
        const d = decodeErrorResult({ data });
        return { name: d.errorName, args: (d.args ?? []) as readonly unknown[], data };
      } catch {
        // fall through
      }
    }
    return { name: `unknown(${sel})`, args: [], data };
  }
}

export function describeRevert(err: unknown): DecodedRevert {
  const data = extractRevertData(err);
  const decoded = decodeRevert(data);
  if (decoded) return decoded;
  const short = chain(err).find((e) => typeof e.shortMessage === 'string')?.shortMessage;
  return { name: 'reverted', args: [typeof short === 'string' ? short : text(err).slice(0, 200)] };
}

const API_CODES: Record<string, ErrorCode> = {
  InvalidSignature: 'BAD_SIGNATURE',
  IntentExpired: 'INTENT_EXPIRED',
  InsufficientBalance: 'INSUFFICIENT_CREDITS',
  PlayerHasOpenRound: 'ROUND_ALREADY_ACTIVE',
  LaneVersionMismatch: 'LANE_VERSION_MISMATCH',
  LaneDisabled: 'TIER_DISABLED',
  AssetDisabled: 'TIER_DISABLED',
  CashOutTooLate: 'CASHOUT_TOO_LATE',
};

/** F1b revert → API code; anything unmapped is INTERNAL. */
export const apiErrorCode = (errorName: string | undefined): ErrorCode => (errorName && API_CODES[errorName]) || 'INTERNAL';

/** Reverts that resolve on their own a moment later (clock skew vs. a stale RPC view). */
export const TRANSIENT_REVERTS = new Set(['FutureRound']);

export function formatRevert(r: DecodedRevert): string {
  if (r.args.length === 0) return r.name;
  return `${r.name}(${r.args.map((a) => (typeof a === 'bigint' ? a.toString() : String(a))).join(',')})`;
}
