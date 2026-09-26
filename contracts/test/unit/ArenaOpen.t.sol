// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {
    CashOutIntent,
    Direction,
    LaneParams,
    OpenRoundIntent,
    Outcome,
    Round,
    RoundTerms,
    WithdrawIntent
} from "../../src/types/ArenaTypes.sol";
import {MockERC1271Wallet, Plain7702Delegate} from "../mocks/MockWallets.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";

/// @notice Open guards and caps, signed intents (replay, deadline, ERC-1271, EIP-7702), cash-out guards, pause matrix.
contract ArenaOpenTest is ArenaTestBase {
    uint128 internal constant STAKE = 10e18;
    address internal relayer = makeAddr("relayer");

    // ── open guards ─────────────────────────────────────────────────────────────

    function test_open_rejectsDisabledOrUnknown() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.AssetDisabled.selector, 7));
        arena.openRound(7, CRUISE, Direction.Long, STAKE, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneDisabled.selector, BTC, BOOST));
        arena.openRound(BTC, BOOST, Direction.Long, STAKE, 1, 0); // BTC BOOST disabled (F1e)
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneDisabled.selector, BNB, HYPER));
        arena.openRound(BNB, HYPER, Direction.Long, STAKE, 1, 0); // "coming soon"
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.LaneVersionMismatch.selector, 1, 2));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 2, 0);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.OracleMismatch.selector, 0, 1));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.StakeOutOfRange.selector, 4e18, 5e18, 50e18));
        arena.openRound(BNB, CRUISE, Direction.Long, 4e18, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.StakeOutOfRange.selector, 51e18, 5e18, 50e18));
        arena.openRound(BNB, CRUISE, Direction.Long, 51e18, 1, 0);
        vm.stopPrank();
        vm.prank(makeAddr("broke"));
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InsufficientBalance.selector, 0, STAKE));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);
    }

    function test_open_everyP0LaneIsPlayable() public {
        uint8[9] memory assets = [BNB, BNB, BTC, ETH, ETH, SOL, SOL, DOGE, DOGE];
        uint8[9] memory tiers = [CRUISE, BOOST, CRUISE, CRUISE, BOOST, CRUISE, BOOST, CRUISE, BOOST];
        for (uint256 i; i < 9; ++i) {
            address p = address(uint160(0xA000 + i));
            _fund(p, 50e18);
            uint256 id = _open(p, assets[i], tiers[i], Direction.Long, 50e18);
            assertEq(_round(id).multiplierBps, tiers[i] == CRUISE ? 15_000 : 20_000);
            assertEq(_round(id).endSec - _round(id).entrySec, 30);
        }
    }

    function test_open_oneRoundPerPlayer() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.PlayerHasOpenRound.selector, id));
        arena.openRound(ETH, CRUISE, Direction.Short, STAKE, 1, 0);
    }

    function test_open_entryMustBeUnknown() public {
        uint40 entry = uint40(vm.getBlockTimestamp()) + 3;
        _record(PAIR_BNB, entry, P0_BNB); // allowed: Supra's own future bound is +3 s
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.EntryNotInFuture.selector, entry, entry));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);
        _open(alice, ETH, CRUISE, Direction.Long, STAKE); // other pairs are unaffected
    }

    function test_open_caps() public {
        vm.prank(deployer);
        arena.setLimits(8000, 14e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.MaxPayoutExceeded.selector, 15e18, 14e18));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);

        vm.prank(deployer);
        arena.setLimits(1, 1_000e18); // 0.01 % of a 1M house = 100 tUSD of reserve
        _open(alice, BNB, BOOST, Direction.Long, 50e18); // reserve 50
        _open(bob, BNB, BOOST, Direction.Long, 50e18); // reserve 100: exactly at the cap
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.UtilizationCapExceeded.selector, 105e18, 100e18));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);

        vm.startPrank(deployer);
        arena.setLimits(10_000, 1_000e18);
        uint256 free = arena.houseFree();
        arena.withdrawHouse(deployer, free - 1e18);
        vm.stopPrank();
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.InsufficientHouseLiquidity.selector, 1e18, 5e18));
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);
    }

    function test_open_emitsTerms() public {
        LaneParams memory p = _lane(BNB, CRUISE);
        uint40 entry = uint40(vm.getBlockTimestamp()) + 3;
        RoundTerms memory t = RoundTerms({
            tier: CRUISE,
            direction: Direction.Short,
            stake: STAKE,
            maxPayout: 15e18,
            entrySec: entry,
            endSec: entry + 30,
            laneVersion: 1,
            oracleIdx: 0,
            pairId: PAIR_BNB,
            targetPpm: p.targetPpm,
            stopPpm: p.stopPpm,
            multiplierBps: p.multiplierBps,
            feeBps: p.feeBps,
            maxJumpPpm: 15_000
        });
        vm.expectEmit(true, true, true, true, address(arena));
        emit IBnbPlayArena.RoundOpened(1, alice, BNB, t);
        _open(alice, BNB, CRUISE, Direction.Short, STAKE);
        assertEq(arena.quoteMaxPayout(BNB, CRUISE, STAKE), 15e18);
    }

    // ── signed opens ────────────────────────────────────────────────────────────

    function test_openWithSig_relayed() public {
        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sig = _signOpen(aliceKey, i);
        vm.prank(relayer);
        uint256 id = arena.openRoundWithSig(i, sig);
        assertEq(_round(id).player, alice);
        assertEq(arena.nonces(alice, 0), 1);
        assertEq(arena.balanceOf(relayer), 0);
    }

    function test_openWithSig_replayAndCancel() public {
        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sig = _signOpen(aliceKey, i);
        arena.openRoundWithSig(i, sig);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice, 1));
        arena.openRoundWithSig(i, sig);

        // A direct open consumes nonce key 0 and cancels any pending signed intent.
        OpenRoundIntent memory j = _openIntent(bob, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sigJ = _signOpen(bobKey, j);
        uint256 id = _open(bob, ETH, CRUISE, Direction.Long, STAKE);
        assertEq(arena.nonces(bob, 0), 1);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, bob, 1));
        arena.openRoundWithSig(j, sigJ);
        id;
    }

    function test_openWithSig_badInputs() public {
        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sig = _signOpen(aliceKey, i);

        bytes memory bobSig = _signOpen(bobKey, i);
        vm.expectRevert(IBnbPlayArena.InvalidSignature.selector);
        arena.openRoundWithSig(i, bobSig); // wrong signer

        OpenRoundIntent memory tampered = i;
        tampered.stake = STAKE + 1;
        vm.expectRevert(IBnbPlayArena.InvalidSignature.selector);
        arena.openRoundWithSig(tampered, sig);

        OpenRoundIntent memory wrongKey = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        wrongKey.nonce = (uint256(1) << 64) | 0; // the withdraw key
        bytes memory wrongKeySig = _signOpen(aliceKey, wrongKey);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice, 0));
        arena.openRoundWithSig(wrongKey, wrongKeySig);

        vm.warp(uint256(i.deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.IntentExpired.selector, i.deadline));
        arena.openRoundWithSig(i, sig);
    }

    function test_openWithSig_erc1271Wallet() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(bob);
        _mint(bob, 100e18);
        vm.startPrank(bob);
        token.approve(address(arena), 100e18);
        arena.depositFor(address(wallet), 100e18);
        vm.stopPrank();
        OpenRoundIntent memory i = _openIntent(address(wallet), BNB, CRUISE, Direction.Long, STAKE);
        uint256 id = arena.openRoundWithSig(i, _signOpen(bobKey, i));
        assertEq(_round(id).player, address(wallet));

        OpenRoundIntent memory k = _openIntent(address(wallet), ETH, CRUISE, Direction.Long, STAKE);
        bytes memory aliceSig = _signOpen(aliceKey, k);
        vm.expectRevert(IBnbPlayArena.InvalidSignature.selector);
        arena.openRoundWithSig(k, aliceSig); // not the wallet owner
    }

    /// @dev An EIP-7702 account has code (the delegation designator) whose delegate does not implement ERC-1271;
    /// the Arena still accepts the EOA key's signature because ECDSA is tried first.
    function test_openWithSig_eip7702Account() public {
        Plain7702Delegate delegate = new Plain7702Delegate();
        vm.signAndAttachDelegation(address(delegate), aliceKey);
        assertGt(alice.code.length, 0);
        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        uint256 id = arena.openRoundWithSig(i, _signOpen(aliceKey, i));
        assertEq(_round(id).player, alice);
    }

    // ── cash-out ────────────────────────────────────────────────────────────────

    function test_cashOut_guards() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotRoundPlayer.selector, id, bob));
        arena.requestCashOut(id);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.RoundNotOpen.selector, 99));
        arena.requestCashOut(99);

        // Before the entry second the exit is entrySec + 1.
        vm.prank(alice);
        assertEq(arena.requestCashOut(id), r.entrySec + 1);
        assertTrue(_round(id).cashOutRequested);
        assertEq(_round(id).endSec, r.entrySec + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.CashOutAlreadyRequested.selector, id));
        arena.requestCashOut(id);
    }

    function test_cashOut_tooLateAndExitKnown() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);
        vm.warp(r.endSec - 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.CashOutTooLate.selector, id, r.endSec, r.endSec));
        arena.requestCashOut(id);

        vm.warp(r.entrySec + 5);
        _record(PAIR_BNB, r.entrySec + 7, P0_BNB); // the would-be exit second is already known
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.ExitNotInFuture.selector, r.entrySec + 7, r.entrySec + 7));
        arena.requestCashOut(id);
        vm.warp(r.entrySec + 6);
        vm.prank(alice);
        assertEq(arena.requestCashOut(id), r.entrySec + 8);
    }

    function test_cashOutWithSig() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        CashOutIntent memory c =
            CashOutIntent({player: alice, roundId: id, deadline: uint48(vm.getBlockTimestamp() + 3)});
        bytes memory bobSig = _signCashOut(bobKey, c);
        vm.expectRevert(IBnbPlayArena.InvalidSignature.selector);
        arena.requestCashOutWithSig(c, bobSig);
        CashOutIntent memory forBob = CashOutIntent({player: bob, roundId: id, deadline: c.deadline});
        bytes memory forBobSig = _signCashOut(bobKey, forBob);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotRoundPlayer.selector, id, bob));
        arena.requestCashOutWithSig(forBob, forBobSig);
        bytes memory sig = _signCashOut(aliceKey, c);
        vm.warp(uint256(c.deadline) + 1);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.IntentExpired.selector, c.deadline));
        arena.requestCashOutWithSig(c, sig);
        vm.warp(c.deadline);
        vm.prank(relayer);
        uint40 exitSec = arena.requestCashOutWithSig(c, sig);
        assertEq(exitSec, c.deadline + 2);
        vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.CashOutAlreadyRequested.selector, id));
        arena.requestCashOutWithSig(c, sig); // replay is harmless
    }

    // ── pause matrix (invariant 8) ──────────────────────────────────────────────

    function test_pause_blocksOpensOnly() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        Round memory r = _round(id);
        OpenRoundIntent memory i = _openIntent(bob, BNB, CRUISE, Direction.Long, STAKE);
        i.deadline = uint48(vm.getBlockTimestamp() + 1_000);
        bytes memory sig = _signOpen(bobKey, i);

        vm.prank(ops); // PAUSER_ROLE per config
        arena.pause();

        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.openRound(BNB, CRUISE, Direction.Long, STAKE, 1, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        arena.openRoundWithSig(i, sig);

        vm.warp(r.entrySec + 3);
        vm.prank(alice);
        arena.requestCashOut(id); // cash-out works
        uint256[] memory prices = _flat(P0_BNB, 6);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        _recordPath(PAIR_BNB, r.entrySec, prices); // record works
        arena.settleMany(ids); // settle works
        assertEq(uint8(_round(id).outcome), uint8(Outcome.CashedOut));

        vm.startPrank(alice);
        arena.withdraw(alice, 1e18); // withdraw works
        token.approve(address(arena), 1e18);
        arena.deposit(1e18); // deposit works
        vm.stopPrank();

        vm.prank(ops);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, ops, bytes32(0))
        );
        arena.unpause(); // pauser cannot unpause
        vm.prank(deployer);
        arena.unpause();
        arena.openRoundWithSig(i, sig);
    }

    function test_voidStale_worksWhilePaused() public {
        uint256 id = _open(alice, BNB, CRUISE, Direction.Long, STAKE);
        vm.prank(ops);
        arena.pause();
        vm.warp(uint256(_round(id).endSec) + 61);
        arena.voidStale(id);
        assertEq(uint8(_round(id).outcome), uint8(Outcome.Voided));
    }

    // ── withdraw with signature ─────────────────────────────────────────────────

    function test_withdrawWithSig() public {
        WithdrawIntent memory w = WithdrawIntent({
            player: alice,
            to: carol,
            amount: 100e18,
            nonce: arena.nonces(alice, 1),
            deadline: uint48(vm.getBlockTimestamp() + 60)
        });
        assertEq(w.nonce, uint256(1) << 64);
        bytes memory sig = _signWithdraw(aliceKey, w);
        vm.prank(relayer);
        arena.withdrawWithSig(w, sig);
        assertEq(token.balanceOf(carol), 100e18);
        assertEq(arena.balanceOf(alice), 900e18);
        assertEq(arena.nonces(alice, 1), (uint256(1) << 64) | 1);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice, (uint256(1) << 64) | 1));
        arena.withdrawWithSig(w, sig);

        // A direct withdraw consumes key 1 and cancels the next pending intent.
        WithdrawIntent memory w2 = w;
        w2.nonce = arena.nonces(alice, 1);
        bytes memory sig2 = _signWithdraw(aliceKey, w2);
        vm.prank(alice);
        arena.withdraw(alice, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice, (uint256(1) << 64) | 2));
        arena.withdrawWithSig(w2, sig2);
        assertEq(arena.nonces(alice, 0), 0, "open nonce untouched");
    }
}
