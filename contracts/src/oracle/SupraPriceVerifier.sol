// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {PriceVerifierBase} from "./PriceVerifierBase.sol";
import {ISupraOraclePull} from "./interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "./interfaces/ISupraSValueFeed.sol";
import {SupraProofV2} from "./libraries/SupraProofV2.sol";

/// @title SupraPriceVerifier (optional P1 fallback)
/// @notice Stateful verification through Supra's own `verifyOracleProofV2(bytes)`. Supra returns its STORED newer
/// values when a proof is older than what it holds (F1), so a feed is accepted only when the returned pair and round
/// equal the proof's own (the F1 guard); everything else is dropped. Gaps can become permanent here, which is why the
/// Arena voids them as `CheckpointGap` (`supportsLateVerification() == false`). Prefer `StatelessSupraVerifier`.
contract SupraPriceVerifier is PriceVerifierBase {
    bytes32 public constant SOURCE_ID = "SUPRA_DORA2_PULL_V2";

    ISupraOraclePull public immutable pull;
    ISupraSValueFeed public immutable supraStorage;

    error ResultLengthMismatch(uint256 expected, uint256 actual);

    constructor(ISupraOraclePull pull_, ISupraSValueFeed storage_, uint32[] memory pairs) PriceVerifierBase(pairs) {
        if (address(pull_) == address(0) || address(storage_) == address(0)) revert ZeroAddress();
        pull = pull_;
        supraStorage = storage_;
    }

    function verify(bytes calldata proof) external returns (VerifiedPrice[] memory out) {
        SupraProofV2.OracleProofV2 memory p = SupraProofV2.decode(proof);
        ISupraOraclePull.PriceInfo memory info = pull.verifyOracleProofV2(proof);

        uint256 total;
        for (uint256 i; i < p.data.length; ++i) {
            total += p.data[i].committee_data.committee_feed.length;
        }
        if (
            info.pairs.length != total || info.prices.length != total || info.timestamp.length != total
                || info.decimal.length != total || info.round.length != total
        ) revert ResultLengthMismatch(total, info.pairs.length);

        out = new VerifiedPrice[](total);
        uint256 n;
        uint256 idx;
        for (uint256 i; i < p.data.length; ++i) {
            SupraProofV2.CommitteeFeed[] memory feeds = p.data[i].committee_data.committee_feed;
            for (uint256 j; j < feeds.length; ++j) {
                SupraProofV2.CommitteeFeed memory f = feeds[j];
                if (isTracked(f.pair) && info.pairs[idx] == f.pair && info.round[idx] == f.round) {
                    if (info.decimal[idx] != 18) revert UnsupportedDecimals(f.pair, info.decimal[idx]);
                    uint64 tsMs = SafeCast.toUint64(info.timestamp[idx]);
                    _checkFeed(f.pair, f.round, tsMs, info.prices[idx]);
                    out[n++] = VerifiedPrice({pairId: f.pair, roundMs: f.round, tsMs: tsMs, price18: info.prices[idx]});
                }
                ++idx;
            }
        }
        assembly ("memory-safe") {
            mstore(out, n)
        }
    }

    function latestRoundMs(uint32 pairId) external view returns (uint64) {
        return SafeCast.toUint64(supraStorage.getSvalue(pairId).round);
    }

    function supportsLateVerification() external pure returns (bool) {
        return false;
    }

    function sourceId() external pure returns (bytes32) {
        return SOURCE_ID;
    }

    function isTrusted() external pure returns (bool) {
        return false;
    }
}
