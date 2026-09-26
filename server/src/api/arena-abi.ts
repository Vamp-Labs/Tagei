// Hand-written fragments of the frozen F1a interfaces, used until A0's `abi:sync`
// exports the compiled ABIs into @bnbplay/shared (then swap the imports).

import { parseAbi } from 'viem';

export const arenaAbi = parseAbi([
  'struct OpenRoundIntent { address player; uint8 assetId; uint8 tier; uint8 direction; uint128 stake; uint32 laneVersion; uint8 oracleIdx; uint256 nonce; uint48 deadline; }',
  'struct CashOutIntent { address player; uint256 roundId; uint48 deadline; }',
  'struct WithdrawIntent { address player; address to; uint256 amount; uint256 nonce; uint48 deadline; }',
  'struct AssetConfig { uint32 pairId; uint32 maxJumpPpm; uint32 gapMarginPpm; bool enabled; }',
  'struct LaneParams { uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps; uint16 durationSec; bool enabled; uint128 minStake; uint128 maxStake; }',
  'struct Lane { LaneParams p; uint32 version; }',
  'function openRoundWithSig(OpenRoundIntent i, bytes sig) returns (uint256 roundId)',
  'function requestCashOutWithSig(CashOutIntent c, bytes sig) returns (uint40 exitSec)',
  'function withdrawWithSig(WithdrawIntent w, bytes sig)',
  'function balanceOf(address player) view returns (uint256)',
  'function activeRoundOf(address player) view returns (uint256)',
  'function getAsset(uint8 assetId) view returns (AssetConfig)',
  'function getLane(uint8 assetId, uint8 tier) view returns (Lane)',
  'function activeOracleIdx() view returns (uint8)',
  'function oracles(uint256 idx) view returns (address)',
]);

export const checkpointOracleAbi = parseAbi(['function verifier() view returns (address)']);

export const priceVerifierAbi = parseAbi(['function isTrusted() view returns (bool)']);

/**
 * TestUSDFaucet drip. F1a names the contract but not the entry point; this assumes
 * `drip(address player, uint256 amount)` (OPERATOR_ROLE, deposits via arena.depositFor).
 * Confirm with A2 — the faucet service takes the encoder as a dependency.
 */
export const faucetAbi = parseAbi(['function drip(address player, uint256 amount)']);
