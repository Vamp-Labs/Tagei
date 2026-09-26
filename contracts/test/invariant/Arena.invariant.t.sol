// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Test.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {SupraPriceVerifier} from "../../src/oracle/SupraPriceVerifier.sol";
import {ISupraOraclePull} from "../../src/oracle/interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../../src/oracle/interfaces/ISupraSValueFeed.sol";
import {Outcome, Round, RoundStatus} from "../../src/types/ArenaTypes.sol";
import {MockSupraPull} from "../mocks/MockSupraPull.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";
import {SupraProofBuilder} from "../utils/SupraProofBuilder.sol";
import {ArenaHandler} from "./ArenaHandler.sol";

/// @notice F1a §9 invariants over the production wiring plus a stateful (griefable) oracle at idx 2.
contract ArenaInvariantTest is ArenaTestBase {
    ArenaHandler internal handler;
    address[5] internal ps;

    function setUp() public override {
        super.setUp();
        MockSupraPull pull = new MockSupraPull();
        SupraPriceVerifier sv = new SupraPriceVerifier(
            ISupraOraclePull(address(pull)), ISupraSValueFeed(address(pull)), SupraProofBuilder.pairs()
        );
        CheckpointOracle stateful = new CheckpointOracle(sv);
        vm.prank(deployer);
        arena.addOracle(stateful); // idx 2

        (address dave, uint256 daveKey) = makeAddrAndKey("dave");
        (address erin, uint256 erinKey) = makeAddrAndKey("erin");
        _fund(dave, 1_000e18);
        _fund(erin, 1_000e18);
        ps = [alice, bob, carol, dave, erin];
        handler = new ArenaHandler(
            arena, token, committee, pull, oracle, stateful, deployer, ps, [aliceKey, bobKey, carolKey, daveKey, erinKey]
        );

        handler.setTuner(ops);
        bytes4[] memory sel = new bytes4[](26);
        sel[0] = ArenaHandler.record.selector;
        sel[1] = ArenaHandler.record.selector;
        sel[2] = ArenaHandler.record.selector;
        sel[3] = ArenaHandler.backfill.selector;
        sel[4] = ArenaHandler.grief.selector;
        sel[5] = ArenaHandler.warp.selector;
        sel[6] = ArenaHandler.warp.selector;
        sel[7] = ArenaHandler.warp.selector;
        sel[8] = ArenaHandler.open.selector;
        sel[9] = ArenaHandler.open.selector;
        sel[10] = ArenaHandler.cashOut.selector;
        sel[11] = ArenaHandler.withdraw.selector;
        sel[12] = ArenaHandler.deposit.selector;
        sel[13] = ArenaHandler.settle.selector;
        sel[14] = ArenaHandler.settle.selector;
        sel[15] = ArenaHandler.settleMany.selector;
        sel[16] = ArenaHandler.settleMany.selector;
        sel[17] = ArenaHandler.voidStale.selector;
        sel[18] = ArenaHandler.adminSetLane.selector;
        sel[19] = ArenaHandler.adminToggleOracle.selector;
        sel[20] = ArenaHandler.donate.selector;
        sel[21] = ArenaHandler.adminPause.selector;
        sel[22] = ArenaHandler.adminHouse.selector;
        sel[23] = ArenaHandler.cashOut.selector;
        sel[24] = ArenaHandler.tunerTuneLane.selector;
        sel[25] = ArenaHandler.adminSetAsset.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
        targetContract(address(handler));
    }

    function _open() internal view returns (uint256 maxPayoutSum, uint256 stakeSum) {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            Round memory r = arena.getRound(handler.ids(i));
            if (r.status == RoundStatus.Open) {
                maxPayoutSum += r.maxPayout;
                stakeSum += r.stake;
            }
        }
    }

    /// 1. token balance == player balances + houseFree + houseReserved + stakesLocked + surplus
    function invariant_1_conservation() public view {
        assertEq(
            token.balanceOf(address(arena)),
            arena.totalPlayerBalances() + arena.houseFree() + arena.houseReserved() + arena.stakesLocked()
                + arena.surplus()
        );
        assertEq(arena.surplus(), handler.donated() - handler.skimmed(), "surplus = unskimmed donations");
    }

    /// 2. balance >= Σ player balances + Σ open maxPayout
    function invariant_2_solvency() public view {
        uint256 players;
        for (uint256 i; i < 5; ++i) {
            players += arena.balanceOf(ps[i]);
        }
        assertEq(players, arena.totalPlayerBalances(), "ledger total");
        (uint256 maxSum,) = _open();
        assertGe(token.balanceOf(address(arena)), players + maxSum);
    }

    /// 3. stakesLocked + houseReserved == Σ open maxPayout
    function invariant_3_locks() public view {
        (uint256 maxSum, uint256 stakeSum) = _open();
        assertEq(arena.stakesLocked() + arena.houseReserved(), maxSum);
        assertEq(arena.stakesLocked(), stakeSum);
    }

    /// 4. payout <= maxPayout; TargetHit = maxPayout, StopHit = 0, Voided = stake
    function invariant_4_payoutRules() public view {
        assertFalse(handler.payoutRuleBroken(), handler.why());
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            Round memory r = arena.getRound(handler.ids(i));
            if (r.status != RoundStatus.Settled) continue;
            assertLe(r.payout, r.maxPayout);
            if (r.outcome == Outcome.TargetHit) assertEq(r.payout, r.maxPayout);
            if (r.outcome == Outcome.StopHit) assertEq(r.payout, 0);
            if (r.outcome == Outcome.Voided) assertEq(r.payout, r.stake);
        }
    }

    /// 5. a round settles exactly once
    function invariant_5_settleOnce() public view {
        assertFalse(handler.doubleSettle(), handler.why());
    }

    /// 6. activeRoundOf[p] is 0 or an open round owned by p
    function invariant_6_activeRound() public view {
        for (uint256 i; i < 5; ++i) {
            uint256 id = arena.activeRoundOf(ps[i]);
            if (id == 0) continue;
            Round memory r = arena.getRound(id);
            assertEq(uint8(r.status), uint8(RoundStatus.Open));
            assertEq(r.player, ps[i]);
        }
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            Round memory r = arena.getRound(id);
            if (r.status == RoundStatus.Open) assertEq(arena.activeRoundOf(r.player), id);
        }
    }

    /// 7. a round's snapshot never changes after setLane / setActiveOracle (only a cash-out shortens endSec)
    function invariant_7_snapshot() public view {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            assertEq(handler.snapOf(id), handler.snapshot(id));
            Round memory r = arena.getRound(id);
            assertGt(r.endSec, r.entrySec);
            assertLe(r.endSec, r.entrySec + 120);
        }
    }

    /// 8. pause never blocks cash-out, record, settle, void or withdraw
    function invariant_8_pause() public view {
        assertFalse(handler.pauseBlocked(), handler.why());
    }

    /// 9. every outcome equals the reference evaluation of the recorded path
    function invariant_9_reference() public view {
        assertFalse(handler.mismatch(), handler.why());
    }

    /// 10. checkpoints are write-once
    function invariant_10_writeOnce() public view {
        assertFalse(handler.checkpointRewritten(), handler.why());
        uint256 n = handler.recCount();
        for (uint256 i; i < n; i += 1 + n / 32) {
            ArenaHandler.Rec memory r = handler.recAt(i);
            CheckpointOracle o = r.oracle == 0 ? oracle : CheckpointOracle(address(arena.oracles(2)));
            assertEq(o.get(r.pair, r.sec).price18, r.price);
        }
    }

    /// 11. nonces are monotonic
    function invariant_11_nonces() public view {
        assertFalse(handler.nonceDecreased(), handler.why());
        for (uint256 i; i < 5; ++i) {
            assertGe(arena.nonces(ps[i], 0), handler.lastNonce(ps[i], 0));
            assertGe(arena.nonces(ps[i], 1), handler.lastNonce(ps[i], 1));
        }
    }

    /// @notice Deterministic griefing scenario: on the stateful oracle a pushed newer Supra round turns the
    /// unrecorded seconds into a permanent gap and the round voids as CheckpointGap (stake refunded).
    function test_griefCreatesPermanentGapOnStatefulOracle() public {
        handler.adminToggleOracle(1); // odd seed → stateful oracle (idx 2)
        handler.open(0, 4, false, false, 0, false); // alice, BNB CRUISE
        uint256 id = arena.activeRoundOf(alice);
        Round memory r = arena.getRound(id);
        assertEq(r.oracleIdx, 2);
        vm.warp(r.entrySec + 4);
        handler.grief(0); // Supra now holds entrySec + 4; entry .. +3 were never recorded
        handler.settle(0);
        r = arena.getRound(id);
        assertEq(uint8(r.outcome), uint8(Outcome.Voided));
        assertEq(uint8(r.voidReason), 3); // CheckpointGap
        assertEq(r.payout, r.stake);
        assertFalse(handler.mismatch(), handler.why());
    }

    /// 12. liveness: a round past its stall window is always settleable (a void at worst) and never stuck
    function invariant_12_liveness() public view {
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.ids(i);
            Round memory r = arena.getRound(id);
            if (r.status != RoundStatus.Open || block.timestamp <= uint256(r.endSec) + 60) continue;
            (bool decidable,,,,) = arena.previewSettle(id);
            assertTrue(decidable, "open round past the stall window is not settleable");
        }
    }

    function afterInvariant() external view {
        uint256 settled;
        uint256 voided;
        uint256 n = handler.idCount();
        for (uint256 i; i < n; ++i) {
            Round memory r = arena.getRound(handler.ids(i));
            if (r.status == RoundStatus.Settled) ++settled;
            if (r.outcome == Outcome.Voided) ++voided;
        }
        console.log("rounds", n, "settled", settled);
        console.log("voided", voided, "checkpoints", handler.recCount());
        console.log("calls open/settle", handler.calls("open"), handler.calls("settle"));
        console.log("calls record/warp", handler.calls("record"), handler.calls("warp"));
    }
}
