// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Vendored from Supra's verified `ISupraSValueFeedVerifier` (BSC testnet proxy
/// 0x8694E798112a9Df06d9Ccc772967A5AeCfb24320). Only the function the stateless verifier needs.
interface ISupraSValueFeedVerifier {
    /// @notice Permissionless view. Reverts unless `sigs` is committee `committeeId`'s BLS (BN254) signature over
    /// `root` (`BLSIncorrectInputMessaage` / `BLSInvalidPublicKeyorSignaturePoints`).
    function requireHashVerified_V2(bytes32 root, uint256[2] calldata sigs, uint256 committeeId) external view;
}
