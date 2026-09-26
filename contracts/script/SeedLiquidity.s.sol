// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {BnbPlayArena} from "../src/BnbPlayArena.sol";
import {TestUSD} from "../src/token/TestUSD.sol";
import {DeployConfig} from "./lib/DeployConfig.sol";
import {Deployments} from "./lib/Deployments.sol";

/// @notice Tops the house up to `HOUSE_TARGET` (default: config house.seed) by minting tUSD to the broadcaster
/// (MINTER_ROLE) and calling `fundHouse`. No-op when houseFree + houseReserved already reaches the target.
contract SeedLiquidity is Script {
    function run() external returns (uint256 funded) {
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(block.chainid));
        Deployments.Addresses memory a = Deployments.read();
        BnbPlayArena arena = BnbPlayArena(a.arena);
        TestUSD token = TestUSD(a.testUsd);
        uint256 target = vm.envOr("HOUSE_TARGET", c.houseSeed);
        uint256 house = arena.houseFree() + arena.houseReserved();
        if (house >= target) {
            console.log("house already at", house);
            return 0;
        }
        funded = target - house;
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        token.mint(sender, funded);
        token.approve(address(arena), funded);
        arena.fundHouse(funded);
        vm.stopBroadcast();
        console.log("house funded by", funded);
    }
}
