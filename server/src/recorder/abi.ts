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

type Mutability = 'view' | 'pure' | 'nonpayable' | 'payable';

const p = <const N extends string, const T extends string>(name: N, type: T) => ({ name, type }) as const;
const ix = <const N extends string, const T extends string>(name: N, type: T) => ({ name, type, indexed: true }) as const;
const tuple = <const N extends string, const C extends readonly AbiParameter[]>(name: N, components: C) =>
  ({ name, type: 'tuple', components }) as const;
const tupleArray = <const N extends string, const C extends readonly AbiParameter[]>(name: N, components: C) =>
  ({ name, type: 'tuple[]', components }) as const;
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

const ASSET_CONFIG = [p('pairId', 'uint32'), p('maxJumpPpm', 'uint32'), p('gapMarginPpm', 'uint32'), p('enabled', 'bool')] as const;

const LANE_PARAMS = [
  p('targetPpm', 'uint32'),
  p('stopPpm', 'uint32'),
  p('multiplierBps', 'uint32'),
  p('feeBps', 'uint16'),
  p('durationSec', 'uint16'),
  p('enabled', 'bool'),
  p('minStake', 'uint128'),
  p('maxStake', 'uint128'),
] as const;

const LANE = [tuple('p', LANE_PARAMS), p('version', 'uint32')] as const;

const ROUND = [
  p('player', 'address'),
  p('assetId', 'uint8'),
  p('tier', 'uint8'),
  p('direction', 'uint8'),
  p('status', 'uint8'),
  p('outcome', 'uint8'),
  p('cashOutRequested', 'bool'),
  p('oracleIdx', 'uint8'),
  p('entrySec', 'uint40'),
  p('stake', 'uint128'),
  p('maxPayout', 'uint128'),
  p('targetPpm', 'uint32'),
  p('stopPpm', 'uint32'),
  p('multiplierBps', 'uint32'),
  p('feeBps', 'uint16'),
  p('maxJumpPpm', 'uint32'),
  p('pairId', 'uint32'),
  p('endSec', 'uint40'),
  p('openedAt', 'uint40'),
  p('payout', 'uint128'),
  p('decisionSec', 'uint40'),
  p('voidReason', 'uint8'),
] as const;

const ROUND_TERMS = [
  p('tier', 'uint8'),
  p('direction', 'uint8'),
  p('stake', 'uint128'),
  p('maxPayout', 'uint128'),
  p('entrySec', 'uint40'),
  p('endSec', 'uint40'),
  p('laneVersion', 'uint32'),
  p('oracleIdx', 'uint8'),
  p('pairId', 'uint32'),
  p('targetPpm', 'uint32'),
  p('stopPpm', 'uint32'),
  p('multiplierBps', 'uint32'),
  p('feeBps', 'uint16'),
  p('maxJumpPpm', 'uint32'),
] as const;

const OPEN_ROUND_INTENT = [
  p('player', 'address'),
  p('assetId', 'uint8'),
  p('tier', 'uint8'),
  p('direction', 'uint8'),
  p('stake', 'uint128'),
  p('laneVersion', 'uint32'),
  p('oracleIdx', 'uint8'),
  p('nonce', 'uint256'),
  p('deadline', 'uint48'),
] as const;

const CASH_OUT_INTENT = [p('player', 'address'), p('roundId', 'uint256'), p('deadline', 'uint48')] as const;

const WITHDRAW_INTENT = [p('player', 'address'), p('to', 'address'), p('amount', 'uint256'), p('nonce', 'uint256'), p('deadline', 'uint48')] as const;

const CHECKPOINT = [p('price18', 'uint128'), p('tsMs', 'uint64'), p('flags', 'uint8')] as const;

// ── Custom errors (names frozen by F1a; the backend maps them to API codes) ────

export const arenaErrorsAbi = [
  er('InvalidSignature', []),
  er('IntentExpired', [p('deadline', 'uint48')]),
  er('AssetDisabled', [p('assetId', 'uint8')]),
  er('LaneDisabled', [p('assetId', 'uint8'), p('tier', 'uint8')]),
  er('LaneVersionMismatch', [p('expected', 'uint32'), p('actual', 'uint32')]),
  er('OracleMismatch', [p('expected', 'uint8'), p('actual', 'uint8')]),
  er('StakeOutOfRange', [p('stake', 'uint256'), p('min', 'uint256'), p('max', 'uint256')]),
  er('InsufficientBalance', [p('needed', 'uint256'), p('available', 'uint256')]),
  er('PlayerHasOpenRound', [p('roundId', 'uint256')]),
  er('InsufficientHouseLiquidity', [p('needed', 'uint256'), p('available', 'uint256')]),
  er('UtilizationCapExceeded', [p('reserved', 'uint256'), p('cap', 'uint256')]),
  er('MaxPayoutExceeded', [p('maxPayout', 'uint256'), p('limit', 'uint256')]),
  er('EntryNotInFuture', [p('entrySec', 'uint40'), p('latestKnownSec', 'uint40')]),
  er('ExitNotInFuture', [p('exitSec', 'uint40'), p('latestKnownSec', 'uint40')]),
  er('RoundNotOpen', [p('roundId', 'uint256')]),
  er('NotRoundPlayer', [p('roundId', 'uint256'), p('caller', 'address')]),
  er('CashOutAlreadyRequested', [p('roundId', 'uint256')]),
  er('CashOutTooLate', [p('roundId', 'uint256'), p('exitSec', 'uint40'), p('endSec', 'uint40')]),
  er('NotDecidable', [p('roundId', 'uint256'), p('missingSec', 'uint40')]),
  er('NotVoidable', [p('roundId', 'uint256'), p('detail', 'uint256')]),
  er('InvalidLane', []),
  er('HouseEdgeViolated', []),
  er('ZeroAmount', []),
  // Supra verifiers (F1a §3) and OpenZeppelin
  er('NonCanonicalRound', []),
  er('FutureRound', []),
  er('EnforcedPause', []),
  er('AccessControlUnauthorizedAccount', [p('account', 'address'), p('neededRole', 'bytes32')]),
] as const;

export const supraVerifierErrorsAbi = [
  er('BLSIncorrectInputMessaage', []),
  er('BLSInvalidPublicKeyorSignaturePoints', []),
  er('DataNotVerified', []),
] as const;

// ── BnbPlayArena ─────────────────────────────────────────────────────────────

export const arenaEventsAbi = [
  ev('RoundOpened', [ix('roundId', 'uint256'), ix('player', 'address'), ix('assetId', 'uint8'), tuple('terms', ROUND_TERMS)]),
  ev('CashOutRequested', [ix('roundId', 'uint256'), ix('player', 'address'), p('requestedAt', 'uint40'), p('exitSec', 'uint40')]),
  ev('RoundSettled', [
    ix('roundId', 'uint256'),
    ix('player', 'address'),
    ix('outcome', 'uint8'),
    p('payout', 'uint256'),
    p('pnl', 'int256'),
    p('entryPrice', 'uint256'),
    p('exitPrice', 'uint256'),
    p('decisionSec', 'uint40'),
    p('voidReason', 'uint8'),
  ]),
  ev('Deposited', [ix('player', 'address'), ix('from', 'address'), p('amount', 'uint256')]),
  ev('Withdrawn', [ix('player', 'address'), ix('to', 'address'), p('amount', 'uint256')]),
  ev('HouseFunded', [ix('from', 'address'), p('amount', 'uint256')]),
  ev('HouseWithdrawn', [ix('to', 'address'), p('amount', 'uint256')]),
  ev('Skimmed', [p('amount', 'uint256')]),
  ev('AssetConfigured', [ix('assetId', 'uint8'), tuple('config', ASSET_CONFIG)]),
  ev('LaneConfigured', [ix('assetId', 'uint8'), ix('tier', 'uint8'), ix('version', 'uint32'), tuple('params', LANE_PARAMS)]),
  ev('LimitsUpdated', [p('maxUtilizationBps', 'uint16'), p('maxPayoutPerRound', 'uint128')]),
  ev('OracleAdded', [ix('idx', 'uint8'), p('oracle', 'address'), p('sourceId', 'bytes32'), p('trusted', 'bool')]),
  ev('ActiveOracleSet', [ix('idx', 'uint8')]),
] as const;

export const arenaAbi = [
  fn('deposit', [p('amount', 'uint256')], [], 'nonpayable'),
  fn('depositFor', [p('player', 'address'), p('amount', 'uint256')], [], 'nonpayable'),
  fn('withdraw', [p('to', 'address'), p('amount', 'uint256')], [], 'nonpayable'),
  fn('withdrawWithSig', [tuple('w', WITHDRAW_INTENT), p('sig', 'bytes')], [], 'nonpayable'),
  fn(
    'openRound',
    [p('assetId', 'uint8'), p('tier', 'uint8'), p('d', 'uint8'), p('stake', 'uint128'), p('laneVersion', 'uint32'), p('oracleIdx', 'uint8')],
    [p('roundId', 'uint256')],
    'nonpayable',
  ),
  fn('openRoundWithSig', [tuple('i', OPEN_ROUND_INTENT), p('sig', 'bytes')], [p('roundId', 'uint256')], 'nonpayable'),
  fn('requestCashOut', [p('roundId', 'uint256')], [p('exitSec', 'uint40')], 'nonpayable'),
  fn('requestCashOutWithSig', [tuple('c', CASH_OUT_INTENT), p('sig', 'bytes')], [p('exitSec', 'uint40')], 'nonpayable'),
  fn('settle', [p('roundId', 'uint256')], [p('outcome', 'uint8'), p('payout', 'uint256')], 'nonpayable'),
  fn('settleMany', [p('roundIds', 'uint256[]')], [], 'nonpayable'),
  fn('recordAndSettle', [p('oracleIdx', 'uint8'), p('proof', 'bytes'), p('roundIds', 'uint256[]')], [], 'nonpayable'),
  fn('voidStale', [p('roundId', 'uint256')], [], 'nonpayable'),
  fn(
    'previewSettle',
    [p('roundId', 'uint256')],
    [p('decidable', 'bool'), p('outcome', 'uint8'), p('payout', 'uint256'), p('decisionSec', 'uint40'), p('missingSec', 'uint40')],
    'view',
  ),
  fn('getRound', [p('roundId', 'uint256')], [tuple('', ROUND)], 'view'),
  fn('quoteMaxPayout', [p('assetId', 'uint8'), p('tier', 'uint8'), p('stake', 'uint128')], [p('', 'uint256')], 'view'),
  fn('hashOpenRound', [tuple('i', OPEN_ROUND_INTENT)], [p('', 'bytes32')], 'view'),
  fn('hashCashOut', [tuple('c', CASH_OUT_INTENT)], [p('', 'bytes32')], 'view'),
  fn('hashWithdraw', [tuple('w', WITHDRAW_INTENT)], [p('', 'bytes32')], 'view'),
  fn('nonces', [p('owner', 'address'), p('key', 'uint192')], [p('', 'uint256')], 'view'),
  fn('balanceOf', [p('player', 'address')], [p('', 'uint256')], 'view'),
  fn('activeRoundOf', [p('player', 'address')], [p('', 'uint256')], 'view'),
  fn('getAsset', [p('assetId', 'uint8')], [tuple('', ASSET_CONFIG)], 'view'),
  fn('getLane', [p('assetId', 'uint8'), p('tier', 'uint8')], [tuple('', LANE)], 'view'),
  fn('oracles', [p('idx', 'uint256')], [p('', 'address')], 'view'),
  fn('activeOracleIdx', [], [p('', 'uint8')], 'view'),
  fn('houseFree', [], [p('', 'uint256')], 'view'),
  fn('houseReserved', [], [p('', 'uint256')], 'view'),
  fn('stakesLocked', [], [p('', 'uint256')], 'view'),
  fn('totalPlayerBalances', [], [p('', 'uint256')], 'view'),
  fn('surplus', [], [p('', 'uint256')], 'view'),
  fn('paused', [], [p('', 'bool')], 'view'),
  fn('fundHouse', [p('amount', 'uint256')], [], 'nonpayable'),
  fn('withdrawHouse', [p('to', 'address'), p('amount', 'uint256')], [], 'nonpayable'),
  fn('skim', [], [], 'nonpayable'),
  fn('setAsset', [p('assetId', 'uint8'), tuple('c', ASSET_CONFIG)], [], 'nonpayable'),
  fn('setLane', [p('assetId', 'uint8'), p('tier', 'uint8'), tuple('p', LANE_PARAMS)], [], 'nonpayable'),
  fn('setLimits', [p('maxUtilizationBps', 'uint16'), p('maxPayoutPerRound', 'uint128')], [], 'nonpayable'),
  fn('addOracle', [p('o', 'address')], [], 'nonpayable'),
  fn('setActiveOracle', [p('idx', 'uint8')], [], 'nonpayable'),
  fn('pause', [], [], 'nonpayable'),
  fn('unpause', [], [], 'nonpayable'),
  ...arenaEventsAbi,
  ...arenaErrorsAbi,
] as const;

// ── CheckpointOracle + IPriceVerifier ────────────────────────────────────────

export const checkpointEventsAbi = [
  ev('CheckpointRecorded', [ix('pairId', 'uint32'), ix('sec', 'uint40'), p('price18', 'uint128'), p('tsMs', 'uint64')]),
  ev('CheckpointDisputed', [ix('pairId', 'uint32'), ix('sec', 'uint40'), p('recorded', 'uint128'), p('conflicting', 'uint128')]),
] as const;

export const checkpointOracleAbi = [
  fn('verifier', [], [p('', 'address')], 'view'),
  fn('record', [p('proof', 'bytes')], [p('newlyRecorded', 'uint256')], 'nonpayable'),
  fn('get', [p('pairId', 'uint32'), p('sec', 'uint40')], [tuple('', CHECKPOINT)], 'view'),
  fn('getRange', [p('pairId', 'uint32'), p('fromSec', 'uint40'), p('toSec', 'uint40')], [tupleArray('', CHECKPOINT)], 'view'),
  fn('lastRecordedSec', [p('pairId', 'uint32')], [p('', 'uint40')], 'view'),
  fn('latestKnownSec', [p('pairId', 'uint32')], [p('', 'uint40')], 'view'),
  fn('isPermanentlyMissing', [p('pairId', 'uint32'), p('sec', 'uint40')], [p('', 'bool')], 'view'),
  ...checkpointEventsAbi,
  ...arenaErrorsAbi,
] as const;

export const priceVerifierAbi = [
  fn('latestRoundMs', [p('pairId', 'uint32')], [p('', 'uint64')], 'view'),
  fn('supportsLateVerification', [], [p('', 'bool')], 'view'),
  fn('sourceId', [], [p('', 'bytes32')], 'view'),
  fn('isTrusted', [], [p('', 'bool')], 'view'),
] as const;

// ── TestUSDFaucet (assumed shape, see header) ────────────────────────────────

export const faucetEventsAbi = [ev('Dripped', [ix('player', 'address'), p('amount', 'uint256')])] as const;

export const faucetAbi = [fn('drip', [p('player', 'address'), p('amount', 'uint256')], [], 'nonpayable'), ...faucetEventsAbi, ...arenaErrorsAbi] as const;

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
export const indexedEventsAbi = [...arenaEventsAbi, ...checkpointEventsAbi, ...faucetEventsAbi] as const;

/** Every custom error the senders can decode from a revert. */
export const knownErrorsAbi = [...arenaErrorsAbi, ...supraVerifierErrorsAbi] as const;
