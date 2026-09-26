// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {PriceVerifierBase} from "./PriceVerifierBase.sol";
import {ISupraSValueFeedVerifier} from "./interfaces/ISupraSValueFeedVerifier.sol";
import {SupraProofV2} from "./libraries/SupraProofV2.sol";

/// @title StatelessSupraVerifier (P0)
/// @notice Verifies a Supra DORA-2 `OracleProofV2` without touching Supra's latest-only storage, so it proves ANY
/// historical round (the "F1" limitation of `verifyOracleProofV2` does not apply). Per committee:
///   1. the OpenZeppelin multiproof over little-endian leaves (in feed order) must rebuild `root`;
///   2. Supra's committee verifier `requireHashVerified_V2(root, sigs, committee_id)` must accept the BLS signature.
/// Then every tracked feed must have `decimals == 18`, a canonical round and respect Supra's future bound.
/// Untracked feeds are proven (they are Merkle leaves) but not returned.
/// @dev Port of research/poc/src/StatelessSupraVerifier.sol (A1 spike).
contract StatelessSupraVerifier is PriceVerifierBase {
    bytes32 public constant SOURCE_ID = "SUPRA_DORA2_PULL_V2";

    ISupraSValueFeedVerifier public immutable supraVerifier;

    error RootMismatch(uint256 committeeIndex);

    constructor(ISupraSValueFeedVerifier supraVerifier_, uint32[] memory pairs) PriceVerifierBase(pairs) {
        if (address(supraVerifier_) == address(0)) revert ZeroAddress();
        supraVerifier = supraVerifier_;
    }

    function verify(bytes calldata proof) external view returns (VerifiedPrice[] memory out) {
        SupraProofV2.OracleProofV2 memory p = SupraProofV2.decode(proof);
        uint256 committees = p.data.length;

        uint256 n;
        for (uint256 i; i < committees; ++i) {
            SupraProofV2.CommitteeFeed[] memory feeds = p.data[i].committee_data.committee_feed;
            for (uint256 j; j < feeds.length; ++j) {
                if (isTracked(feeds[j].pair)) ++n;
            }
        }
        out = new VerifiedPrice[](n);

        uint256 k;
        for (uint256 i; i < committees; ++i) {
            SupraProofV2.PriceDetailsWithCommittee memory d = p.data[i];
            SupraProofV2.CommitteeFeed[] memory feeds = d.committee_data.committee_feed;

            bytes32[] memory leaves = new bytes32[](feeds.length);
            for (uint256 j; j < feeds.length; ++j) {
                leaves[j] = SupraProofV2.leaf(feeds[j]);
            }
            if (!MerkleProof.multiProofVerify(d.committee_data.proof, d.committee_data.flags, d.root, leaves)) {
                revert RootMismatch(i);
            }
            supraVerifier.requireHashVerified_V2(d.root, d.sigs, d.committee_id);

            for (uint256 j; j < feeds.length; ++j) {
                SupraProofV2.CommitteeFeed memory f = feeds[j];
                if (!isTracked(f.pair)) continue;
                if (f.decimals != 18) revert UnsupportedDecimals(f.pair, f.decimals);
                _checkFeed(f.pair, f.round, f.timestamp, f.price);
                out[k++] = VerifiedPrice({pairId: f.pair, roundMs: f.round, tsMs: f.timestamp, price18: f.price});
            }
        }
    }

    /// @notice Stateless: nothing is known beyond what our own oracle recorded, so this is always 0 and a third party
    /// pushing newer rounds into Supra storage can neither block opens nor create gaps.
    function latestRoundMs(uint32) external pure returns (uint64) {
        return 0;
    }

    function supportsLateVerification() external pure returns (bool) {
        return true;
    }

    function sourceId() external pure returns (bytes32) {
        return SOURCE_ID;
    }

    function isTrusted() external pure returns (bool) {
        return false;
    }
}
