// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {ICheckpointOracle} from "../../src/oracle/interfaces/ICheckpointOracle.sol";
import {AssetConfig, Direction, Lane, LaneParams} from "../../src/types/ArenaTypes.sol";
import {DeployConfig} from "../../script/lib/DeployConfig.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";

/// @notice Ledger, house pool, config validation, roles and the deployed P0 configuration.
contract ArenaAdminTest is ArenaTestBase {
    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ── deployed configuration ──────────────────────────────────────────────────

    function test_deployedConfigMatchesF1e() public view {
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(97));
        uint256 enabled;
        for (uint256 i; i < c.assets.length; ++i) {
            DeployConfig.AssetEntry memory a = c.assets[i];
            assertEq(keccak256(abi.encode(arena.getAsset(a.assetId))), keccak256(abi.encode(a.config)));
            for (uint256 j; j < a.lanes.length; ++j) {
                Lane memory l = arena.getLane(a.assetId, a.lanes[j].tier);
                assertEq(l.version, 1);
                assertEq(keccak256(abi.encode(l.p)), keccak256(abi.encode(a.lanes[j].params)));
                if (l.p.enabled) {
                    ++enabled;
                    assertEq(l.p.durationSec, 30);
                    assertEq(l.p.feeBps, 100);
                    assertEq(l.p.minStake, 5e18);
                    assertEq(l.p.maxStake, 50e18);
                    assertLe(a.lanes[j].tier, BOOST, "HYPER/WARP are coming soon");
                }
            }
        }
        assertEq(enabled, 9, "5 CRUISE + 4 BOOST (BTC BOOST disabled)");
        assertFalse(arena.getLane(BTC, BOOST).p.enabled);
        assertEq(arena.getLane(BNB, CRUISE).p.targetPpm, 226);
        assertEq(arena.getLane(BNB, CRUISE).p.stopPpm, 434);
        assertEq(arena.getLane(DOGE, BOOST).p.targetPpm, 794);
        assertEq(arena.getAsset(SOL).maxJumpPpm, 20_000);
        assertEq(arena.getAsset(DOGE).gapMarginPpm, 102);
    }

    function test_deployedWiringAndRoles() public view {
        assertEq(arena.oracleCount(), 2);
        assertEq(address(arena.oracles(0)), address(oracle));
        assertEq(address(arena.oracles(1)), address(signedOracle));
        assertEq(arena.activeOracleIdx(), 0);
        assertTrue(oracle.verifier().supportsLateVerification());
        assertFalse(oracle.verifier().isTrusted());
        assertTrue(signedOracle.verifier().isTrusted());
        assertEq(oracle.verifier().sourceId(), bytes32("SUPRA_DORA2_PULL_V2"));
        assertEq(signedOracle.verifier().sourceId(), bytes32("SIGNED_BACKEND_V1"));
        assertEq(arena.maxUtilizationBps(), 8000);
        assertEq(arena.maxPayoutPerRound(), 1_000e18);
        assertEq(arena.houseFree(), houseSeed);
        assertEq(houseSeed, 1_000_000e18);

        assertTrue(arena.hasRole(arena.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(arena.hasRole(arena.CONFIG_ROLE(), ops));
        assertTrue(arena.hasRole(arena.PAUSER_ROLE(), ops));
        assertTrue(arena.hasRole(arena.TREASURY_ROLE(), deployer));
        assertFalse(arena.hasRole(arena.TREASURY_ROLE(), ops));
        assertTrue(token.hasRole(token.MINTER_ROLE(), address(faucet)));
        assertTrue(faucet.hasRole(faucet.OPERATOR_ROLE(), ops));
        // no relayer or keeper role exists: the relayer/recorder keys hold nothing
        assertFalse(arena.hasRole(arena.CONFIG_ROLE(), recorder));
        assertEq(arena.ENTRY_DELAY_SEC(), 3);
        assertEq(arena.EXIT_DELAY_SEC(), 2);
        assertEq(arena.STALL_AFTER_SEC(), 60);
        assertEq(arena.MAX_IDS(), 100);
        assertEq(arena.MAX_RANGE(), 256);
    }

    // ── ledger ──────────────────────────────────────────────────────────────────

    function test_ledger_guards() public {
        vm.startPrank(alice);
        vm.expectRevert(IBnbPlayArena.ZeroAmount.selector);
        arena.deposit(0);
        vm.expectRevert(IBnbPlayArena.ZeroAddress.selector);
        arena.depositFor(address(0), 1);
        vm.expectRevert(IBnbPlayArena.ZeroAmount.selector);
        arena.withdraw(alice, 0);
        vm.expectRevert(IBnbPlayArena.ZeroAddress.selector);
        arena.withdraw(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InsufficientBalance.selector, 1_000e18, 1_000e18 + 1));
        arena.withdraw(alice, 1_000e18 + 1);
        arena.withdraw(bob, 1_000e18);
        vm.stopPrank();
        assertEq(token.balanceOf(bob), 1_000e18);
        assertEq(arena.balanceOf(alice), 0);
        assertEq(arena.totalPlayerBalances(), 2_000e18);
        _assertLedger();
    }

    function test_house_fundWithdrawSkim() public {
        _mint(carol, 500e18);
        vm.startPrank(carol);
        token.approve(address(arena), 500e18);
        arena.fundHouse(400e18); // anyone may fund
        token.transfer(address(arena), 100e18); // a donation
        vm.stopPrank();
        assertEq(arena.houseFree(), houseSeed + 400e18);
        assertEq(arena.surplus(), 100e18);
        _assertLedger();
        vm.expectEmit(address(arena));
        emit IBnbPlayArena.Skimmed(100e18);
        arena.skim();
        assertEq(arena.surplus(), 0);
        assertEq(arena.houseFree(), houseSeed + 500e18);
        arena.skim(); // no-op

        bytes memory unauthorized = _unauthorized(alice, arena.TREASURY_ROLE());
        vm.prank(alice);
        vm.expectRevert(unauthorized);
        arena.withdrawHouse(alice, 1);
        uint256 free = arena.houseFree();
        vm.startPrank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InsufficientHouseLiquidity.selector, free, free + 1));
        arena.withdrawHouse(deployer, free + 1);
        vm.stopPrank();

        // Reserved liquidity is not withdrawable.
        _open(alice, BNB, BOOST, Direction.Long, 50e18);
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InsufficientHouseLiquidity.selector, free - 50e18, free));
        arena.withdrawHouse(deployer, free);
        vm.prank(deployer);
        arena.withdrawHouse(deployer, free - 50e18);
        assertEq(arena.houseFree(), 0);
        assertEq(arena.houseReserved(), 50e18);
        _assertLedger();
    }

    // ── lanes & assets ──────────────────────────────────────────────────────────

    function _base() internal view returns (LaneParams memory) {
        return _lane(BNB, CRUISE);
    }

    function test_setLane_validation() public {
        LaneParams[11] memory bad;
        for (uint256 i; i < 11; ++i) {
            bad[i] = _base();
        }
        bad[0].targetPpm = 9;
        bad[1].stopPpm = 100_001;
        bad[2].multiplierBps = 10_000;
        bad[3].multiplierBps = 100_001;
        bad[4].feeBps = 1_001;
        bad[5].durationSec = 4;
        bad[6].durationSec = 121;
        bad[7].minStake = 0;
        bad[8].minStake = 51e18; // > maxStake
        bad[9].targetPpm = 100_001;
        bad[10].stopPpm = 9;
        vm.startPrank(deployer);
        for (uint256 i; i < 11; ++i) {
            vm.expectRevert(IBnbPlayArena.InvalidLane.selector);
            arena.setLane(BNB, CRUISE, bad[i]);
        }
        LaneParams memory ok = _base();
        vm.expectRevert(IBnbPlayArena.InvalidLane.selector);
        arena.setLane(BNB, 4, ok); // only 4 tiers

        LaneParams memory edge = _base();
        edge.stopPpm = 453; // 5000·453 = 2,265,000 > 10000·226
        vm.expectRevert(IBnbPlayArena.HouseEdgeViolated.selector);
        arena.setLane(BNB, CRUISE, edge);
        edge.stopPpm = 452; // 2,260,000 == 2,260,000: inclusive
        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.LaneConfigured(BNB, CRUISE, 2, edge);
        arena.setLane(BNB, CRUISE, edge);
        vm.stopPrank();
        assertEq(_version(BNB, CRUISE), 2);

        bytes memory unauthorized = _unauthorized(alice, arena.CONFIG_ROLE());
        vm.prank(alice);
        vm.expectRevert(unauthorized);
        arena.setLane(BNB, CRUISE, ok);
    }

    function test_setLane_gapMarginAboveTwoX() public {
        // HYPER (M = 3.0x) is where the gap margin bites: 20000·276 + 10000·gap <= 10000·718 ⇔ gap <= 166.
        LaneParams memory h = _lane(BNB, HYPER);
        h.enabled = true;
        _setLane(BNB, HYPER, h);
        AssetConfig memory a = arena.getAsset(BNB);
        a.gapMarginPpm = 167;
        vm.prank(deployer);
        vm.expectRevert(IBnbPlayArena.HouseEdgeViolated.selector);
        arena.setAsset(BNB, a); // re-checks enabled lanes against the new gap
        a.gapMarginPpm = 166;
        vm.prank(deployer);
        arena.setAsset(BNB, a);
        h.targetPpm = 717;
        vm.prank(deployer);
        vm.expectRevert(IBnbPlayArena.HouseEdgeViolated.selector);
        arena.setLane(BNB, HYPER, h);
    }

    function test_setAsset_setLimits_oracles() public {
        vm.startPrank(deployer);
        vm.expectRevert(IBnbPlayArena.InvalidAsset.selector);
        arena.setAsset(7, AssetConfig({pairId: 1, maxJumpPpm: 0, gapMarginPpm: 1, enabled: true}));
        vm.expectRevert(IBnbPlayArena.InvalidAsset.selector);
        arena.setAsset(7, AssetConfig({pairId: 1, maxJumpPpm: 1_000_001, gapMarginPpm: 1, enabled: true}));
        vm.expectRevert(IBnbPlayArena.InvalidAsset.selector);
        arena.setAsset(7, AssetConfig({pairId: 1, maxJumpPpm: 1, gapMarginPpm: 100_001, enabled: true}));
        vm.expectRevert(IBnbPlayArena.InvalidLimits.selector);
        arena.setLimits(10_001, 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InvalidOracle.selector, 2));
        arena.addOracle(ICheckpointOracle(address(0)));
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InvalidOracle.selector, 2));
        arena.setActiveOracle(2);
        vm.expectEmit(address(arena));
        emit IBnbPlayArena.ActiveOracleSet(1);
        arena.setActiveOracle(1);
        vm.stopPrank();

        // New rounds bind to the active oracle.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.OracleMismatch.selector, 1, 0));
        arena.openRound(BNB, CRUISE, Direction.Long, 10e18, 1, 0);
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, 10e18);
        assertEq(_round(id).oracleIdx, 1);
    }

    function test_adminCannotTouchBalances() public {
        // There is no function that moves a player balance or an open round for an admin: the only admin outflow is
        // withdrawHouse, bounded by houseFree.
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, 10e18);
        vm.startPrank(deployer);
        arena.withdrawHouse(deployer, arena.houseFree());
        arena.pause();
        vm.stopPrank();
        assertEq(arena.balanceOf(alice), 990e18);
        assertEq(arena.stakesLocked(), 10e18);
        assertEq(arena.houseReserved(), 5e18);
        vm.warp(uint256(_round(id).endSec) + 61);
        arena.settle(id); // stalled void still refunds from the reserved bucket
        assertEq(arena.balanceOf(alice), 1_000e18);
        _assertLedger();
    }
}
