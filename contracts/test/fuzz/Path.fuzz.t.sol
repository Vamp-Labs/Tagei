// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {LaneMath} from "../../src/libraries/LaneMath.sol";
import {TestUSD} from "../../src/token/TestUSD.sol";
import {Direction, Outcome, Round, RoundStatus} from "../../src/types/ArenaTypes.sol";
import {MockCheckpointOracle} from "../mocks/MockCheckpointOracle.sol";
import {ArenaHarness} from "../utils/ArenaHarness.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";
import {RefPath} from "../utils/RefPath.sol";

/// @notice Random 21-point paths (entry + 20 s) against the independent reference evaluator, both on arbitrary
/// terms through the production `_evaluate` and end to end through open → cash-out → record → settle.
contract PathFuzzTest is ArenaTestBase {
    uint32 internal constant PAIR = 77;

    ArenaHarness internal harness;
    MockCheckpointOracle internal mock;

    function setUp() public override {
        super.setUp();
        TestUSD t = new TestUSD(address(this));
        harness = new ArenaHarness(t, address(this));
        mock = new MockCheckpointOracle(true);
        harness.grantRole(harness.CONFIG_ROLE(), address(this));
        harness.addOracle(mock);
    }

    function _h(uint256 seed, uint256 k, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, k, salt)));
    }

    /// @dev Random walk with ~3 % missing, ~2.5 % disputed and ~4 % over-limit jumps.
    function _path(uint256 seed, uint256 p0, uint256 stepPpm, uint256 maxJumpPpm, bool allowPermanent)
        internal
        pure
        returns (RefPath.Point[] memory pts)
    {
        pts = new RefPath.Point[](21);
        uint256 price = p0;
        for (uint256 k; k < 21; ++k) {
            uint256 h = _h(seed, k, 1);
            if (k > 0) {
                uint256 move = (price * ((h >> 16) % (stepPpm + 1))) / 1e6;
                if ((h >> 32) % 25 == 0) move = (price * (maxJumpPpm + 1 + (h >> 48) % 500)) / 1e6;
                price = (h >> 64) % 2 == 0 ? price + move : price - move;
            }
            if (k > 0 && h % 32 == 0) {
                pts[k].permanentlyMissing = allowPermanent && (h >> 8) % 2 == 0;
                continue;
            }
            pts[k].recorded = true;
            pts[k].price18 = price;
            pts[k].disputed = (h >> 40) % 40 == 0;
        }
    }

    function _assertSame(RefPath.Result memory x, bool decidable, Outcome o, uint256 payout, uint256 dec, uint8 vr)
        internal
        pure
    {
        assertEq(decidable, x.decidable, "decidable");
        assertEq(uint8(o), x.outcome, "outcome");
        assertEq(payout, x.payout, "payout");
        assertEq(dec, x.decisionSec, "decisionSec");
        assertEq(vr, x.voidReason, "voidReason");
    }

    /// @notice Arbitrary terms (any M, T, S, fee, jump limit), production evaluator vs reference.
    function testFuzz_randomPathMatchesReference(uint256 seed) public {
        RefPath.Terms memory t;
        t.direction = uint8(_h(seed, 0, 2) % 2);
        t.stake = 1e18 + _h(seed, 0, 3) % 1e20;
        t.multiplierBps = [15_000, 20_000, 30_000, 50_000][_h(seed, 0, 4) % 4];
        t.maxPayout = LaneMath.maxPayout(t.stake, t.multiplierBps);
        t.entrySec = T0 + 100;
        t.endSec = t.entrySec + 20;
        t.targetPpm = 50 + _h(seed, 0, 5) % 1_000;
        t.stopPpm = 50 + _h(seed, 0, 6) % 1_000;
        t.feeBps = _h(seed, 0, 7) % 1_001;
        t.maxJumpPpm = [3_000, 5_000, 10_000][_h(seed, 0, 8) % 3];
        t.cashOutRequested = _h(seed, 0, 9) % 2 == 0;
        uint256 nowSec = _h(seed, 0, 10) % 2 == 0 ? t.endSec + 2 : t.endSec + 61 + _h(seed, 0, 11) % 300;

        RefPath.Point[] memory pts = _path(seed, 612e18, 250, t.maxJumpPpm, true);
        for (uint256 k; k < 21; ++k) {
            uint40 sec = uint40(t.entrySec + k);
            if (pts[k].recorded) {
                mock.set(PAIR, sec, uint128(pts[k].price18));
                if (pts[k].disputed) mock.setDisputed(PAIR, sec);
            } else if (pts[k].permanentlyMissing) {
                mock.setForcedMissing(PAIR, sec, true);
            }
        }
        Round memory r;
        r.direction = Direction(t.direction);
        r.status = RoundStatus.Open;
        r.cashOutRequested = t.cashOutRequested;
        r.entrySec = uint40(t.entrySec);
        r.endSec = uint40(t.endSec);
        r.stake = uint128(t.stake);
        r.maxPayout = uint128(t.maxPayout);
        r.targetPpm = uint32(t.targetPpm);
        r.stopPpm = uint32(t.stopPpm);
        r.multiplierBps = uint32(t.multiplierBps);
        r.feeBps = uint16(t.feeBps);
        r.maxJumpPpm = uint32(t.maxJumpPpm);
        r.pairId = PAIR;

        vm.warp(nowSec);
        BnbPlayArena.Evaluation memory e = harness.exposedEvaluate(r);
        RefPath.Result memory x = RefPath.evaluate(t, pts, nowSec);
        _assertSame(x, e.decidable, e.outcome, e.payout, e.decisionSec, uint8(e.voidReason));
        assertEq(e.missingSec, x.missingSec, "missingSec");
        assertEq(e.entryPrice, x.entryPrice, "entryPrice");
        assertEq(e.exitPrice, x.exitPrice, "exitPrice");
    }

    /// @notice Real BNB lanes, real CheckpointOracle + StatelessSupraVerifier, a cash-out that makes the path exactly
    /// 21 checkpoints; disputes come from conflicting verified proofs.
    function testFuzz_endToEnd21PointPath(uint256 seed, bool short, bool boost, uint256 stakeSeed) public {
        uint128 stake = uint128(5e18 + stakeSeed % 45e18);
        Direction dir = short ? Direction.Short : Direction.Long;
        uint256 id = _open(alice, BNB, boost ? BOOST : CRUISE, dir, stake);
        Round memory r = _round(id);
        vm.warp(r.entrySec + 18);
        vm.prank(alice);
        assertEq(arena.requestCashOut(id), r.entrySec + 20);

        RefPath.Point[] memory pts = _path(seed, P0_BNB, 70, r.maxJumpPpm, false);
        vm.warp(r.entrySec + 20);
        for (uint256 k; k < 21; ++k) {
            if (!pts[k].recorded) continue;
            _record(PAIR_BNB, r.entrySec + uint40(k), pts[k].price18);
            if (pts[k].disputed) _record(PAIR_BNB, r.entrySec + uint40(k), pts[k].price18 + 1);
        }

        uint256 nowSec = seed % 3 == 0 ? uint256(r.entrySec) + 81 + seed % 100 : uint256(r.entrySec) + 22;
        vm.warp(nowSec);
        RefPath.Terms memory t = RefPath.Terms({
            direction: uint8(dir),
            stake: stake,
            maxPayout: r.maxPayout,
            entrySec: r.entrySec,
            endSec: r.entrySec + 20,
            targetPpm: r.targetPpm,
            stopPpm: r.stopPpm,
            multiplierBps: r.multiplierBps,
            feeBps: r.feeBps,
            maxJumpPpm: r.maxJumpPpm,
            cashOutRequested: true
        });
        RefPath.Result memory x = RefPath.evaluate(t, pts, nowSec);
        if (!x.decidable) {
            vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotDecidable.selector, id, uint40(x.missingSec)));
            arena.settle(id);
            return;
        }
        uint256 before = arena.balanceOf(alice);
        (Outcome o, uint256 payout) = arena.settle(id);
        Round memory s = _round(id);
        _assertSame(x, true, o, payout, s.decisionSec, uint8(s.voidReason));
        assertEq(arena.balanceOf(alice), before + payout);
        assertLe(payout, r.maxPayout);
        _assertLedger();
    }
}
