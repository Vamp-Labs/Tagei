// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Supra DORA-2 `OracleProofV2` layout (field names as in Supra's ABI) and the Merkle leaf encoding
/// recovered by the A1 spike: keccak256(LE32(pair) ‖ LE128(price) ‖ LE64(timestamp) ‖ LE16(decimals) ‖ LE64(round)),
/// 38 bytes, little-endian. Identical to `supraLeaf` in packages/shared/src/supra.ts.
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

    function decode(bytes calldata proof) internal pure returns (OracleProofV2 memory) {
        return abi.decode(proof, (OracleProofV2));
    }

    function leaf(CommitteeFeed memory f) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                bytes4(_rev32(f.pair)),
                bytes16(_rev128(f.price)),
                bytes8(_rev64(f.timestamp)),
                bytes2(_rev16(f.decimals)),
                bytes8(_rev64(f.round))
            )
        );
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
