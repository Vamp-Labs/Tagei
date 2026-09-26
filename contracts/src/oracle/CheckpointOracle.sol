// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ICheckpointOracle} from "./interfaces/ICheckpointOracle.sol";
import {IPriceVerifier} from "./interfaces/IPriceVerifier.sol";

/// @title CheckpointOracle
/// @notice Append-only "flight recorder": at most one verified price per (pair, second), set once. Recording is
/// permissionless and idempotent; a later verified price that conflicts with the recorded one only raises the
/// DISPUTED flag (the Arena then treats that second as invalid). Immutable and bound to a single verifier; rotating
/// verifiers means deploying a new oracle and registering it in the Arena.
contract CheckpointOracle is ICheckpointOracle {
    uint8 public constant FLAG_RECORDED = 1;
    uint8 public constant FLAG_DISPUTED = 2;
    uint256 public constant MAX_RANGE = 256;

    IPriceVerifier public immutable verifier;
    /// @notice Cached `verifier.supportsLateVerification()`.
    bool public immutable lateVerification;

    mapping(uint32 pairId => mapping(uint40 sec => Checkpoint)) private _checkpoints;
    mapping(uint32 pairId => uint40) public lastRecordedSec;

    error InvalidRange(uint40 fromSec, uint40 toSec);
    error ZeroAddress();

    constructor(IPriceVerifier verifier_) {
        if (address(verifier_) == address(0)) revert ZeroAddress();
        verifier = verifier_;
        lateVerification = verifier_.supportsLateVerification();
    }

    function record(bytes calldata proof) external returns (uint256 newlyRecorded) {
        IPriceVerifier.VerifiedPrice[] memory prices = verifier.verify(proof);
        for (uint256 i; i < prices.length; ++i) {
            IPriceVerifier.VerifiedPrice memory v = prices[i];
            uint40 sec = SafeCast.toUint40(v.roundMs / 1000);
            uint128 price = SafeCast.toUint128(v.price18);
            Checkpoint storage c = _checkpoints[v.pairId][sec];
            uint8 flags = c.flags;
            if (flags & FLAG_RECORDED == 0) {
                _checkpoints[v.pairId][sec] = Checkpoint({price18: price, tsMs: v.tsMs, flags: FLAG_RECORDED});
                ++newlyRecorded;
                if (sec > lastRecordedSec[v.pairId]) lastRecordedSec[v.pairId] = sec;
                emit CheckpointRecorded(v.pairId, sec, price, v.tsMs);
            } else if (flags & FLAG_DISPUTED == 0 && c.price18 != price) {
                c.flags = flags | FLAG_DISPUTED;
                emit CheckpointDisputed(v.pairId, sec, c.price18, price);
            }
        }
    }

    function get(uint32 pairId, uint40 sec) external view returns (Checkpoint memory) {
        return _checkpoints[pairId][sec];
    }

    function getRange(uint32 pairId, uint40 fromSec, uint40 toSec) external view returns (Checkpoint[] memory out) {
        if (toSec < fromSec || toSec - fromSec >= MAX_RANGE) revert InvalidRange(fromSec, toSec);
        uint256 n = uint256(toSec - fromSec) + 1;
        out = new Checkpoint[](n);
        mapping(uint40 => Checkpoint) storage m = _checkpoints[pairId];
        for (uint256 k; k < n; ++k) {
            out[k] = m[fromSec + uint40(k)];
        }
    }

    function latestKnownSec(uint32 pairId) public view returns (uint40) {
        uint40 last = lastRecordedSec[pairId];
        uint40 source = SafeCast.toUint40(verifier.latestRoundMs(pairId) / 1000);
        return source > last ? source : last;
    }

    function isPermanentlyMissing(uint32 pairId, uint40 sec) external view returns (bool) {
        if (_checkpoints[pairId][sec].flags & FLAG_RECORDED != 0) return false;
        if (lateVerification) return false;
        return latestKnownSec(pairId) > sec;
    }
}
