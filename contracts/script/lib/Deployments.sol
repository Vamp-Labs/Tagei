// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {ArenaSetup} from "./ArenaSetup.sol";

/// @notice Reads and writes deployments/<chainId>.json in the shape of `Deployment` in
/// packages/shared/src/chain.ts. `DEPLOYMENTS_OUT` overrides the path (local forks use deployments/local-*.json).
library Deployments {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Addresses {
        address arena;
        address checkpointOracle;
        address supraPriceVerifier;
        address signedPriceVerifier;
        address signedCheckpointOracle;
        address testUsd;
        address faucet;
    }

    function path() internal view returns (string memory) {
        string memory def = string.concat("deployments/", vm.toString(block.chainid), ".json");
        return string.concat(vm.projectRoot(), "/", vm.envOr("DEPLOYMENTS_OUT", def));
    }

    function write(ArenaSetup.Deployed memory d, uint256 startBlock) internal {
        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", startBlock);
        vm.serializeString(o, "commit", vm.envOr("GIT_COMMIT", string("unknown")));
        vm.serializeAddress(o, "arena", address(d.arena));
        vm.serializeAddress(o, "checkpointOracle", address(d.oracle));
        vm.serializeAddress(o, "supraPriceVerifier", address(d.supraVerifier));
        if (address(d.signedVerifier) != address(0)) {
            vm.serializeAddress(o, "signedPriceVerifier", address(d.signedVerifier));
            vm.serializeAddress(o, "signedCheckpointOracle", address(d.signedOracle));
        }
        vm.serializeAddress(o, "testUsd", address(d.token));
        string memory json = vm.serializeAddress(o, "faucet", address(d.faucet));
        vm.writeJson(json, path());
    }

    function read() internal view returns (Addresses memory a) {
        string memory json = vm.readFile(path());
        a.arena = vm.parseJsonAddress(json, ".arena");
        a.checkpointOracle = vm.parseJsonAddress(json, ".checkpointOracle");
        a.supraPriceVerifier = vm.parseJsonAddress(json, ".supraPriceVerifier");
        a.testUsd = vm.parseJsonAddress(json, ".testUsd");
        a.faucet = vm.parseJsonAddress(json, ".faucet");
        if (vm.keyExistsJson(json, ".signedCheckpointOracle")) {
            a.signedPriceVerifier = vm.parseJsonAddress(json, ".signedPriceVerifier");
            a.signedCheckpointOracle = vm.parseJsonAddress(json, ".signedCheckpointOracle");
        }
    }
}
