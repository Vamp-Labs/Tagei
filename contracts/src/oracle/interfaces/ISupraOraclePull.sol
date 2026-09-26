// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Vendored from Supra's `SupraOraclePull` V2 (BSC testnet proxy 0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917,
/// implementation verified on Sourcify as src/SupraOraclePull_V2.sol).
interface ISupraOraclePull {
    struct PriceInfo {
        uint256[] pairs;
        uint256[] prices;
        uint256[] timestamp;
        uint256[] decimal;
        uint256[] round;
    }

    error IncorrectFutureUpdate(uint256 deltaMs);

    /// @notice The `bytes` overload (selector 0x3dcd9793). The struct overload is a stub on chain 97; never use it.
    /// Returns the proof's values when its round is not older than the stored one, otherwise the STORED newer values
    /// (the "F1" limitation).
    function verifyOracleProofV2(bytes calldata _bytesProof) external returns (PriceInfo memory);
}
