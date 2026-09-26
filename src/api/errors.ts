import type { ErrorCode } from '@bnbplay/shared/dto';

export const CLIENT_ERROR_CODES = [
  'NETWORK',
  'TIMEOUT',
  'ABORTED',
  'BAD_RESPONSE',
  'API_DISABLED',
  'USER_REJECTED',
  'NO_WALLET',
  'CONTRACTS_NOT_DEPLOYED',
  'LAUNCH_NOT_CONFIRMED',
  'NOT_LIVE',
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];
export type AppErrorCode = ErrorCode | ClientErrorCode;

export interface ApiErrorOptions {
  status?: number | null;
  retryAfterMs?: number | null;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly code: AppErrorCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(code: AppErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const USER_REJECTED_RPC_CODE = 4001;

function hasNumericCode(value: unknown): value is { code: number } {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'number';
}

function causeOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'cause' in value ? value.cause : undefined;
}

export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined; depth++) {
    if (isApiError(current) && current.code === 'USER_REJECTED') return true;
    if (hasNumericCode(current) && current.code === USER_REJECTED_RPC_CODE) return true;
    current = causeOf(current);
  }
  return false;
}

export function toApiError(error: unknown, fallback: AppErrorCode = 'NETWORK'): ApiError {
  if (isApiError(error)) return error;
  if (isUserRejection(error)) return new ApiError('USER_REJECTED', 'The request was rejected in the wallet.', { cause: error });
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return new ApiError(fallback, message, { cause: error });
}
