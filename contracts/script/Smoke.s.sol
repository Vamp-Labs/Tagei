// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {BnbPlayArena} from "../src/BnbPlayArena.sol";
import {ICheckpointOracle} from "../src/oracle/interfaces/ICheckpointOracle.sol";
import {TestUSD} from "../src/token/TestUSD.sol";
import {TestUSDFaucet} from "../src/token/TestUSDFaucet.sol";
import {Direction, Outcome, Round, RoundStatus} from "../src/types/ArenaTypes.sol";
import {Deployments} from "./lib/Deployments.sol";

/// @notice Smoke test: faucet → open → cash-out → record ×21 → settle, as separate steps because each step needs the
/// chain clock at a different second (`SMOKE_STEP` = open | cashout | settle). The broadcaster is the player.
///   open     drip from the faucet (or mint + deposit) and open BNB CRUISE LONG 10 tUSD
///   cashout  request a cash-out (exit = max(now + 2, entry + 1))
///   settle   record every proof of `SMOKE_PROOFS` (fixture format; default the A1 fixture) whose round lies in
///            [entrySec, endSec], in order, then settle and check the ledger
/// script/smoke-fork.sh runs the three steps on a local anvil fork of chain 97 with the fixture proofs. On testnet,
/// capture the round's seconds live (research/scripts/capture-fixture.mjs or the A3 recorder archive) and point
/// SMOKE_PROOFS at them; stateless verification accepts late records.
contract Smoke is Script {
    function run() external {
        Deployments.Addresses memory a = Deployments.read();
        BnbPlayArena arena = BnbPlayArena(a.arena);
        string memory step = vm.envOr("SMOKE_STEP", string("open"));
        vm.startBroadcast();
        (, address player,) = vm.readCallers();
        if (_eq(step, "open")) _open(arena, TestUSD(a.testUsd), TestUSDFaucet(a.faucet), player);
        else if (_eq(step, "cashout")) _cashOut(arena, player);
        else if (_eq(step, "settle")) _recordAndSettle(arena, player);
        else revert("SMOKE_STEP must be open | cashout | settle");
        vm.stopBroadcast();
    }

    function _open(BnbPlayArena arena, TestUSD token, TestUSDFaucet faucet, address player) internal {
        require(arena.activeRoundOf(player) == 0, "player already has an open round");
        if (arena.balanceOf(player) < 10e18) {
            if (faucet.hasRole(faucet.OPERATOR_ROLE(), player) && faucet.nextDripAt(player) <= block.timestamp) {
                faucet.drip(player);
            } else {
                token.mint(player, 100e18);
                token.approve(address(arena), 100e18);
                arena.deposit(100e18);
            }
        }
        uint256 id = arena.openRound(0, 0, Direction.Long, 10e18, arena.getLane(0, 0).version, arena.activeOracleIdx());
        console.log("opened round", id);
    }

    function _cashOut(BnbPlayArena arena, address player) internal {
        uint256 id = arena.activeRoundOf(player);
        require(id != 0, "no open round");
        uint40 exitSec = arena.requestCashOut(id);
        console.log("cash-out requested, exitSec", exitSec);
    }

    function _recordAndSettle(BnbPlayArena arena, address player) internal {
        uint256 id = arena.activeRoundOf(player);
        require(id != 0, "no open round");
        Round memory r = arena.getRound(id);
        ICheckpointOracle oracle = arena.oracles(r.oracleIdx);
        string memory file = vm.envOr(
            "SMOKE_PROOFS", string.concat(vm.projectRoot(), "/../research/fixtures/supra-97-1790414769.json")
        );
        string memory json = vm.readFile(file);
        console.log("round", id, "entrySec", r.entrySec);
        console.log("endSec", r.endSec, "now", block.timestamp);
        uint256 recorded;
        for (uint256 i; vm.keyExistsJson(json, string.concat(".proofs[", vm.toString(i), "]")); ++i) {
            string memory key = string.concat(".proofs[", vm.toString(i), "]");
            uint40 sec = uint40(vm.parseJsonUint(json, string.concat(key, ".round")) / 1000);
            if (sec < r.entrySec || sec > r.endSec) continue;
            if (oracle.get(r.pairId, sec).flags & 1 != 0) continue;
            oracle.record(vm.parseJsonBytes(json, string.concat(key, ".proof")));
            ++recorded;
        }
        console.log("checkpoints recorded", recorded);
        (bool decidable,,,, uint40 missingSec) = arena.previewSettle(id);
        if (!decidable) {
            console.log("missing second", missingSec);
            revert("round not decidable: a checkpoint is missing");
        }
        uint256 before = arena.balanceOf(player);
        (Outcome o, uint256 payout) = arena.settle(id);
        Round memory s = arena.getRound(id);
        require(s.status == RoundStatus.Settled, "not settled");
        require(arena.balanceOf(player) == before + payout, "payout not credited");
        require(
            TestUSD(address(arena.token())).balanceOf(address(arena))
                == arena.totalPlayerBalances() + arena.houseFree() + arena.houseReserved() + arena.stakesLocked()
                    + arena.surplus(),
            "ledger conservation"
        );
        console.log("settled round", id);
        console.log("outcome", uint8(o), "payout", payout);
        console.log("decisionSec", s.decisionSec, "entry..end", uint256(r.endSec - r.entrySec) + 1);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
