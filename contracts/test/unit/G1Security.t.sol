// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {ICheckpointOracle} from "../../src/oracle/interfaces/ICheckpointOracle.sol";
import {IPriceVerifier} from "../../src/oracle/interfaces/IPriceVerifier.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {
    AssetConfig,
    Direction,
    Lane,
    LaneParams,
    OpenRoundIntent,
    Outcome,
    Round,
    RoundStatus,
    TuneBounds,
    VoidReason
} from "../../src/types/ArenaTypes.sol";
import {MockCheckpointOracle, MockVerifierInfo} from "../mocks/MockCheckpointOracle.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";
import {SupraProofBuilder} from "../utils/SupraProofBuilder.sol";

/// @dev The G1 PoC's malicious oracle: every second after entry is +100 %.
contract EvilOracle is ICheckpointOracle {
    IPriceVerifier public immutable verifier;

    constructor(IPriceVerifier v) {
        verifier = v;
    }

    function record(bytes calldata) external pure returns (uint256) {
        return 0;
    }

    function get(uint32, uint40) external pure returns (Checkpoint memory c) {}

    function getRange(uint32, uint40 f, uint40 t) external pure returns (Checkpoint[] memory out) {
        out = new Checkpoint[](uint256(t - f) + 1);
        out[0] = Checkpoint(1e18, 0, 1);
        for (uint256 k = 1; k < out.length; ++k) {
            out[k] = Checkpoint(2e18, 0, 1);
        }
    }

    function lastRecordedSec(uint32) external pure returns (uint40) {
        return 0;
    }

    function latestKnownSec(uint32) external pure returns (uint40) {
        return 0;
    }

    function isPermanentlyMissing(uint32, uint40) external pure returns (bool) {
        return false;
    }
}

/// @notice Regression tests for the G1 review (H1, L1, L2, L3, voidStale gas floor).
contract G1SecurityTest is ArenaTestBase {
    uint128 internal constant STAKE = 10e18;

    function _unauth(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ── H1: the ops hot key has no CONFIG power ─────────────────────────────────

    function test_H1_opsCannotCallConfigFunctions() public {
        bytes32 cfg = arena.CONFIG_ROLE();
        LaneParams memory p = _lane(BNB, CRUISE);
        AssetConfig memory a = arena.getAsset(BNB);
        ICheckpointOracle o = new MockCheckpointOracle(true);
        vm.startPrank(ops);
        vm.expectRevert(_unauth(ops, cfg));
        arena.addOracle(o);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setActiveOracle(1);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setLimits(10_000, type(uint128).max);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setAsset(BNB, a);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setLane(BNB, CRUISE, p);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setLaneTuneBounds(BNB, CRUISE, 10, 100_000, 10, 100_000);
        vm.stopPrank();
    }

    /// @notice G1 PoC 1 (ops key drains the house) must fail now: every step needs the cold CONFIG key, and the
    /// tuner's most aggressive in-bounds lane still passes the house-edge guard.
    function test_H1_regression_opsDrainFails() public {
        bytes32 cfg = arena.CONFIG_ROLE();
        vm.startPrank(ops);
        EvilOracle evil = new EvilOracle(new MockVerifierInfo(true, false));
        vm.expectRevert(_unauth(ops, cfg));
        arena.addOracle(evil);
        vm.expectRevert(_unauth(ops, cfg));
        arena.setAsset(BNB, AssetConfig({pairId: 49, maxJumpPpm: 1_000_000, gapMarginPpm: 0, enabled: true}));
        vm.expectRevert(_unauth(ops, cfg));
        arena.setLane(
            BNB,
            CRUISE,
            LaneParams({
                targetPpm: 100_000,
                stopPpm: 10,
                multiplierBps: 100_000,
                feeBps: 0,
                durationSec: 5,
                enabled: true,
                minStake: 1,
                maxStake: type(uint128).max
            })
        );
        vm.expectRevert(_unauth(ops, cfg));
        arena.setLimits(10_000, type(uint128).max);

        // Best the tuner can do: T at its minimum, S at its maximum → violates the guard, so it is refused.
        TuneBounds memory b = arena.getLaneTuneBounds(BNB, CRUISE);
        vm.expectRevert(IBnbPlayArena.HouseEdgeViolated.selector);
        arena.tuneLane(BNB, CRUISE, b.minTargetPpm, b.maxStopPpm);
        vm.stopPrank();
        assertEq(arena.houseFree(), houseSeed);
        assertEq(address(arena.oracles(arena.activeOracleIdx())), address(oracle));
    }

    // ── tuneLane ────────────────────────────────────────────────────────────────

    function test_tuneLane_changesOnlyTAndS() public {
        LaneParams memory before = _lane(BNB, CRUISE);
        TuneBounds memory b = arena.getLaneTuneBounds(BNB, CRUISE);
        assertEq(b.minTargetPpm, 113); // ceil(226 / 2)
        assertEq(b.maxTargetPpm, 452); // 226 · 2
        assertEq(b.minStopPpm, 217);
        assertEq(b.maxStopPpm, 868);

        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);

        LaneParams memory expected = before;
        expected.targetPpm = 452;
        expected.stopPpm = 868; // k = 2 (a volatile regime), guard: 5000·868 = 4.34M <= 4.52M
        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.LaneConfigured(BNB, CRUISE, 2, expected);
        vm.prank(ops);
        arena.tuneLane(BNB, CRUISE, 452, 868);

        Lane memory l = arena.getLane(BNB, CRUISE);
        assertEq(l.version, 2);
        assertEq(keccak256(abi.encode(l.p)), keccak256(abi.encode(expected)));
        assertEq(keccak256(abi.encode(_round(id))), keccak256(abi.encode(r)), "open round keeps its snapshot");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneVersionMismatch.selector, 2, 1));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);
    }

    function test_tuneLane_bounds() public {
        vm.startPrank(ops);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 112, 434));
        arena.tuneLane(BNB, CRUISE, 112, 434);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 453, 434));
        arena.tuneLane(BNB, CRUISE, 453, 434);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 226, 216));
        arena.tuneLane(BNB, CRUISE, 226, 216);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 226, 869));
        arena.tuneLane(BNB, CRUISE, 226, 869);
        // no bounds were ever set for an unknown asset: every value is out of bounds
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 226, 434));
        arena.tuneLane(7, CRUISE, 226, 434);
        // in bounds but the guard fails: (M-1)·S > T
        vm.expectRevert(IBnbPlayArena.HouseEdgeViolated.selector);
        arena.tuneLane(BNB, CRUISE, 200, 434);
        vm.stopPrank();

        bytes32 tuner = arena.LANE_TUNER_ROLE();
        vm.prank(alice);
        vm.expectRevert(_unauth(alice, tuner));
        arena.tuneLane(BNB, CRUISE, 226, 434);
    }

    function test_tuneLane_neverEnablesADisabledLane() public {
        assertFalse(_lane(BTC, BOOST).enabled);
        vm.prank(ops);
        arena.tuneLane(BTC, BOOST, 300, 250);
        assertFalse(_lane(BTC, BOOST).enabled);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneDisabled.selector, BTC, BOOST));
        arena.openRound(BTC, BOOST, Direction.Long, STAKE, 2, 0);
    }

    function test_setLaneTuneBounds_isCold() public {
        vm.prank(deployer);
        vm.expectEmit(true, true, false, true, address(arena));
        emit IBnbPlayArena.LaneTuneBoundsSet(BNB, CRUISE, TuneBounds(200, 300, 400, 500));
        arena.setLaneTuneBounds(BNB, CRUISE, 200, 300, 400, 500);
        vm.prank(ops);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.TuneOutOfBounds.selector, 452, 868));
        arena.tuneLane(BNB, CRUISE, 452, 868);
    }

    // ── L2: setAsset re-versions its lanes ──────────────────────────────────────

    /// @notice G1 PoC 5 must fail: an intent signed before setAsset can no longer open on the re-pointed asset.
    function test_L2_setAssetBumpsLaneVersions() public {
        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sig = _signOpen(aliceKey, i);
        uint32[4] memory before;
        for (uint8 t; t < 4; ++t) {
            before[t] = _version(BNB, t);
        }
        vm.prank(deployer);
        arena.setAsset(BNB, AssetConfig({pairId: 3, maxJumpPpm: 1_000_000, gapMarginPpm: 38, enabled: true}));
        for (uint8 t; t < 4; ++t) {
            assertEq(_version(BNB, t), before[t] + 1);
        }
        assertEq(_version(ETH, CRUISE), 1, "other assets untouched");
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneVersionMismatch.selector, before[0] + 1, i.laneVersion));
        arena.openRoundWithSig(i, sig);
    }

    // ── L1: a disputed second voids the round ───────────────────────────────────

    /// @notice G1 PoC 3 must fail: a late conflicting proof on the touching second no longer flips TargetHit into
    /// StopHit; the round voids (stake refunded).
    function test_L1_regression_disputeVoidsInsteadOfFlipping() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);
        vm.warp(r.entrySec + 2);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 1, P0_BNB + _barrierMove(P0_BNB, r.targetPpm));
        _record(PAIR_BNB, r.entrySec + 2, P0_BNB - _barrierMove(P0_BNB, r.stopPpm));
        SupraProofV2.CommitteeFeed[] memory f = new SupraProofV2.CommitteeFeed[](1);
        f[0] = SupraProofBuilder.feed(PAIR_BNB, uint128(P0_BNB), uint64(r.entrySec + 1) * 1000);
        oracle.record(SupraProofBuilder.build(committee, 1, f, 0));

        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.RoundSettled(
            id, alice, Outcome.Voided, STAKE, 0, P0_BNB, 0, r.entrySec + 1, VoidReason.PathDisputed
        );
        (Outcome o, uint256 pay) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Voided));
        assertEq(pay, STAKE);
    }

    function test_L1_disputeAfterDecisionHasNoEffect() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);
        vm.warp(r.entrySec + 3);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 1, P0_BNB + _barrierMove(P0_BNB, r.targetPpm));
        _record(PAIR_BNB, r.entrySec + 2, P0_BNB);
        _record(PAIR_BNB, r.entrySec + 2, P0_BNB + 1); // disputed, but after the decisive second
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.TargetHit));
    }

    // ── L3: fault-isolated batches ──────────────────────────────────────────────

    function test_L3_batchSkipsARevertingRound() public {
        MockCheckpointOracle m = _useMock(true);
        uint256 bad = _open(bob, BNB, CRUISE, Direction.Long, STAKE); // on the mock oracle
        vm.prank(deployer);
        arena.setActiveOracle(0);
        uint256 good = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(good);
        m.setBroken(true); // bob's round now reverts on every evaluation

        uint256[] memory ids = new uint256[](2);
        ids[0] = bad;
        ids[1] = good;
        vm.warp(r.entrySec + 1);
        _record(PAIR_BNB, r.entrySec, P0_BNB);
        arena.recordAndSettle(0, _proof(PAIR_BNB, r.entrySec + 1, P0_BNB + _barrierMove(P0_BNB, r.targetPpm)), ids);
        assertEq(uint8(_round(good).outcome), uint8(Outcome.TargetHit), "healthy round settled");
        assertEq(uint8(_round(bad).status), uint8(RoundStatus.Open), "broken round skipped");
        assertEq(oracle.get(PAIR_BNB, r.entrySec + 1).flags, 1, "record kept");
        arena.settleMany(ids); // no revert either

        vm.expectRevert(IBnbPlayArena.OnlySelf.selector);
        arena.settleFromBatch(bad);
    }

    // ── voidStale gas floor ─────────────────────────────────────────────────────

    /// @notice The floor gives the probe ~4x the gas of the worst honest evaluation (cold 121-second path, ~0.37M), and
    /// starving voidStale around the floor never voids a decidable round (G1 PoC 4).
    function test_voidStale_gasFloorMargin() public {
        assertEq(arena.VOID_STALE_MIN_GAS(), 1_500_000);
        LaneParams memory p = _lane(BNB, CRUISE);
        p.durationSec = 120;
        _setLane(BNB, CRUISE, p);
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);
        _recordPath(PAIR_BNB, r.entrySec, _flat(P0_BNB, 121));
        vm.warp(uint256(r.endSec) + 61);

        uint256 minGas;
        for (uint256 gas = 100_000; gas < 1_500_000; gas += 10_000) {
            try arena.previewSettle{gas: gas}(id) {
                minGas = gas;
                break;
            } catch {}
        }
        assertGt(minGas, 0);
        assertLt(minGas * 3, (arena.VOID_STALE_MIN_GAS() * 63) / 64, "3x headroom");
        emit log_named_uint("min gas for a cold previewSettle (121 s path)", minGas);

        for (uint256 gas = 1_500_000; gas < 1_600_000; gas += 5_000) {
            try arena.voidStale{gas: gas}(id) {
                revert("voidStale voided a decidable round");
            } catch {}
        }
        assertEq(uint8(_round(id).status), uint8(RoundStatus.Open));
        (Outcome o,) = arena.settle(id);
        assertEq(uint8(o), uint8(Outcome.Timeout));
    }

    function test_eip712DomainMatchesOz() public view {
        (bytes1 fields, string memory name, string memory version, uint256 chainId, address vc, bytes32 salt, uint256[] memory ext)
        = arena.eip712Domain();
        assertEq(fields, hex"0f");
        assertEq(name, "BnbPlayArena");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(arena));
        assertEq(salt, bytes32(0));
        assertEq(ext.length, 0);
    }
}
