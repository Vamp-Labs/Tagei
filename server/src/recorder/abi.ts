// Local ABI fragments for the F1a v2 contracts (BnbPlayArena, CheckpointOracle,
// IPriceVerifier, TestUSDFaucet) and the Supra proxies A3 monitors.
//
// Hand-written from docs/spec/F1a-contracts.md §3 until A2's generated ABIs land in
// packages/shared/src/chain/ (F2). Swap point for A0: re-export the generated ABIs here
// under the same names (arenaAbi, checkpointOracleAbi, priceVerifierAbi, faucetAbi).
//
// Assumptions not fixed by F1a (flagged in the A3 report):
// - TestUSDFaucet exposes `drip(address player, uint256 amount)` and emits `Dripped`.
// - The Supra verifier errors `NonCanonicalRound` / `FutureRound` take no arguments.
// Solidity enums are ABI-encoded as uint8.

import type { AbiParameter } from 'viem';
import { arenaAbi as generatedArenaAbi, checkpointOracleAbi as generatedCheckpointOracleAbi, faucetAbi as generatedFaucetAbi, statelessSupraVerifierAbi } from '@bnbplay/shared/abi';

type Mutability = 'view' | 'pure' | 'nonpayable' | 'payable';

const p = <const N extends string, const T extends string>(name: N, type: T) => ({ name, type }) as const;
const ix = <const N extends string, const T extends string>(name: N, type: T) => ({ name, type, indexed: true }) as const;
const fn = <const N extends string, const I extends readonly AbiParameter[], const O extends readonly AbiParameter[], const M extends Mutability>(
  name: N,
  inputs: I,
  outputs: O,
  stateMutability: M,
) => ({ type: 'function', name, inputs, outputs, stateMutability }) as const;
const ev = <const N extends string, const I extends readonly (AbiParameter & { indexed?: boolean })[]>(name: N, inputs: I) =>
  ({ type: 'event', name, inputs, anonymous: false }) as const;
const er = <const N extends string, const I extends readonly AbiParameter[]>(name: N, inputs: I) => ({ type: 'error', name, inputs }) as const;

// ── Structs (F1a §3) ─────────────────────────────────────────────────────────

// Contract ABIs come from @bnbplay/shared/abi (generated from contracts/out by tools/abi-sync.ts).

type AbiItem = { readonly type: string };
const only = <const A extends readonly AbiItem[], const T extends string>(abi: A, type: T) =>
  abi.filter((x): x is Extract<A[number], { type: T }> => x.type === type);

export const arenaAbi = generatedArenaAbi;
export const arenaErrorsAbi = only(generatedArenaAbi, 'error');
export const arenaEventsAbi = only(generatedArenaAbi, 'event');

export const supraVerifierErrorsAbi = [
  er('BLSIncorrectInputMessaage', []),
  er('BLSInvalidPublicKeyorSignaturePoints', []),
  er('DataNotVerified', []),
] as const;

export const checkpointOracleAbi = generatedCheckpointOracleAbi;
export const checkpointEventsAbi = only(generatedCheckpointOracleAbi, 'event');

export const priceVerifierAbi = statelessSupraVerifierAbi;

export const faucetAbi = generatedFaucetAbi;
export const faucetEventsAbi = only(generatedFaucetAbi, 'event');

// ── Supra proxies (monitoring only) ──────────────────────────────────────────

export const supraCommitteeVerifierAbi = [
  fn('requireHashVerified_V2', [p('message', 'bytes32'), p('signature', 'uint256[2]'), p('committee_id', 'uint256')], [], 'view'),
  ...supraVerifierErrorsAbi,
] as const;

export const supraProxyEventsAbi = [
  ev('Upgraded', [ix('implementation', 'address')]),
  ev('AdminChanged', [p('previousAdmin', 'address'), p('newAdmin', 'address')]),
  ev('OwnershipTransferred', [ix('previousOwner', 'address'), ix('newOwner', 'address')]),
] as const;

/** Every event the indexer decodes (Arena + CheckpointOracle + faucet). */
export const indexedEventsAbi = [...arenaEventsAbi, ...checkpointEventsAbi, ...faucetEventsAbi];

/** Every custom error the senders can decode from a revert. */
export const knownErrorsAbi = [...arenaErrorsAbi, ...only(generatedCheckpointOracleAbi, 'error'), ...only(statelessSupraVerifierAbi, 'error'), ...supraVerifierErrorsAbi];
