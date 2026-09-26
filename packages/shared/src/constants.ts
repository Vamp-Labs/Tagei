// Frozen protocol constants (F1a v2). Solidity mirrors every value here.
// ENTRY_DELAY 3 s, STALL_AFTER 60 s and the 30 s default duration follow the A1 spike
// (research/spike-report.md §5–6).

export const CHAIN_ID = 97;

export const PPM = 1_000_000n;
export const BPS = 10_000n;
export const PRICE_DECIMALS = 18;
export const STAKE_DECIMALS = 18;

export const ENTRY_DELAY_SEC = 3;
export const EXIT_DELAY_SEC = 2;
export const STALL_AFTER_SEC = 60;

export const DEFAULT_DURATION_SEC = 30;
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

// Short TTLs bound how long a relayer can hold an intent and pick its submit moment (G1 M2).
// External wallets sign at launch time, so the prompt latency is outside this window.
export const INTENT_TTL_SEC = { open: 6, cashOut: 4, withdraw: 60 } as const;
