// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {LaneMath} from "../../src/libraries/LaneMath.sol";
import {Direction, LaneParams, Outcome, Round, RoundStatus, VoidReason} from "../../src/types/ArenaTypes.sol";
import {MockCheckpointOracle} from "../mocks/MockCheckpointOracle.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";

/// @notice Settlement outcomes through the real CheckpointOracle + StatelessSupraVerifier (synthetic proofs).
contract ArenaSettleTest is ArenaTestBase {
    uint128 internal constant STAKE = 10e18;

    function _openBnb(Direction dir) internal returns (uint256 id, Round memory r) {
        id = _open(alice, BNB, CRUISE, dir, STAKE);
        r = _round(id);
    }

    function test_open_snapshotsTermsAndMovesLedger() public {
        uint256 freeBefore = arena.houseFree();
        uint256 balBefore = arena.balanceOf(alice);
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        LaneParams memory p = _lane(BNB, CRUISE);

        assertEq(id, 1);
        assertEq(r.player, alice);
        assertEq(uint8(r.status), uint8(RoundStatus.Open));
        assertEq(r.entrySec, vm.getBlockTimestamp() + 3);
        assertEq(r.endSec, r.entrySec + p.durationSec);
        assertEq(r.stake, STAKE);
        assertEq(r.maxPayout, LaneMath.maxPayout(STAKE, p.multiplierBps));
        assertEq(r.targetPpm, p.targetPpm);
        assertEq(r.stopPpm, p.stopPpm);
        assertEq(r.pairId, PAIR_BNB);
        assertEq(r.maxJumpPpm, arena.getAsset(BNB).maxJumpPpm);
        assertEq(arena.activeRoundOf(alice), id);
        assertEq(arena.balanceOf(alice), balBefore - STAKE);
        assertEq(arena.stakesLocked(), STAKE);
        assertEq(arena.houseReserved(), r.maxPayout - STAKE);
        assertEq(arena.houseFree(), freeBefore - (r.maxPayout - STAKE));
        _assertLedger();
    }

    function test_targetHit_long_atExactBarrier() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256[] memory prices = _flat(P0_BNB, 6);
        prices[5] = P0_BNB + _barrierMove(P0_BNB, r.targetPpm); // exact inclusive target
        prices[4] = P0_BNB + _barrierMove(P0_BNB, r.targetPpm) - 1; // one wei short: no touch
        _recordPath(PAIR_BNB, r.entrySec, prices);

        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.RoundSettled(
            id, alice, Outcome.TargetHit, r.maxPayout, int256(uint256(r.maxPayout - STAKE)), P0_BNB, prices[5],
            r.entrySec + 5, VoidReason.None
        );
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
        assertEq(payout, r.maxPayout);
        Round memory s = _round(id);
        assertEq(uint8(s.status), uint8(RoundStatus.Settled));
        assertEq(s.decisionSec, r.entrySec + 5);
        assertEq(arena.activeRoundOf(alice), 0);
        assertEq(arena.stakesLocked(), 0);
        assertEq(arena.houseReserved(), 0);
        _assertLedger();
    }

    function test_stopHit_short_atExactBarrier() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Short);
        uint256[] memory prices = _flat(P0_BNB, 3);
        prices[2] = P0_BNB + _barrierMove(P0_BNB, r.stopPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.StopHit));
        assertEq(payout, 0);
        assertEq(arena.houseFree(), houseSeed + STAKE);
        _assertLedger();
    }

    function test_timeout_paysInteriorWithFee() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[n - 1] = _px(P0_BNB, 100); // +100 ppm, below the 226 ppm target
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Timeout));
        uint256 mag = prices[n - 1] - P0_BNB;
        assertEq(
            payout, LaneMath.interiorPayout(STAKE, true, mag, P0_BNB, r.targetPpm, r.stopPpm, r.multiplierBps, r.feeBps)
        );
        assertGt(payout, STAKE);
        assertLt(payout, r.maxPayout);
        _assertLedger();
    }

    function test_notDecidable_untilCheckpointArrives() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec + 5);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 1, P0_BNB);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotDecidable.selector, id, r.entrySec + 2));
        arena.settle(id);
        (bool decidable,,,, uint40 missingSec) = arena.previewSettle(id);
        assertFalse(decidable);
        assertEq(missingSec, r.entrySec + 2);
    }

    // ── symmetry & rounding ─────────────────────────────────────────────────────

    function _timeoutPayout(Direction dir, int256 endPpm) internal returns (uint256 payout) {
        (uint256 id, Round memory r) = _openBnb(dir);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[n - 1] = _px(P0_BNB, endPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 p) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Timeout));
        vm.warp(vm.getBlockTimestamp() + 10);
        return p;
    }

    function test_longShortMirror() public {
        uint256 longUp = _timeoutPayout(Direction.Long, 150);
        uint256 shortDown = _timeoutPayout(Direction.Short, -150);
        uint256 longDown = _timeoutPayout(Direction.Long, -150);
        uint256 shortUp = _timeoutPayout(Direction.Short, 150);
        assertEq(longUp, shortDown, "favourable mirror");
        assertEq(longDown, shortUp, "unfavourable mirror");
        assertGt(longUp, STAKE);
        assertLt(longDown, STAKE);
    }

    function test_feeRounding_flatPathKeepsStakeMinusFee() public {
        uint256 payout = _timeoutPayout(Direction.Short, 0); // zero move counts as favourable
        assertEq(payout, (uint256(STAKE) * 9_900) / 10_000);
    }

    function test_feeRounding_floorsTowardHouse() public {
        uint128 odd = 10e18 + 7;
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, odd);
        Round memory r = _round(id);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[n - 1] = P0_BNB + 12345;
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (, uint256 payout) = arena.settle(id);
        // exact rational value, cross-multiplied: payout <= stake·num·keep / (den·1e8)
        uint256 den = P0_BNB * r.targetPpm;
        uint256 num = 1e4 * den + (uint256(r.multiplierBps) - 1e4) * 12345 * 1e6;
        assertLe(payout * den * 1e8, uint256(odd) * num * 9_900);
        assertGt((payout + 1) * den * 1e8, uint256(odd) * num * 9_900);
    }

    // ── cash-out outcomes ───────────────────────────────────────────────────────

    function test_cashOut_paysInterior() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec + 5);
        vm.prank(alice);
        uint40 exitSec = arena.requestCashOut(id);
        assertEq(exitSec, r.entrySec + 7);
        uint256[] memory prices = _flat(P0_BNB, 8);
        prices[7] = _px(P0_BNB, -100);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.CashedOut));
        assertEq(
            payout,
            LaneMath.interiorPayout(STAKE, false, P0_BNB - prices[7], P0_BNB, r.targetPpm, r.stopPpm, r.multiplierBps, r.feeBps)
        );
        assertEq(_round(id).decisionSec, exitSec);
        _assertLedger();
    }

    function test_cashOut_barrierWinsAtExitSecond() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec + 2);
        vm.prank(alice);
        uint40 exitSec = arena.requestCashOut(id);
        uint256[] memory prices = _flat(P0_BNB, exitSec - r.entrySec + 1);
        prices[prices.length - 1] = P0_BNB + _barrierMove(P0_BNB, r.targetPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
        assertEq(payout, r.maxPayout);
    }

    function test_cashOut_earlierTouchStillWins() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec + 1);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 1, P0_BNB - _barrierMove(P0_BNB, r.stopPpm));
        vm.warp(r.entrySec + 3);
        vm.prank(alice);
        arena.requestCashOut(id);
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.StopHit));
    }

    // ── invalid checkpoints ─────────────────────────────────────────────────────

    function test_void_entryDisputed() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec, P0_BNB + 1); // conflicting verified price → DISPUTED
        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.RoundSettled(id, alice, Outcome.Voided, STAKE, 0, 0, 0, r.entrySec, VoidReason.EntryInvalid);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(payout, STAKE);
        assertEq(arena.houseFree(), houseSeed);
        _assertLedger();
    }

    function test_void_terminalJump() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[n - 1] = _px(P0_BNB, 15_001); // just over BNB maxJumpPpm 15000
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(uint8(_round(id).voidReason), uint8(VoidReason.TerminalInvalid));
    }

    function test_jumpAtExactLimitIsValid() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Short);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[n - 1] = P0_BNB - (P0_BNB * 15_000) / 1e6; // exactly maxJump (inclusive) and far past the target
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
    }

    function test_void_terminalDisputed() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256 n = r.endSec - r.entrySec + 1;
        _recordPath(PAIR_BNB, r.entrySec, _flat(P0_BNB, n));
        _record(PAIR_BNB, r.endSec, P0_BNB + 5);
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(uint8(_round(id).voidReason), uint8(VoidReason.TerminalInvalid));
    }

    /// @dev An invalid mid-path spike is skipped even though it crosses the target, and `prev` still advances to
    /// it, so the snap-back is invalid too (path.ts semantics).
    function test_invalidMidPathSkipped_prevAlwaysAdvances() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256 n = r.endSec - r.entrySec + 1;
        uint256[] memory prices = _flat(P0_BNB, n);
        prices[1] = _px(P0_BNB, 30_000); // +3 %: invalid jump, above the target
        prices[2] = _px(P0_BNB, 100); // -2.9 % from prev: invalid again, not a touch
        _recordPath(PAIR_BNB, r.entrySec, prices);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Timeout));
        assertEq(payout, (uint256(STAKE) * 9_900) / 10_000);
    }

    // ── missing checkpoints ─────────────────────────────────────────────────────

    function test_void_checkpointGap_nonLateOracle() public {
        MockCheckpointOracle m = _useMock(false);
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        m.set(PAIR_BNB, r.entrySec, uint128(P0_BNB));
        vm.warp(r.entrySec + 4);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotDecidable.selector, id, r.entrySec + 1));
        arena.settle(id);
        m.setSourceLatest(PAIR_BNB, r.entrySec + 3); // upstream moved past sec+1: it can never be recorded
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(payout, STAKE);
        Round memory s = _round(id);
        assertEq(uint8(s.voidReason), uint8(VoidReason.CheckpointGap));
        assertEq(s.decisionSec, r.entrySec + 1);
        _assertLedger();
    }

    function test_gapNeverPermanentOnStatelessOracle() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec + 10);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 9, P0_BNB); // newer second recorded first
        assertFalse(oracle.isPermanentlyMissing(PAIR_BNB, r.entrySec + 1));
        _record(PAIR_BNB, r.entrySec + 1, P0_BNB); // backfill is still valid
        assertEq(oracle.get(PAIR_BNB, r.entrySec + 1).price18, P0_BNB);
        id;
    }

    function test_void_stalled() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        vm.warp(uint256(r.endSec) + 60);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotDecidable.selector, id, r.entrySec + 1));
        arena.settle(id);
        vm.warp(uint256(r.endSec) + 61);
        (Outcome o, uint256 payout) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(payout, STAKE);
        assertEq(uint8(_round(id).voidReason), uint8(VoidReason.Stalled));
    }

    function test_void_stalledMissingEntry() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(uint256(r.endSec) + 61);
        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.RoundSettled(id, alice, Outcome.Voided, STAKE, 0, 0, 0, r.entrySec, VoidReason.Stalled);
        arena.settle(id);
    }

    // ── voidStale ───────────────────────────────────────────────────────────────

    function test_voidStale_paths() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        vm.warp(r.entrySec);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotVoidable.selector, id, uint256(r.endSec) + 60));
        arena.voidStale(id);
        vm.warp(uint256(r.endSec) + 61);
        vm.expectRevert(BnbPlayArenaErrors.InsufficientGas.selector);
        arena.voidStale{gas: 600_000}(id);
        arena.voidStale(id);
        assertEq(uint8(_round(id).voidReason), uint8(VoidReason.Stalled));
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.RoundNotOpen.selector, id));
        arena.voidStale(id);
    }

    function test_voidStale_refusesRealOutcome() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256[] memory prices = _flat(P0_BNB, 2);
        prices[1] = P0_BNB - _barrierMove(P0_BNB, r.stopPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        vm.warp(uint256(r.endSec) + 100);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotVoidable.selector, id, 0));
        arena.voidStale(id);
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.StopHit));
    }

    function test_voidStale_brokenOracleAfterStall() public {
        MockCheckpointOracle m = _useMock(true);
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        m.setBroken(true);
        vm.expectRevert();
        arena.settle(id);
        vm.warp(uint256(r.endSec) + 60);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotVoidable.selector, id, uint256(r.endSec) + 60));
        arena.voidStale(id);
        vm.warp(uint256(r.endSec) + 61);
        arena.voidStale(id);
        Round memory s = _round(id);
        assertEq(uint8(s.outcome), uint8(Outcome.Voided));
        assertEq(uint8(s.voidReason), uint8(VoidReason.Stalled));
        assertEq(s.decisionSec, r.entrySec);
        assertEq(arena.balanceOf(alice), 1_000e18);
        _assertLedger();
    }

    // ── batch settlement ────────────────────────────────────────────────────────

    function test_recordAndSettle() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256 id2 = _open(bob, BNB, CRUISE, Direction.Short, STAKE);
        uint256[] memory ids = new uint256[](3);
        ids[0] = id;
        ids[1] = id2;
        ids[2] = 999; // unknown ids are skipped
        vm.warp(r.entrySec);
        arena.recordAndSettle(0, _proof(PAIR_BNB, r.entrySec, P0_BNB), ids); // not decidable yet: no revert
        assertEq(uint8(_round(id).status), uint8(RoundStatus.Open));
        vm.warp(r.entrySec + 1);
        arena.recordAndSettle(0, _proof(PAIR_BNB, r.entrySec + 1, P0_BNB + _barrierMove(P0_BNB, r.targetPpm)), ids);
        assertEq(uint8(_round(id).outcome), uint8(Outcome.TargetHit));
        assertEq(uint8(_round(id2).status), uint8(RoundStatus.Open)); // +226 ppm is inside the short's 434 ppm stop
    }

    function test_settleMany_limits() public {
        uint256[] memory ids = new uint256[](101);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TooManyIds.selector, 101, 100));
        arena.settleMany(ids);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InvalidOracle.selector, 7));
        arena.recordAndSettle(7, "", new uint256[](0));
    }

    function test_settleTwiceReverts_previewReturnsStored() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        uint256[] memory prices = _flat(P0_BNB, 2);
        prices[1] = P0_BNB + _barrierMove(P0_BNB, r.targetPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices);
        arena.settle(id);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.RoundNotOpen.selector, id));
        arena.settle(id);
        (bool d, Outcome o, uint256 payout, uint40 dec,) = arena.previewSettle(id);
        assertTrue(d);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
        assertEq(payout, r.maxPayout);
        assertEq(dec, r.entrySec + 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.RoundNotOpen.selector, 42));
        arena.previewSettle(42);
    }

    /// @dev Invariant 7: config changes never touch an open round.
    function test_snapshotSurvivesSetLaneAndSetActiveOracle() public {
        (uint256 id, Round memory r) = _openBnb(Direction.Long);
        LaneParams memory p = _lane(BNB, CRUISE);
        p.targetPpm = 1_000;
        p.stopPpm = 900;
        p.durationSec = 60;
        _setLane(BNB, CRUISE, p);
        vm.prank(deployer);
        arena.setActiveOracle(1);
        Round memory s = _round(id);
        assertEq(keccak256(abi.encode(s)), keccak256(abi.encode(r)));
        uint256[] memory prices = _flat(P0_BNB, 2);
        prices[1] = P0_BNB + _barrierMove(P0_BNB, r.targetPpm);
        _recordPath(PAIR_BNB, r.entrySec, prices); // still recorded into (and settled from) oracle 0
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
    }
}

interface BnbPlayArenaErrors {
    error InsufficientGas();
}
