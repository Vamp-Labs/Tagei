// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {LaneMath} from "../../src/libraries/LaneMath.sol";
import {Direction, LaneParams, Outcome, Round, RoundStatus, VoidReason} from "../../src/types/ArenaTypes.sol";
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
        assertEq(r.entrySec, block.timestamp + 3);
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
}
