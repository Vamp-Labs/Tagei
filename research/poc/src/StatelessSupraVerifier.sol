// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Supra DORA-2 committee verifier (BSC testnet proxy 0x8694E798112a9Df06d9Ccc772967A5AeCfb24320).
/// requireHashVerified_V2 is a permissionless view: it reverts unless `sigs` is a valid BLS (BN254)
/// signature of `root` by committee `committeeId`.
interface ISupraSValueFeedVerifier {
    function requireHashVerified_V2(bytes32 root, uint256[2] calldata sigs, uint256 committeeId) external view;
}

/// @notice Stateless verification of a Supra OracleProofV2 (A1 spike PoC, NOT production code).
/// It proves ANY historical round (no dependency on Supra's latest-only storage, i.e. no "F1" problem):
///   1. requireHashVerified_V2(root, sigs, committee_id) on Supra's verifier (BLS over the Merkle root);
///   2. leaf = keccak256(LE32(pair) ++ LE128(price) ++ LE64(timestamp) ++ LE16(decimals) ++ LE64(round));
///   3. OpenZeppelin-style multiproof (sorted-pair keccak) over the leaves in feed order must equal root.
/// Production code should use OpenZeppelin MerkleProof.multiProofVerify (>=5.0) instead of the inline copy.
library SupraProofV2 {
    struct CommitteeFeed {
        uint32 pair;
        uint128 price;
        uint64 timestamp;
        uint16 decimals;
        uint64 round;
    }

    struct CommitteeFeedsWithProof {
        CommitteeFeed[] committee_feed;
        bytes32[] proof;
        bool[] flags;
    }

    struct PriceDetailsWithCommittee {
        uint64 committee_id;
        bytes32 root;
        uint256[2] sigs;
        CommitteeFeedsWithProof committee_data;
    }

    struct OracleProofV2 {
        PriceDetailsWithCommittee[] data;
    }

    error InvalidMultiproof();
    error RootMismatch(uint256 index);

    function verify(ISupraSValueFeedVerifier verifier, bytes memory proofBytes) internal view returns (CommitteeFeed[] memory out) {
        OracleProofV2 memory p = abi.decode(proofBytes, (OracleProofV2));
        uint256 n;
        for (uint256 i; i < p.data.length; ++i) n += p.data[i].committee_data.committee_feed.length;
        out = new CommitteeFeed[](n);
        uint256 k;
        for (uint256 i; i < p.data.length; ++i) {
            PriceDetailsWithCommittee memory d = p.data[i];
            verifier.requireHashVerified_V2(d.root, d.sigs, d.committee_id);
            CommitteeFeed[] memory feeds = d.committee_data.committee_feed;
            bytes32[] memory leaves = new bytes32[](feeds.length);
            for (uint256 j; j < feeds.length; ++j) {
                leaves[j] = leaf(feeds[j]);
                out[k++] = feeds[j];
            }
            if (processMultiProof(d.committee_data.proof, d.committee_data.flags, leaves) != d.root) revert RootMismatch(i);
        }
    }

    function leaf(CommitteeFeed memory f) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(bytes4(_rev32(f.pair)), bytes16(_rev128(f.price)), bytes8(_rev64(f.timestamp)), bytes2(_rev16(f.decimals)), bytes8(_rev64(f.round)))
        );
    }

    // Same algorithm as OpenZeppelin MerkleProof.processMultiProof (commutative keccak256 pair hash).
    function processMultiProof(bytes32[] memory proof, bool[] memory flags, bytes32[] memory leaves) internal pure returns (bytes32) {
        uint256 leavesLen = leaves.length;
        uint256 flagsLen = flags.length;
        if (leavesLen + proof.length != flagsLen + 1) revert InvalidMultiproof();
        bytes32[] memory hashes = new bytes32[](flagsLen);
        uint256 leafPos;
        uint256 hashPos;
        uint256 proofPos;
        for (uint256 i; i < flagsLen; ++i) {
            bytes32 a = leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++];
            bytes32 b = flags[i] ? (leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++]) : proof[proofPos++];
            hashes[i] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
        }
        if (flagsLen > 0) {
            if (proofPos != proof.length) revert InvalidMultiproof();
            return hashes[flagsLen - 1];
        }
        return leavesLen > 0 ? leaves[0] : proof[0];
    }

    function _rev16(uint16 x) private pure returns (uint16) {
        return (x >> 8) | (x << 8);
    }

    function _rev32(uint32 x) private pure returns (uint32) {
        x = ((x & 0xFF00FF00) >> 8) | ((x & 0x00FF00FF) << 8);
        return (x >> 16) | (x << 16);
    }

    function _rev64(uint64 x) private pure returns (uint64) {
        x = ((x & 0xFF00FF00FF00FF00) >> 8) | ((x & 0x00FF00FF00FF00FF) << 8);
        x = ((x & 0xFFFF0000FFFF0000) >> 16) | ((x & 0x0000FFFF0000FFFF) << 16);
        return (x >> 32) | (x << 32);
    }

    function _rev128(uint128 x) private pure returns (uint128) {
        x = ((x & 0xFF00FF00FF00FF00FF00FF00FF00FF00) >> 8) | ((x & 0x00FF00FF00FF00FF00FF00FF00FF00FF) << 8);
        x = ((x & 0xFFFF0000FFFF0000FFFF0000FFFF0000) >> 16) | ((x & 0x0000FFFF0000FFFF0000FFFF0000FFFF) << 16);
        x = ((x & 0xFFFFFFFF00000000FFFFFFFF00000000) >> 32) | ((x & 0x00000000FFFFFFFF00000000FFFFFFFF) << 32);
        return (x >> 64) | (x << 64);
    }
}

/// @notice Deployable wrapper (used on the anvil fork).
contract StatelessSupraVerifier {
    ISupraSValueFeedVerifier public immutable verifier;

    constructor(address v) {
        verifier = ISupraSValueFeedVerifier(v);
    }

    function verify(bytes calldata proofBytes) external view returns (SupraProofV2.CommitteeFeed[] memory) {
        return SupraProofV2.verify(verifier, proofBytes);
    }
}

/// @notice Constructor-only variant for a read-only eth_call "deployment" on the REAL chain:
/// eth_call({data: creationCode ++ abi.encode(verifier, proof)}) returns abi.encode(CommitteeFeed[]).
/// Nothing is deployed or sent.
contract StatelessSupraVerifyOnce {
    constructor(address v, bytes memory proofBytes) {
        bytes memory ret = abi.encode(SupraProofV2.verify(ISupraSValueFeedVerifier(v), proofBytes));
        assembly {
            return(add(ret, 32), mload(ret))
        }
    }
}
