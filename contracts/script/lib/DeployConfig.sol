// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {AssetConfig, LaneParams} from "../../src/types/ArenaTypes.sol";

/// @notice Parses contracts/config/<chainId>.json (used by the deploy scripts and by the tests, so the tests run
/// against the exact production lane table). Big numbers are decimal strings.
library DeployConfig {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct LaneEntry {
        uint8 tier;
        LaneParams params;
    }

    struct AssetEntry {
        uint8 assetId;
        AssetConfig config;
        LaneEntry[] lanes;
    }

    struct Config {
        uint256 chainId;
        address supraPull;
        address supraStorage;
        address supraCommitteeVerifier;
        uint32[] pairs;
        uint256 entryDelaySec;
        uint256 exitDelaySec;
        uint256 stallAfterSec;
        uint16 maxUtilizationBps;
        uint128 maxPayoutPerRound;
        uint256 houseSeed;
        uint128 dripAmount;
        uint64 cooldownSec;
        uint256 maxPerAddress;
        address deployer;
        address relayer;
        address recorder;
        address ops;
        address admin;
        address[] configRole;
        address[] pauserRole;
        address[] treasuryRole;
        address[] faucetOperators;
        address[] priceSigners;
        bool deploySignedBackup;
        AssetEntry[] assets;
    }

    function path(uint256 chainId) internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/config/", vm.toString(chainId), ".json");
    }

    function load(string memory file) internal view returns (Config memory c) {
        string memory json = vm.readFile(file);
        c.chainId = vm.parseJsonUint(json, ".chainId");
        c.supraPull = vm.parseJsonAddress(json, ".supra.pull");
        c.supraStorage = vm.parseJsonAddress(json, ".supra.storage");
        c.supraCommitteeVerifier = vm.parseJsonAddress(json, ".supra.committeeVerifier");
        uint256[] memory pairs = vm.parseJsonUintArray(json, ".supra.pairs");
        c.pairs = new uint32[](pairs.length);
        for (uint256 i; i < pairs.length; ++i) {
            c.pairs[i] = uint32(pairs[i]);
        }
        c.entryDelaySec = vm.parseJsonUint(json, ".delays.entryDelaySec");
        c.exitDelaySec = vm.parseJsonUint(json, ".delays.exitDelaySec");
        c.stallAfterSec = vm.parseJsonUint(json, ".delays.stallAfterSec");
        c.maxUtilizationBps = uint16(vm.parseJsonUint(json, ".limits.maxUtilizationBps"));
        c.maxPayoutPerRound = uint128(vm.parseJsonUint(json, ".limits.maxPayoutPerRound"));
        c.houseSeed = vm.parseJsonUint(json, ".house.seed");
        c.dripAmount = uint128(vm.parseJsonUint(json, ".faucet.dripAmount"));
        c.cooldownSec = uint64(vm.parseJsonUint(json, ".faucet.cooldownSec"));
        c.maxPerAddress = vm.parseJsonUint(json, ".faucet.maxPerAddress");
        c.deployer = vm.parseJsonAddress(json, ".addresses.deployer");
        c.relayer = vm.parseJsonAddress(json, ".addresses.relayer");
        c.recorder = vm.parseJsonAddress(json, ".addresses.recorder");
        c.ops = vm.parseJsonAddress(json, ".addresses.ops");
        c.admin = vm.parseJsonAddress(json, ".roles.admin");
        c.configRole = vm.parseJsonAddressArray(json, ".roles.config");
        c.pauserRole = vm.parseJsonAddressArray(json, ".roles.pauser");
        c.treasuryRole = vm.parseJsonAddressArray(json, ".roles.treasury");
        c.faucetOperators = vm.parseJsonAddressArray(json, ".roles.faucetOperator");
        c.priceSigners = vm.parseJsonAddressArray(json, ".roles.priceSigners");
        c.deploySignedBackup = vm.parseJsonBool(json, ".signedBackup.deploy");

        uint256 n = _count(json, ".assets");
        c.assets = new AssetEntry[](n);
        for (uint256 i; i < n; ++i) {
            c.assets[i] = _asset(json, string.concat(".assets[", vm.toString(i), "]"));
        }
    }

    function _asset(string memory json, string memory key) private view returns (AssetEntry memory a) {
        a.assetId = uint8(vm.parseJsonUint(json, string.concat(key, ".assetId")));
        a.config = AssetConfig({
            pairId: uint32(vm.parseJsonUint(json, string.concat(key, ".pairId"))),
            maxJumpPpm: uint32(vm.parseJsonUint(json, string.concat(key, ".maxJumpPpm"))),
            gapMarginPpm: uint32(vm.parseJsonUint(json, string.concat(key, ".gapMarginPpm"))),
            enabled: vm.parseJsonBool(json, string.concat(key, ".enabled"))
        });
        string memory lanesKey = string.concat(key, ".lanes");
        uint256 n = _count(json, lanesKey);
        a.lanes = new LaneEntry[](n);
        for (uint256 i; i < n; ++i) {
            a.lanes[i] = _lane(json, string.concat(lanesKey, "[", vm.toString(i), "]"));
        }
    }

    function _lane(string memory json, string memory key) private pure returns (LaneEntry memory l) {
        l.tier = uint8(vm.parseJsonUint(json, string.concat(key, ".tier")));
        l.params = LaneParams({
            targetPpm: uint32(vm.parseJsonUint(json, string.concat(key, ".targetPpm"))),
            stopPpm: uint32(vm.parseJsonUint(json, string.concat(key, ".stopPpm"))),
            multiplierBps: uint32(vm.parseJsonUint(json, string.concat(key, ".multiplierBps"))),
            feeBps: uint16(vm.parseJsonUint(json, string.concat(key, ".feeBps"))),
            durationSec: uint16(vm.parseJsonUint(json, string.concat(key, ".durationSec"))),
            enabled: vm.parseJsonBool(json, string.concat(key, ".enabled")),
            minStake: uint128(vm.parseJsonUint(json, string.concat(key, ".minStake"))),
            maxStake: uint128(vm.parseJsonUint(json, string.concat(key, ".maxStake")))
        });
    }

    function _count(string memory json, string memory arrayKey) private view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(arrayKey, "[", vm.toString(n), "]"))) {
            ++n;
        }
    }
}
