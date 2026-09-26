// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {SignedPriceVerifier} from "../../src/oracle/SignedPriceVerifier.sol";
import {StatelessSupraVerifier} from "../../src/oracle/StatelessSupraVerifier.sol";
import {ISupraSValueFeedVerifier} from "../../src/oracle/interfaces/ISupraSValueFeedVerifier.sol";
import {TestUSD} from "../../src/token/TestUSD.sol";
import {TestUSDFaucet} from "../../src/token/TestUSDFaucet.sol";
import {Lane, LaneParams, TuneBounds} from "../../src/types/ArenaTypes.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @notice Deployment and configuration steps shared by script/Deploy.s.sol, script/ConfigureLanes.s.sol and the
/// test base (so tests exercise the exact production wiring). Every call is made by the caller's context: the
/// broadcasting deployer in scripts, the pranked admin in tests.
library ArenaSetup {
    struct Deployed {
        TestUSD token;
        BnbPlayArena arena;
        StatelessSupraVerifier supraVerifier;
        CheckpointOracle oracle;
        SignedPriceVerifier signedVerifier;
        CheckpointOracle signedOracle;
        TestUSDFaucet faucet;
    }

    /// @dev Deploys every contract with `deployer` as initial admin. The Supra committee verifier is a parameter so
    /// tests can substitute a mock.
    function deploy(DeployConfig.Config memory c, address deployer, ISupraSValueFeedVerifier committeeVerifier)
        internal
        returns (Deployed memory d)
    {
        d.token = new TestUSD(deployer);
        d.arena = new BnbPlayArena(d.token, deployer);
        d.supraVerifier = new StatelessSupraVerifier(committeeVerifier, c.pairs);
        d.oracle = new CheckpointOracle(d.supraVerifier);
        if (c.deploySignedBackup) {
            d.signedVerifier = new SignedPriceVerifier(deployer, c.priceSigners, c.pairs);
            d.signedOracle = new CheckpointOracle(d.signedVerifier);
        }
        d.faucet = new TestUSDFaucet(d.token, d.arena, deployer, c.dripAmount, c.cooldownSec, c.maxPerAddress);
    }

    /// @dev Wires oracles, limits, assets, lanes and roles. Oracle idx 0 = stateless Supra (active), idx 1 = signed
    /// backup (registered, inactive). Hands DEFAULT_ADMIN over to `c.admin` last if it differs from `deployer`.
    function configure(Deployed memory d, DeployConfig.Config memory c, address deployer) internal {
        BnbPlayArena arena = d.arena;
        arena.grantRole(arena.CONFIG_ROLE(), deployer);
        arena.addOracle(d.oracle);
        if (address(d.signedOracle) != address(0)) arena.addOracle(d.signedOracle);
        arena.setActiveOracle(0);
        arena.setLimits(c.maxUtilizationBps, c.maxPayoutPerRound);
        applyLanes(arena, c);

        d.token.grantRole(d.token.MINTER_ROLE(), address(d.faucet));
        for (uint256 i; i < c.faucetOperators.length; ++i) {
            d.faucet.grantRole(d.faucet.OPERATOR_ROLE(), c.faucetOperators[i]);
        }
        for (uint256 i; i < c.configRole.length; ++i) {
            arena.grantRole(arena.CONFIG_ROLE(), c.configRole[i]);
        }
        for (uint256 i; i < c.laneTuners.length; ++i) {
            arena.grantRole(arena.LANE_TUNER_ROLE(), c.laneTuners[i]);
        }
        for (uint256 i; i < c.pauserRole.length; ++i) {
            arena.grantRole(arena.PAUSER_ROLE(), c.pauserRole[i]);
        }
        for (uint256 i; i < c.treasuryRole.length; ++i) {
            arena.grantRole(arena.TREASURY_ROLE(), c.treasuryRole[i]);
        }
        if (!_contains(c.configRole, deployer)) arena.renounceRole(arena.CONFIG_ROLE(), deployer);

        if (c.admin != deployer) {
            bytes32 adminRole = arena.DEFAULT_ADMIN_ROLE();
            arena.grantRole(adminRole, c.admin);
            d.token.grantRole(adminRole, c.admin);
            d.faucet.grantRole(adminRole, c.admin);
            arena.renounceRole(adminRole, deployer);
            d.token.renounceRole(adminRole, deployer);
            d.faucet.renounceRole(adminRole, deployer);
            if (address(d.signedVerifier) != address(0)) {
                d.signedVerifier.grantRole(adminRole, c.admin);
                d.signedVerifier.grantRole(d.signedVerifier.SIGNER_ADMIN_ROLE(), c.admin);
                d.signedVerifier.renounceRole(d.signedVerifier.SIGNER_ADMIN_ROLE(), deployer);
                d.signedVerifier.renounceRole(adminRole, deployer);
            }
        }
    }

    /// @dev Idempotent: `setAsset` only when the asset differs and `setLane` only when the lane differs, so lane
    /// versions (which clients sign) are bumped only by real changes. Assets go first so the guard sees the new gap
    /// (and `setAsset` itself bumps the asset's lane versions). Tune bounds are derived from each base lane.
    function applyLanes(BnbPlayArena arena, DeployConfig.Config memory c) internal returns (uint256 changed) {
        for (uint256 i; i < c.assets.length; ++i) {
            DeployConfig.AssetEntry memory a = c.assets[i];
            if (keccak256(abi.encode(arena.getAsset(a.assetId))) != keccak256(abi.encode(a.config))) {
                arena.setAsset(a.assetId, a.config);
                ++changed;
            }
            for (uint256 j; j < a.lanes.length; ++j) {
                DeployConfig.LaneEntry memory l = a.lanes[j];
                Lane memory current = arena.getLane(a.assetId, l.tier);
                if (current.version == 0 || keccak256(abi.encode(current.p)) != keccak256(abi.encode(l.params))) {
                    arena.setLane(a.assetId, l.tier, l.params);
                    ++changed;
                }
                TuneBounds memory b = tuneBounds(l.params, c.tuneMinScalePct, c.tuneMaxScalePct);
                if (keccak256(abi.encode(arena.getLaneTuneBounds(a.assetId, l.tier))) != keccak256(abi.encode(b))) {
                    arena.setLaneTuneBounds(
                        a.assetId, l.tier, b.minTargetPpm, b.maxTargetPpm, b.minStopPpm, b.maxStopPpm
                    );
                }
            }
        }
    }

    /// @dev [ceil(base·min/100), floor(base·max/100)] clamped to the barrier range [10, 100000] ppm.
    function tuneBounds(LaneParams memory p, uint256 minPct, uint256 maxPct) internal pure returns (TuneBounds memory b) {
        b.minTargetPpm = uint32(_clamp((uint256(p.targetPpm) * minPct + 99) / 100));
        b.maxTargetPpm = uint32(_clamp((uint256(p.targetPpm) * maxPct) / 100));
        b.minStopPpm = uint32(_clamp((uint256(p.stopPpm) * minPct + 99) / 100));
        b.maxStopPpm = uint32(_clamp((uint256(p.stopPpm) * maxPct) / 100));
    }

    function _clamp(uint256 v) private pure returns (uint256) {
        return v < 10 ? 10 : v > 100_000 ? 100_000 : v;
    }

    function _contains(address[] memory xs, address x) private pure returns (bool) {
        for (uint256 i; i < xs.length; ++i) {
            if (xs[i] == x) return true;
        }
        return false;
    }
}
