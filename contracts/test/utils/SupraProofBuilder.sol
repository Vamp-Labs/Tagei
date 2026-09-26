// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {MockSupraCommitteeVerifier} from "../mocks/MockSupraCommitteeVerifier.sol";

/// @notice Builds synthetic `OracleProofV2` bytes for arbitrary feeds: little-endian leaves in feed order, an
/// OpenZeppelin multiproof whose root is registered with `MockSupraCommitteeVerifier`.
library SupraProofBuilder {
    /// @dev Pair order of every production `/get_proof` request.
    function pairs() internal pure returns (uint32[] memory p) {
        p = new uint32[](5);
        p[0] = 0;
        p[1] = 1;
        p[2] = 3;
        p[3] = 10;
        p[4] = 49;
    }

    function feed(uint32 pair, uint128 price, uint64 roundMs) internal pure returns (SupraProofV2.CommitteeFeed memory) {
        return SupraProofV2.CommitteeFeed({pair: pair, price: price, timestamp: roundMs + 163, decimals: 18, round: roundMs});
    }

    function single(MockSupraCommitteeVerifier v, uint32 pair, uint128 price, uint40 sec)
        internal
        returns (bytes memory)
    {
        SupraProofV2.CommitteeFeed[] memory feeds = new SupraProofV2.CommitteeFeed[](1);
        feeds[0] = feed(pair, price, uint64(sec) * 1000);
        return build(v, 0, feeds, 0);
    }

    /// @notice One committee, `extraNodes` sibling hashes in the proof (0 = every leaf merged by flags).
    function build(MockSupraCommitteeVerifier v, uint64 committeeId, SupraProofV2.CommitteeFeed[] memory feeds, uint256 extraNodes)
        internal
        returns (bytes memory)
    {
        SupraProofV2.OracleProofV2 memory p;
        p.data = new SupraProofV2.PriceDetailsWithCommittee[](1);
        p.data[0] = committee(v, committeeId, feeds, extraNodes);
        return abi.encode(p);
    }

    function committee(
        MockSupraCommitteeVerifier v,
        uint64 committeeId,
        SupraProofV2.CommitteeFeed[] memory feeds,
        uint256 extraNodes
    ) internal returns (SupraProofV2.PriceDetailsWithCommittee memory d) {
        uint256 n = feeds.length;
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            leaves[i] = SupraProofV2.leaf(feeds[i]);
        }
        bytes32[] memory proof = new bytes32[](extraNodes);
        for (uint256 i; i < extraNodes; ++i) {
            proof[i] = keccak256(abi.encode("sibling", i, n));
        }
        // n leaves + extra proof nodes = flags + 1: merge every leaf first, then fold in the siblings.
        bool[] memory flags = new bool[](n + extraNodes - 1);
        for (uint256 i; i + 1 < n; ++i) {
            flags[i] = true;
        }
        bytes32 root = MerkleProof.processMultiProof(proof, flags, leaves);
        v.register(root, committeeId);

        d.committee_id = committeeId;
        d.root = root;
        d.sigs = [uint256(1), uint256(2)];
        d.committee_data.committee_feed = feeds;
        d.committee_data.proof = proof;
        d.committee_data.flags = flags;
    }
}
