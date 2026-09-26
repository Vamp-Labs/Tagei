// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {LaneMath} from "../../src/libraries/LaneMath.sol";
import {Direction} from "../../src/types/ArenaTypes.sol";

/// @notice Properties of the payout curve: bounded by maxPayout, monotone in price, LONG/SHORT mirror, floors
/// toward the house.
contract LaneMathFuzzTest is Test {
    struct Lane {
        uint256 p0;
        uint256 stake;
        uint256 t;
        uint256 s;
        uint256 m;
        uint256 fee;
    }

    function _lane(uint256 p0, uint256 stake, uint256 t, uint256 s, uint256 m, uint256 fee)
        internal
        pure
        returns (Lane memory l)
    {
        l.p0 = bound(p0, 1e12, 1e30);
        l.stake = bound(stake, 1, 1e27);
        l.t = bound(t, 10, 100_000);
        l.s = bound(s, 10, 100_000);
        l.m = bound(m, 10_001, 100_000);
        l.fee = bound(fee, 0, 1_000);
    }

    /// @dev A price strictly inside both barriers for `d` (mag·1e6 < barrier·p0 on each side).
    function _interiorPrice(Lane memory l, uint256 x, bool up, Direction d) internal pure returns (uint256) {
        uint256 upPpm = d == Direction.Long ? l.t : l.s;
        uint256 downPpm = d == Direction.Long ? l.s : l.t;
        return _inside(l, x, up, upPpm, downPpm);
    }

    function _inside(Lane memory l, uint256 x, bool up, uint256 upPpm, uint256 downPpm)
        internal
        pure
        returns (uint256)
    {
        uint256 maxUp = (upPpm * l.p0 - 1) / 1e6;
        uint256 maxDown = (downPpm * l.p0 - 1) / 1e6;
        return up ? l.p0 + bound(x, 0, maxUp) : l.p0 - bound(x, 0, maxDown);
    }

    function _payout(Lane memory l, Direction d, uint256 p) internal pure returns (uint256) {
        (bool fav, uint256 mag) = LaneMath.directional(d, l.p0, p);
        assertEq(LaneMath.touch(fav, mag, l.p0, l.t, l.s), LaneMath.TOUCH_NONE);
        return LaneMath.interiorPayout(l.stake, fav, mag, l.p0, l.t, l.s, l.m, l.fee);
    }

    function testFuzz_payoutNeverExceedsMax(
        uint256 p0,
        uint256 stake,
        uint256 t,
        uint256 s,
        uint256 m,
        uint256 fee,
        uint256 x,
        bool up,
        bool short
    ) public pure {
        Lane memory l = _lane(p0, stake, t, s, m, fee);
        Direction d = short ? Direction.Short : Direction.Long;
        uint256 payout = _payout(l, d, _interiorPrice(l, x, up, d));
        assertLe(payout, LaneMath.maxPayout(l.stake, l.m));
        assertGe(LaneMath.maxPayout(l.stake, l.m), l.stake);
    }

    function testFuzz_monotoneInPrice(
        uint256 p0,
        uint256 stake,
        uint256 t,
        uint256 s,
        uint256 m,
        uint256 fee,
        uint256 x1,
        uint256 x2,
        bool up1,
        bool up2
    ) public pure {
        Lane memory l = _lane(p0, stake, t, s, m, fee);
        uint256 lim = l.t < l.s ? l.t : l.s; // inside for both directions
        uint256 a = _inside(l, x1, up1, lim, lim);
        uint256 b = _inside(l, x2, up2, lim, lim);
        if (a > b) (a, b) = (b, a);
        assertLe(_payout(l, Direction.Long, a), _payout(l, Direction.Long, b), "LONG non-decreasing");
        assertGe(_payout(l, Direction.Short, a), _payout(l, Direction.Short, b), "SHORT non-increasing");
    }

    function testFuzz_longShortMirror(
        uint256 p0,
        uint256 stake,
        uint256 t,
        uint256 s,
        uint256 m,
        uint256 fee,
        uint256 x
    ) public pure {
        Lane memory l = _lane(p0, stake, t, s, m, fee);
        uint256 maxMag = ((l.t < l.s ? l.t : l.s) * l.p0 - 1) / 1e6;
        uint256 mag = bound(x, 1, maxMag == 0 ? 1 : maxMag);
        vm.assume(mag * 1e6 < l.t * l.p0 && mag * 1e6 < l.s * l.p0);
        assertEq(_payout(l, Direction.Long, l.p0 + mag), _payout(l, Direction.Short, l.p0 - mag), "fav mirror");
        assertEq(_payout(l, Direction.Long, l.p0 - mag), _payout(l, Direction.Short, l.p0 + mag), "unfav mirror");
    }

    function testFuzz_roundingFavoursHouse(
        uint256 p0,
        uint256 stake,
        uint256 t,
        uint256 s,
        uint256 m,
        uint256 fee,
        uint256 x,
        bool up
    ) public pure {
        Lane memory l = _lane(p0, stake, t, s, m, fee);
        uint256 p = _interiorPrice(l, x, up, Direction.Long);
        uint256 payout = _payout(l, Direction.Long, p);
        uint256 keep = 10_000 - l.fee;
        if (p >= l.p0) {
            uint256 den = l.p0 * l.t;
            uint256 num = 10_000 * den + (l.m - 10_000) * (p - l.p0) * 1e6;
            // payout = floor(stake·num·keep / (den·1e8)) exactly
            assertEq(payout, _floorDiv(l.stake, num * keep, den * 1e8));
        } else {
            uint256 d = l.p0 * l.s;
            assertEq(payout, _floorDiv(l.stake, (d - (l.p0 - p) * 1e6) * keep, d * 10_000));
        }
        assertLe(LaneMath.maxPayout(l.stake, l.m) * 10_000, l.stake * l.m);
    }

    /// @dev floor(a·b / c) via 512-bit-free long division: a ≤ 1e27, so split b = q·c + r.
    function _floorDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        uint256 q = b / c;
        uint256 r = b % c;
        // a·r < a·c; a ≤ 1e27 (2^90) and c ≤ 1e43 (2^143): the product fits in 256 bits.
        return a * q + (a * r) / c;
    }

    function testFuzz_touchIsInclusive(uint256 p0, uint256 t, uint256 s) public pure {
        p0 = bound(p0, 1e12, 1e30);
        t = bound(t, 10, 100_000);
        s = bound(s, 10, 100_000);
        uint256 up = (t * p0 + 1e6 - 1) / 1e6;
        uint256 down = (s * p0 + 1e6 - 1) / 1e6;
        assertEq(LaneMath.touch(true, up, p0, t, s), LaneMath.TOUCH_TARGET);
        assertEq(LaneMath.touch(true, up - 1, p0, t, s), LaneMath.TOUCH_NONE);
        assertEq(LaneMath.touch(false, down, p0, t, s), LaneMath.TOUCH_STOP);
        assertEq(LaneMath.touch(false, down - 1, p0, t, s), LaneMath.TOUCH_NONE);
    }
}
