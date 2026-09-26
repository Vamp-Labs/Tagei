// EIP-712 definitions (F1a). Type strings must equal the Solidity typehash preimages.

import type { Address, Hex } from 'viem';

export const ARENA_DOMAIN_NAME = 'BnbPlayArena';
export const ARENA_DOMAIN_VERSION = '1';

export const arenaDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: ARENA_DOMAIN_NAME, version: ARENA_DOMAIN_VERSION, chainId, verifyingContract }) as const;

export const arenaTypes = {
  OpenRound: [
    { name: 'player', type: 'address' },
    { name: 'assetId', type: 'uint8' },
    { name: 'tier', type: 'uint8' },
    { name: 'direction', type: 'uint8' },
    { name: 'stake', type: 'uint128' },
    { name: 'laneVersion', type: 'uint32' },
    { name: 'oracleIdx', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
  ],
  CashOut: [
    { name: 'player', type: 'address' },
    { name: 'roundId', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
  ],
  Withdraw: [
    { name: 'player', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint48' },
  ],
} as const;

/** P1 — on-chain session keys for external wallets. Not deployed in P0. */
export const sessionGrantTypes = {
  SessionGrant: [
    { name: 'player', type: 'address' },
    { name: 'sessionKey', type: 'address' },
    { name: 'maxStakePerRound', type: 'uint128' },
    { name: 'stakeAllowance', type: 'uint128' },
    { name: 'expiry', type: 'uint48' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export const TYPE_STRINGS = {
  OpenRound:
    'OpenRound(address player,uint8 assetId,uint8 tier,uint8 direction,uint128 stake,uint32 laneVersion,uint8 oracleIdx,uint256 nonce,uint48 deadline)',
  CashOut: 'CashOut(address player,uint256 roundId,uint48 deadline)',
  Withdraw: 'Withdraw(address player,address to,uint256 amount,uint256 nonce,uint48 deadline)',
  SessionGrant:
    'SessionGrant(address player,address sessionKey,uint128 maxStakePerRound,uint128 stakeAllowance,uint48 expiry,uint256 nonce)',
} as const;

/** OpenZeppelin NoncesKeyed packs the key into the upper 192 bits: nonce = (key << 64) | sequence. */
export const packKeyedNonce = (key: bigint, sequence: bigint): bigint => (key << 64n) | sequence;

export interface OpenRoundMessage {
  player: Address;
  assetId: number;
  tier: number;
  direction: number;
  stake: bigint;
  laneVersion: number;
  oracleIdx: number;
  nonce: bigint;
  deadline: number;
}

export interface CashOutMessage {
  player: Address;
  roundId: bigint;
  deadline: number;
}

export interface WithdrawMessage {
  player: Address;
  to: Address;
  amount: bigint;
  nonce: bigint;
  deadline: number;
}

// Off-chain API login (never verified on-chain). Exchanged for a 24 h JWT.
export const API_DOMAIN_NAME = 'BnbPlayAPI';
export const API_DOMAIN_VERSION = '1';

export const apiDomain = (chainId: number) => ({ name: API_DOMAIN_NAME, version: API_DOMAIN_VERSION, chainId }) as const;

export const loginTypes = {
  Login: [
    { name: 'player', type: 'address' },
    { name: 'salt', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint48' },
  ],
} as const;

export interface LoginMessage {
  player: Address;
  salt: Hex;
  expiresAt: number;
}
