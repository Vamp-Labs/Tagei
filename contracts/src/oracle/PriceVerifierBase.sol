// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPriceVerifier} from "./interfaces/IPriceVerifier.sol";

/// @notice Tracked-pair set and the per-feed checks shared by every verifier (F1a §2-3):
/// canonical round (`round % 1000 == 0`, `round <= ts < round + 1000`), `0 < price18 <= uint128.max`, and Supra's own
/// future bound `round <= block.timestamp·1000 + 3000`.
abstract contract PriceVerifierBase is IPriceVerifier {
    uint256 public constant FUTURE_TOLERANCE_MS = 3000;

    /// @notice Bit `p` set ⇔ pair `p` is tracked (pairs are < 256).
    uint256 public immutable trackedPairsMask;

    error NonCanonicalRound(uint32 pairId, uint64 roundMs, uint64 tsMs);
    error FutureRound(uint32 pairId, uint64 roundMs, uint256 nowMs);
    error InvalidPrice(uint32 pairId, uint256 price);
    error UnsupportedDecimals(uint32 pairId, uint256 decimals);
    error PairOutOfRange(uint32 pairId);
    error UntrackedPair(uint32 pairId);
    error NoTrackedPairs();
    error ZeroAddress();

    constructor(uint32[] memory pairs) {
        uint256 mask;
        for (uint256 i; i < pairs.length; ++i) {
            if (pairs[i] > 255) revert PairOutOfRange(pairs[i]);
            mask |= uint256(1) << pairs[i];
        }
        if (mask == 0) revert NoTrackedPairs();
        trackedPairsMask = mask;
    }

    function isTracked(uint32 pairId) public view returns (bool) {
        return pairId < 256 && (trackedPairsMask >> pairId) & 1 == 1;
    }

    function _checkFeed(uint32 pairId, uint64 roundMs, uint64 tsMs, uint256 price18) internal view {
        if (price18 == 0 || price18 > type(uint128).max) revert InvalidPrice(pairId, price18);
        if (roundMs % 1000 != 0 || tsMs < roundMs || tsMs - roundMs >= 1000) {
            revert NonCanonicalRound(pairId, roundMs, tsMs);
        }
        uint256 nowMs = block.timestamp * 1000;
        if (roundMs > nowMs + FUTURE_TOLERANCE_MS) revert FutureRound(pairId, roundMs, nowMs);
    }
}
