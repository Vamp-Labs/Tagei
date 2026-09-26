// Frozen protocol constants (F1a). Solidity mirrors every value here.

export const CHAIN_ID = 97;

export const PPM = 1_000_000n;
export const BPS = 10_000n;
export const PRICE_DECIMALS = 18;
export const STAKE_DECIMALS = 18;

export const ENTRY_DELAY_SEC = 2;
export const EXIT_DELAY_SEC = 2;
export const STALL_AFTER_SEC = 300;

export const MIN_DURATION_SEC = 5;
export const MAX_DURATION_SEC = 120;
export const MIN_MULTIPLIER_BPS = 10_001;
export const MAX_MULTIPLIER_BPS = 100_000;
export const MAX_FEE_BPS = 1_000;
export const MIN_BARRIER_PPM = 10;
export const MAX_BARRIER_PPM = 100_000;

export const MAX_ROUND_IDS_PER_SETTLE = 100;
export const MAX_RANGE_SECONDS = 256;

export const NONCE_KEY = { open: 0n, withdraw: 1n, session: 2n } as const;

export const INTENT_TTL_SEC = { open: 5, cashOut: 3, withdraw: 60 } as const;
