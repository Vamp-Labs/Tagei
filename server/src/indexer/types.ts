// Indexer types: the full round record behind the RoundBook port, stored events, and the
// RoundDTO mapping (F1b). DTO `terms` is the RoundOpened snapshot; `exitSec` carries a cash-out.

import { getAddress, type Address, type Hex } from 'viem';
import { assetById } from '@bnbplay/shared/assets';
import type { RoundDTO } from '@bnbplay/shared/dto';
import { directionLabel, outcomeLabel, voidReasonLabel, type Direction, type Outcome, type VoidReason } from '@bnbplay/shared/enums';
import type { RoundState } from '../ports.ts';

export interface ChainRound extends RoundState {
  tier: number;
  laneVersion: number;
  oracleIdx: number;
  /** terms.endSec as opened; RoundState.terms.endSec is shortened by a cash-out. */
  openedEndSec: number;
  exitSec: number | null;
  entryPrice: bigint | null;
  outcome: Outcome | null;
  voidReason: VoidReason | null;
  payout: bigint | null;
  pnl: bigint | null;
  exitPrice: bigint | null;
  decisionSec: number | null;
  openBlock: bigint;
  openLogIndex: number;
  openedAtMs: number;
  cashOutTx: Hex | null;
  settleTx: Hex | null;
  settleBlock: bigint | null;
  settledAtMs: number | null;
  settleFinalized: boolean;
  updatedAtMs: number;
}

export interface StoredEvent {
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  address: Address;
  name: string;
  /** Decoded args with bigints kept as bigint in memory (stringified when persisted). */
  args: Record<string, unknown>;
  finalized: boolean;
  source: 'logs' | 'receipt';
}

export interface BlockRef {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  timestampSec: number;
}

export interface Cursor {
  number: bigint;
  hash: Hex;
}

export const eventKey = (e: { txHash: Hex; logIndex: number }): string => `${e.txHash.toLowerCase()}:${e.logIndex}`;

export function roundToDTO(r: ChainRound): RoundDTO {
  const t = r.terms;
  const settled = r.status === 'settled';
  return {
    roundId: r.roundId.toString(),
    player: getAddress(r.player),
    assetId: r.assetId,
    asset: assetById(r.assetId).symbol,
    status: r.status,
    terms: {
      tier: r.tier,
      direction: directionLabel(t.direction as Direction),
      stake: t.stake.toString(),
      maxPayout: t.maxPayout.toString(),
      entrySec: t.entrySec,
      endSec: r.openedEndSec,
      laneVersion: r.laneVersion,
      oracleIdx: r.oracleIdx,
      pairId: r.pairId,
      targetPpm: t.targetPpm,
      stopPpm: t.stopPpm,
      multiplierBps: t.multiplierBps,
      feeBps: t.feeBps,
      maxJumpPpm: t.maxJumpPpm,
    },
    entryPrice: r.entryPrice !== null && r.entryPrice > 0n ? r.entryPrice.toString() : null,
    cashOutRequested: t.cashOutRequested,
    exitSec: r.exitSec,
    outcome: settled && r.outcome !== null ? outcomeLabel(r.outcome) : null,
    voidReason: settled && r.voidReason !== null ? voidReasonLabel(r.voidReason) : null,
    payout: settled && r.payout !== null ? r.payout.toString() : null,
    pnl: settled && r.pnl !== null ? r.pnl.toString() : null,
    exitPrice: settled && r.exitPrice !== null && r.exitPrice > 0n ? r.exitPrice.toString() : null,
    decisionSec: settled ? r.decisionSec : null,
    openTx: r.openTx,
    settleTx: r.settleTx,
    openedAtMs: r.openedAtMs,
    settledAtMs: r.settledAtMs,
  };
}
