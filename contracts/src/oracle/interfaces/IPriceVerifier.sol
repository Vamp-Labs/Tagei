// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice A source of verified per-second prices for `CheckpointOracle` (F1a §3).
interface IPriceVerifier {
    struct VerifiedPrice {
        uint32 pairId;
        uint64 roundMs;
        uint64 tsMs;
        uint256 price18;
    }

    /// @notice Verifies `proof` and returns its tracked feeds. Stateless verifiers return each proof's OWN round
    /// (history is fine); a stateful fallback only returns feeds whose round Supra accepted as-is.
    function verify(bytes calldata proof) external returns (VerifiedPrice[] memory);

    /// @notice Newest round (ms) the underlying source is known to hold, or 0 when the verifier has no such notion.
    function latestRoundMs(uint32 pairId) external view returns (uint64);

    /// @notice True when an old second can still be proven later (backfill), so gaps are never permanent.
    function supportsLateVerification() external view returns (bool);

    /// @notice "SUPRA_DORA2_PULL_V2" or "SIGNED_BACKEND_V1".
    function sourceId() external view returns (bytes32);

    /// @notice True only for the signed backup (the UI labels such rounds).
    function isTrusted() external view returns (bool);
}
