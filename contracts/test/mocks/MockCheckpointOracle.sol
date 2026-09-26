// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICheckpointOracle} from "../../src/oracle/interfaces/ICheckpointOracle.sol";
import {IPriceVerifier} from "../../src/oracle/interfaces/IPriceVerifier.sol";

/// @notice Minimal verifier descriptor so `addOracle` can read sourceId / isTrusted.
contract MockVerifierInfo is IPriceVerifier {
    bool public late;
    bool public trusted;

    constructor(bool late_, bool trusted_) {
        late = late_;
        trusted = trusted_;
    }

    function verify(bytes calldata) external pure returns (VerifiedPrice[] memory) {
        revert("MockVerifierInfo: verify");
    }

    function latestRoundMs(uint32) external pure returns (uint64) {
        return 0;
    }

    function supportsLateVerification() external view returns (bool) {
        return late;
    }

    function sourceId() external pure returns (bytes32) {
        return "MOCK";
    }

    function isTrusted() external view returns (bool) {
        return trusted;
    }
}

/// @notice Fully scriptable checkpoint oracle for pure Arena tests: set any checkpoint, dispute flag, "Supra
/// latest" second and late-verification mode directly, or make every read revert (a broken upstream).
/// `record(proof)` accepts abi.encode(uint32[] pairs, uint40[] secs, uint128[] prices).
contract MockCheckpointOracle is ICheckpointOracle {
    uint8 internal constant FLAG_RECORDED = 1;
    uint8 internal constant FLAG_DISPUTED = 2;

    MockVerifierInfo public immutable info;
    bool public late;
    bool public broken;

    mapping(uint32 pairId => mapping(uint40 sec => Checkpoint)) private _cp;
    mapping(uint32 pairId => uint40) public lastRecordedSec;
    mapping(uint32 pairId => uint40) public sourceLatestSec;

    error Broken();

    constructor(bool late_) {
        late = late_;
        info = new MockVerifierInfo(late_, false);
    }

    function verifier() external view returns (IPriceVerifier) {
        return info;
    }

    function setLate(bool late_) external {
        late = late_;
    }

    function setBroken(bool broken_) external {
        broken = broken_;
    }

    function setSourceLatest(uint32 pairId, uint40 sec) external {
        sourceLatestSec[pairId] = sec;
    }

    function set(uint32 pairId, uint40 sec, uint128 price18) public {
        _cp[pairId][sec] = Checkpoint({price18: price18, tsMs: uint64(sec) * 1000 + 163, flags: FLAG_RECORDED});
        if (sec > lastRecordedSec[pairId]) lastRecordedSec[pairId] = sec;
    }

    function setDisputed(uint32 pairId, uint40 sec) external {
        _cp[pairId][sec].flags |= FLAG_DISPUTED;
    }

    function clear(uint32 pairId, uint40 sec) external {
        delete _cp[pairId][sec];
    }

    function record(bytes calldata proof) external returns (uint256 newlyRecorded) {
        if (broken) revert Broken();
        (uint32[] memory pairs, uint40[] memory secs, uint128[] memory prices) =
            abi.decode(proof, (uint32[], uint40[], uint128[]));
        for (uint256 i; i < pairs.length; ++i) {
            if (_cp[pairs[i]][secs[i]].flags & FLAG_RECORDED == 0) {
                set(pairs[i], secs[i], prices[i]);
                ++newlyRecorded;
            }
        }
    }

    function get(uint32 pairId, uint40 sec) external view returns (Checkpoint memory) {
        if (broken) revert Broken();
        return _cp[pairId][sec];
    }

    function getRange(uint32 pairId, uint40 fromSec, uint40 toSec) external view returns (Checkpoint[] memory out) {
        if (broken) revert Broken();
        require(toSec >= fromSec && toSec - fromSec < 256, "range");
        out = new Checkpoint[](uint256(toSec - fromSec) + 1);
        for (uint256 k; k < out.length; ++k) {
            out[k] = _cp[pairId][fromSec + uint40(k)];
        }
    }

    function latestKnownSec(uint32 pairId) public view returns (uint40) {
        if (broken) revert Broken();
        uint40 a = lastRecordedSec[pairId];
        uint40 b = sourceLatestSec[pairId];
        return a > b ? a : b;
    }

    function isPermanentlyMissing(uint32 pairId, uint40 sec) external view returns (bool) {
        if (broken) revert Broken();
        if (_cp[pairId][sec].flags & FLAG_RECORDED != 0) return false;
        if (late) return false;
        return latestKnownSec(pairId) > sec;
    }
}
