// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Shared types for BNB PLAY (F1a §3). Enum values match packages/shared/src/enums.ts.

enum Direction {
    Long,
    Short
}

enum RoundStatus {
    None,
    Open,
    Settled
}

enum Outcome {
    None,
    TargetHit,
    StopHit,
    Timeout,
    CashedOut,
    Voided
}

enum VoidReason {
    None,
    EntryInvalid,
    TerminalInvalid,
    CheckpointGap,
    Stalled
}

struct AssetConfig {
    uint32 pairId;
    uint32 maxJumpPpm;
    uint32 gapMarginPpm;
    bool enabled;
}

struct LaneParams {
    uint32 targetPpm;
    uint32 stopPpm;
    uint32 multiplierBps;
    uint16 feeBps;
    uint16 durationSec;
    bool enabled;
    uint128 minStake;
    uint128 maxStake;
}

struct Lane {
    LaneParams p;
    uint32 version;
}

/// @dev Four storage slots. Every term is snapshotted at open, so later config changes never touch it.
struct Round {
    address player;
    uint8 assetId;
    uint8 tier;
    Direction direction;
    RoundStatus status;
    Outcome outcome;
    bool cashOutRequested;
    uint8 oracleIdx;
    uint40 entrySec;
    uint128 stake;
    uint128 maxPayout;
    uint32 targetPpm;
    uint32 stopPpm;
    uint32 multiplierBps;
    uint16 feeBps;
    uint32 maxJumpPpm;
    uint32 pairId;
    uint40 endSec;
    uint40 openedAt;
    uint128 payout;
    uint40 decisionSec;
    VoidReason voidReason;
}

struct RoundTerms {
    uint8 tier;
    Direction direction;
    uint128 stake;
    uint128 maxPayout;
    uint40 entrySec;
    uint40 endSec;
    uint32 laneVersion;
    uint8 oracleIdx;
    uint32 pairId;
    uint32 targetPpm;
    uint32 stopPpm;
    uint32 multiplierBps;
    uint16 feeBps;
    uint32 maxJumpPpm;
}

struct OpenRoundIntent {
    address player;
    uint8 assetId;
    uint8 tier;
    Direction direction;
    uint128 stake;
    uint32 laneVersion;
    uint8 oracleIdx;
    uint256 nonce;
    uint48 deadline;
}

struct CashOutIntent {
    address player;
    uint256 roundId;
    uint48 deadline;
}

struct WithdrawIntent {
    address player;
    address to;
    uint256 amount;
    uint256 nonce;
    uint48 deadline;
}
