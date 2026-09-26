// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Direction, LaneParams} from "../types/ArenaTypes.sol";

/// @notice Target Lane arithmetic. A bit-for-bit mirror of packages/shared/src/lane.ts (checked by the golden
/// vectors). Prices are 18-decimal integers, barriers are ppm, multipliers and fees are bps. Every division floors,
/// which always favours the house.
library LaneMath {
    uint256 internal constant PPM = 1_000_000;
    uint256 internal constant BPS = 10_000;

    uint256 internal constant MIN_BARRIER_PPM = 10;
    uint256 internal constant MAX_BARRIER_PPM = 100_000;
    uint256 internal constant MIN_MULTIPLIER_BPS = 10_001;
    uint256 internal constant MAX_MULTIPLIER_BPS = 100_000;
    uint256 internal constant MAX_FEE_BPS = 1_000;
    uint256 internal constant MIN_DURATION_SEC = 5;
    uint256 internal constant MAX_DURATION_SEC = 120;

    /// @dev Touch values match `Touch` in lane.ts.
    uint8 internal constant TOUCH_NONE = 0;
    uint8 internal constant TOUCH_TARGET = 1;
    uint8 internal constant TOUCH_STOP = 2;

    /// @dev `checkLane` results.
    uint8 internal constant LANE_OK = 0;
    uint8 internal constant LANE_INVALID = 1;
    uint8 internal constant LANE_HOUSE_EDGE = 2;

    /// @notice Favourable-or-not plus the absolute move. A zero move counts as favourable.
    function directional(Direction direction, uint256 p0, uint256 p) internal pure returns (bool fav, uint256 mag) {
        if (p >= p0) {
            mag = p - p0;
            fav = direction == Direction.Long || mag == 0;
        } else {
            mag = p0 - p;
            fav = direction == Direction.Short;
        }
    }

    /// @notice Inclusive barrier check by cross-multiplication (no division).
    function touch(bool fav, uint256 mag, uint256 p0, uint256 targetPpm, uint256 stopPpm) internal pure returns (uint8) {
        if (fav) return mag * PPM >= targetPpm * p0 ? TOUCH_TARGET : TOUCH_NONE;
        return mag * PPM >= stopPpm * p0 ? TOUCH_STOP : TOUCH_NONE;
    }

    function maxPayout(uint256 stake, uint256 multiplierBps) internal pure returns (uint256) {
        return Math.mulDiv(stake, multiplierBps, BPS);
    }

    /// @notice Payout when the round ends between the barriers (timeout or cash-out).
    /// fav: V = 1 + (M-1)·r/T, unfav: V = 1 - |r|/S, then × (1 - fee). The caller guarantees no barrier was touched
    /// at this price (otherwise the unfavourable branch underflows and reverts).
    function interiorPayout(
        uint256 stake,
        bool fav,
        uint256 mag,
        uint256 p0,
        uint256 targetPpm,
        uint256 stopPpm,
        uint256 multiplierBps,
        uint256 feeBps
    ) internal pure returns (uint256) {
        uint256 keep = BPS - feeBps;
        if (fav) {
            uint256 den = p0 * targetPpm;
            uint256 num = BPS * den + (multiplierBps - BPS) * mag * PPM;
            return Math.mulDiv(stake, num * keep, den * BPS * BPS);
        }
        uint256 d = p0 * stopPpm;
        return Math.mulDiv(stake, (d - mag * PPM) * keep, d * BPS);
    }

    /// @notice |p - prev| / prev <= maxJumpPpm, inclusive.
    function jumpOk(uint256 prev, uint256 p, uint256 maxJumpPpm) internal pure returns (bool) {
        uint256 mag = p >= prev ? p - prev : prev - p;
        return mag * PPM <= maxJumpPpm * prev;
    }

    /// @notice House-edge guard enforced by `setLane`: (M-1)·S + max(0, M-2)·gap <= T (all in bps × ppm).
    /// @dev Requires multiplierBps >= BPS (always true once the ranges passed).
    function laneEdgeGuardOk(uint256 targetPpm, uint256 stopPpm, uint256 multiplierBps, uint256 gapMarginPpm)
        internal
        pure
        returns (bool)
    {
        uint256 overTwo = multiplierBps > 2 * BPS ? multiplierBps - 2 * BPS : 0;
        return (multiplierBps - BPS) * stopPpm + overTwo * gapMarginPpm <= BPS * targetPpm;
    }

    /// @notice Mirror of `validateLane` in lane.ts: range errors first, then the house-edge guard.
    function checkLane(LaneParams memory p, uint256 gapMarginPpm) internal pure returns (uint8) {
        if (
            p.targetPpm < MIN_BARRIER_PPM || p.targetPpm > MAX_BARRIER_PPM || p.stopPpm < MIN_BARRIER_PPM
                || p.stopPpm > MAX_BARRIER_PPM || p.multiplierBps < MIN_MULTIPLIER_BPS
                || p.multiplierBps > MAX_MULTIPLIER_BPS || p.feeBps > MAX_FEE_BPS || p.durationSec < MIN_DURATION_SEC
                || p.durationSec > MAX_DURATION_SEC || p.minStake == 0 || p.minStake > p.maxStake
        ) return LANE_INVALID;
        if (!laneEdgeGuardOk(p.targetPpm, p.stopPpm, p.multiplierBps, gapMarginPpm)) return LANE_HOUSE_EDGE;
        return LANE_OK;
    }
}
