// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICheckpointOracle} from "../oracle/interfaces/ICheckpointOracle.sol";
import {
    AssetConfig,
    CashOutIntent,
    Direction,
    Lane,
    LaneParams,
    OpenRoundIntent,
    Outcome,
    Round,
    RoundTerms,
    TuneBounds,
    VoidReason,
    WithdrawIntent
} from "../types/ArenaTypes.sol";

/// @notice BNB PLAY Arena (F1a §3). Error names are frozen: the backend maps them to API codes (F1b).
interface IBnbPlayArena {
    // ── Frozen errors ───────────────────────────────────────────────────────────
    error InvalidSignature();
    error IntentExpired(uint48 deadline);
    error AssetDisabled(uint8 assetId);
    error LaneDisabled(uint8 assetId, uint8 tier);
    /// @dev (current on-chain version, version in the request)
    error LaneVersionMismatch(uint32 current, uint32 requested);
    /// @dev (active oracle index, index in the request)
    error OracleMismatch(uint8 active, uint8 requested);
    error StakeOutOfRange(uint256 stake, uint256 minStake, uint256 maxStake);
    error InsufficientBalance(uint256 balance, uint256 needed);
    error PlayerHasOpenRound(uint256 roundId);
    /// @dev (houseFree, reserve the round needs)
    error InsufficientHouseLiquidity(uint256 available, uint256 needed);
    /// @dev (houseReserved after the open, cap = maxUtilizationBps · house / 1e4)
    error UtilizationCapExceeded(uint256 reservedAfter, uint256 cap);
    error MaxPayoutExceeded(uint256 maxPayout, uint256 limit);
    error EntryNotInFuture(uint40 entrySec, uint40 latestKnownSec);
    error ExitNotInFuture(uint40 exitSec, uint40 latestKnownSec);
    error RoundNotOpen(uint256 roundId);
    error NotRoundPlayer(uint256 roundId, address caller);
    error CashOutAlreadyRequested(uint256 roundId);
    error CashOutTooLate(uint256 roundId, uint40 exitSec, uint40 endSec);
    error NotDecidable(uint256 roundId, uint40 missingSec);
    /// @dev `voidableAfter` = the timestamp after which the round can be voided as Stalled if it is still
    /// undecidable, or 0 when the round is decidable with a real outcome (call `settle`).
    error NotVoidable(uint256 roundId, uint256 voidableAfter);
    error InvalidLane();
    error HouseEdgeViolated();
    error ZeroAmount();

    // ── Additional errors ───────────────────────────────────────────────────────
    error ZeroAddress();
    error InvalidAsset();
    error InvalidLimits();
    error InvalidOracle(uint256 idx);
    error TooManyIds(uint256 count, uint256 max);
    error TuneOutOfBounds(uint32 targetPpm, uint32 stopPpm);
    error OnlySelf();

    // ── Events ──────────────────────────────────────────────────────────────────
    event RoundOpened(uint256 indexed roundId, address indexed player, uint8 indexed assetId, RoundTerms terms);
    event CashOutRequested(uint256 indexed roundId, address indexed player, uint40 requestedAt, uint40 exitSec);
    event RoundSettled(
        uint256 indexed roundId,
        address indexed player,
        Outcome indexed outcome,
        uint256 payout,
        int256 pnl,
        uint256 entryPrice,
        uint256 exitPrice,
        uint40 decisionSec,
        VoidReason voidReason
    );
    event Deposited(address indexed player, address indexed from, uint256 amount);
    event Withdrawn(address indexed player, address indexed to, uint256 amount);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event Skimmed(uint256 amount);
    event AssetConfigured(uint8 indexed assetId, AssetConfig config);
    event LaneConfigured(uint8 indexed assetId, uint8 indexed tier, uint32 indexed version, LaneParams params);
    event LimitsUpdated(uint16 maxUtilizationBps, uint128 maxPayoutPerRound);
    event LaneTuneBoundsSet(uint8 indexed assetId, uint8 indexed tier, TuneBounds bounds);
    event OracleAdded(uint8 indexed idx, address oracle, bytes32 sourceId, bool trusted);
    event ActiveOracleSet(uint8 indexed idx);

    // ── Ledger ──────────────────────────────────────────────────────────────────
    function deposit(uint256 amount) external;
    /// @notice Pulls from msg.sender and credits `player`.
    function depositFor(address player, uint256 amount) external;
    function withdraw(address to, uint256 amount) external;
    function withdrawWithSig(WithdrawIntent calldata w, bytes calldata sig) external;

    // ── Rounds ──────────────────────────────────────────────────────────────────
    /// @notice msg.sender = player; consumes nonce key 0 (cancels any pending signed open).
    function openRound(uint8 assetId, uint8 tier, Direction d, uint128 stake, uint32 laneVersion, uint8 oracleIdx)
        external
        returns (uint256 roundId);
    function openRoundWithSig(OpenRoundIntent calldata i, bytes calldata sig) external returns (uint256 roundId);
    function requestCashOut(uint256 roundId) external returns (uint40 exitSec);
    function requestCashOutWithSig(CashOutIntent calldata c, bytes calldata sig) external returns (uint40 exitSec);

    // Permissionless, never paused.
    function settle(uint256 roundId) external returns (Outcome outcome, uint256 payout);
    /// @notice Skips rounds that are not open, not decidable, or whose evaluation reverts (fault-isolated).
    /// At most 100 ids.
    function settleMany(uint256[] calldata roundIds) external;
    /// @notice `oracles(oracleIdx).record(proof)` then `settleMany(roundIds)`. At most 100 ids.
    function recordAndSettle(uint8 oracleIdx, bytes calldata proof, uint256[] calldata roundIds) external;
    /// @notice Settles a round only if the result is a void; after the stall window it also voids rounds whose
    /// oracle can no longer be read.
    function voidStale(uint256 roundId) external;

    // ── Views ───────────────────────────────────────────────────────────────────
    function previewSettle(uint256 roundId)
        external
        view
        returns (bool decidable, Outcome outcome, uint256 payout, uint40 decisionSec, uint40 missingSec);
    function getRound(uint256 roundId) external view returns (Round memory);
    function quoteMaxPayout(uint8 assetId, uint8 tier, uint128 stake) external view returns (uint256);
    function hashOpenRound(OpenRoundIntent calldata) external view returns (bytes32);
    function hashCashOut(CashOutIntent calldata) external view returns (bytes32);
    function hashWithdraw(WithdrawIntent calldata) external view returns (bytes32);
    function nonces(address owner, uint192 key) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function activeRoundOf(address) external view returns (uint256);
    function getAsset(uint8 assetId) external view returns (AssetConfig memory);
    function getLane(uint8 assetId, uint8 tier) external view returns (Lane memory);
    function getLaneTuneBounds(uint8 assetId, uint8 tier) external view returns (TuneBounds memory);
    function oracles(uint256 idx) external view returns (ICheckpointOracle);
    function activeOracleIdx() external view returns (uint8);
    function houseFree() external view returns (uint256);
    function houseReserved() external view returns (uint256);
    function stakesLocked() external view returns (uint256);
    function totalPlayerBalances() external view returns (uint256);
    function surplus() external view returns (uint256);

    // ── House & config ──────────────────────────────────────────────────────────
    function fundHouse(uint256 amount) external;
    function withdrawHouse(address to, uint256 amount) external;
    function skim() external;
    /// @notice CONFIG (cold). Bumps the version of every configured lane of the asset.
    function setAsset(uint8 assetId, AssetConfig calldata c) external;
    /// @notice CONFIG (cold). Full lane config; validates and bumps the version.
    function setLane(uint8 assetId, uint8 tier, LaneParams calldata p) external;
    /// @notice CONFIG (cold). Inclusive T/S window for `tuneLane`; all-zero (unset) blocks tuning.
    function setLaneTuneBounds(
        uint8 assetId,
        uint8 tier,
        uint32 minTargetPpm,
        uint32 maxTargetPpm,
        uint32 minStopPpm,
        uint32 maxStopPpm
    ) external;
    /// @notice LANE_TUNER (the adaptive-lanes job): changes only T and S of an existing lane, inside the tune
    /// bounds and the house-edge guard; M, fee, duration, stakes and `enabled` are kept. Bumps the version.
    function tuneLane(uint8 assetId, uint8 tier, uint32 targetPpm, uint32 stopPpm) external;
    function setLimits(uint16 maxUtilizationBps, uint128 maxPayoutPerRound) external;
    function addOracle(ICheckpointOracle o) external;
    function setActiveOracle(uint8 idx) external;
    function pause() external;
    function unpause() external;
}
