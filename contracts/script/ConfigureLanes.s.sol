// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {BnbPlayArena} from "../src/BnbPlayArena.sol";
import {ArenaSetup} from "./lib/ArenaSetup.sol";
import {DeployConfig} from "./lib/DeployConfig.sol";
import {Deployments} from "./lib/Deployments.sol";

/// @notice Re-applies assets and lanes from config/<chainId>.json to the deployed Arena. Idempotent: only assets and
/// lanes that differ are written, so lane versions (which clients sign) change only on real changes.
/// Needs CONFIG_ROLE: forge script script/ConfigureLanes.s.sol --rpc-url bsc_testnet --account <config key> --broadcast
contract ConfigureLanes is Script {
    function run() external returns (uint256 changed) {
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(block.chainid));
        BnbPlayArena arena = BnbPlayArena(Deployments.read().arena);
        vm.startBroadcast();
        changed = ArenaSetup.applyLanes(arena, c);
        vm.stopBroadcast();
        console.log("assets/lanes written:", changed);
    }
}
