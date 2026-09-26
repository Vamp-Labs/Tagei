// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ISupraSValueFeedVerifier} from "../../src/oracle/interfaces/ISupraSValueFeedVerifier.sol";

/// @notice Stand-in for Supra's BLS committee verifier: `requireHashVerified_V2` accepts exactly the (root, committee)
/// pairs registered by the test, so tests can build synthetic proofs (LE leaves + OZ multiproof) for any price path.
contract MockSupraCommitteeVerifier is ISupraSValueFeedVerifier {
    mapping(bytes32 root => mapping(uint256 committeeId => bool)) public registered;

    /// @dev Same selector as Supra's error (0x22460675).
    error BLSIncorrectInputMessaage();

    function register(bytes32 root, uint256 committeeId) external {
        registered[root][committeeId] = true;
    }

    function requireHashVerified_V2(bytes32 root, uint256[2] calldata, uint256 committeeId) external view {
        if (!registered[root][committeeId]) revert BLSIncorrectInputMessaage();
    }
}
