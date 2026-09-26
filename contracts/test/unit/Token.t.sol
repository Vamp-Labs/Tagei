// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TestUSDFaucet} from "../../src/token/TestUSDFaucet.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";

/// @notice TestUSD (permit, minter role) and TestUSDFaucet (operator, cooldown, lifetime cap).
contract TokenTest is ArenaTestBase {
    address internal guest = makeAddr("guest");

    function test_faucet_dripCreditsArenaLedger() public {
        vm.prank(ops);
        vm.expectEmit(address(faucet));
        emit TestUSDFaucet.Dripped(guest, 100e18, 100e18);
        assertEq(faucet.drip(guest), 100e18);
        assertEq(arena.balanceOf(guest), 100e18);
        assertEq(token.balanceOf(guest), 0);
        assertEq(token.balanceOf(address(faucet)), 0);
        _assertLedger();
    }

    function test_faucet_cooldownAndCap() public {
        uint256 t = vm.getBlockTimestamp();
        vm.startPrank(ops);
        faucet.drip(guest);
        assertEq(faucet.nextDripAt(guest), t + 82_800);
        vm.expectRevert(abi.encodeWithSelector(TestUSDFaucet.CooldownActive.selector, guest, t + 82_800));
        faucet.drip(guest);
        for (uint256 i = 1; i < 20; ++i) {
            vm.warp(t + i * 82_800);
            faucet.drip(guest);
        }
        assertEq(arena.balanceOf(guest), 2_000e18);
        vm.warp(t + 20 * 82_800);
        vm.expectRevert(abi.encodeWithSelector(TestUSDFaucet.CapReached.selector, guest, 2_000e18, 2_000e18));
        faucet.drip(guest);
        vm.stopPrank();
        assertEq(faucet.nextDripAt(makeAddr("new")), 0);
    }

    function test_faucet_rolesAndParams() public {
        bytes32 operator = faucet.OPERATOR_ROLE();
        vm.prank(guest);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guest, operator));
        faucet.drip(guest);
        vm.prank(ops);
        vm.expectRevert(TestUSDFaucet.ZeroAddress.selector);
        faucet.drip(address(0));

        vm.startPrank(deployer);
        vm.expectRevert(TestUSDFaucet.InvalidParams.selector);
        faucet.setParams(0, 1, 1);
        vm.expectRevert(TestUSDFaucet.InvalidParams.selector);
        faucet.setParams(10, 1, 9);
        faucet.setParams(5e18, 60, 10e18);
        vm.stopPrank();
        vm.startPrank(ops);
        faucet.drip(guest);
        vm.warp(vm.getBlockTimestamp() + 60);
        faucet.drip(guest);
        vm.stopPrank();
        assertEq(arena.balanceOf(guest), 10e18);
    }

    function test_token_minterAndPermit() public {
        bytes32 minter = token.MINTER_ROLE();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, minter));
        token.mint(alice, 1);
        assertEq(token.decimals(), 18);
        assertEq(token.symbol(), "tUSD");

        _mint(alice, 50e18);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                address(arena),
                50e18,
                token.nonces(alice),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        vm.prank(bob); // anyone can submit the permit (gasless approval)
        token.permit(alice, address(arena), 50e18, deadline, v, r, s);
        assertEq(token.allowance(alice, address(arena)), 50e18);
        assertEq(token.nonces(alice), 1);
        vm.prank(alice);
        arena.deposit(50e18);
        assertEq(arena.balanceOf(alice), 1_050e18);
    }
}
