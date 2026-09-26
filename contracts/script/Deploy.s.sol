// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ISupraSValueFeedVerifier} from "../src/oracle/interfaces/ISupraSValueFeedVerifier.sol";
import {ArenaSetup} from "./lib/ArenaSetup.sol";
import {DeployConfig} from "./lib/DeployConfig.sol";
import {Deployments} from "./lib/Deployments.sol";

/// @notice Deploys and configures BNB PLAY from config/<chainId>.json and writes deployments/<chainId>.json.
///
/// Testnet (A0 only):
///   GIT_COMMIT=$(git rev-parse HEAD) forge script script/Deploy.s.sol --rpc-url bsc_testnet \
///     --account bnbplay-deployer --broadcast --slow --legacy --with-gas-price 100000000 --verify
/// Local anvil fork (see script/smoke-fork.sh): LOCAL_ROLES=true DEPLOYMENTS_OUT=deployments/local-97.json
///   gives every role to the broadcaster so the smoke test can drive the faucet.
/// SEED_HOUSE=false skips minting/funding the house seed (use SeedLiquidity.s.sol later).
contract Deploy is Script {
    function run() external returns (ArenaSetup.Deployed memory d) {
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(block.chainid));
        require(c.chainId == block.chainid, "config chainId");
        require(c.entryDelaySec == 3 && c.exitDelaySec == 2 && c.stallAfterSec == 60, "delays differ from F1a v2");
        uint256 startBlock = block.number;

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        if (vm.envOr("LOCAL_ROLES", false)) _localRoles(c, deployer);
        d = ArenaSetup.deploy(c, deployer, ISupraSValueFeedVerifier(c.supraCommitteeVerifier));
        ArenaSetup.configure(d, c, deployer);
        if (vm.envOr("SEED_HOUSE", true) && c.houseSeed > 0) {
            d.token.mint(deployer, c.houseSeed);
            d.token.approve(address(d.arena), c.houseSeed);
            d.arena.fundHouse(c.houseSeed);
        }
        vm.stopBroadcast();

        require(d.arena.ENTRY_DELAY_SEC() == c.entryDelaySec, "entry delay");
        require(d.arena.STALL_AFTER_SEC() == c.stallAfterSec, "stall");
        Deployments.write(d, startBlock);
        console.log("arena", address(d.arena));
        console.log("checkpointOracle", address(d.oracle));
        console.log("statelessSupraVerifier", address(d.supraVerifier));
        console.log("testUsd", address(d.token));
        console.log("faucet", address(d.faucet));
        console.log("deployments written to", Deployments.path());
    }

    function _localRoles(DeployConfig.Config memory c, address deployer) internal pure {
        address[] memory me = new address[](1);
        me[0] = deployer;
        c.admin = deployer;
        c.configRole = me;
        c.pauserRole = me;
        c.treasuryRole = me;
        c.faucetOperators = me;
        c.priceSigners = me;
    }
}
