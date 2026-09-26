// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPriceVerifier} from "./IPriceVerifier.sol";

/// @notice Append-only "flight recorder" of one verified price per (pair, second) (F1a §3).
interface ICheckpointOracle {
    /// @dev flags: bit0 RECORDED, bit1 DISPUTED.
    struct Checkpoint {
        uint128 price18;
        uint64 tsMs;
        uint8 flags;
    }

    event CheckpointRecorded(uint32 indexed pairId, uint40 indexed sec, uint128 price18, uint64 tsMs);
    event CheckpointDisputed(uint32 indexed pairId, uint40 indexed sec, uint128 recorded, uint128 conflicting);

    function verifier() external view returns (IPriceVerifier);

    /// @notice Permissionless. Records every tracked feed of `proof` whose second is still empty.
    function record(bytes calldata proof) external returns (uint256 newlyRecorded);

    function get(uint32 pairId, uint40 sec) external view returns (Checkpoint memory);

    /// @notice Inclusive range, at most 256 seconds.
    function getRange(uint32 pairId, uint40 fromSec, uint40 toSec) external view returns (Checkpoint[] memory);

    function lastRecordedSec(uint32 pairId) external view returns (uint40);

    /// @notice max(lastRecordedSec, verifier.latestRoundMs / 1000).
    function latestKnownSec(uint32 pairId) external view returns (uint40);

    /// @notice !recorded && !verifier.supportsLateVerification() && latestKnownSec > sec.
    function isPermanentlyMissing(uint32 pairId, uint40 sec) external view returns (bool);
}
