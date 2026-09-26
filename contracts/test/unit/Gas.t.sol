// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Test.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {CashOutIntent, Direction, OpenRoundIntent, Outcome, Round} from "../../src/types/ArenaTypes.sol";
import {ArenaTestBase} from "../utils/ArenaTestBase.sol";
import {SupraProofBuilder} from "../utils/SupraProofBuilder.sol";

/// @notice Execution gas (excluding the 21k intrinsic and calldata) of the hot paths, with the mock committee
/// verifier (no BLS). The fork suite reports the same paths with the real BLS verifier (+~183k per proof).
/// Run: forge test --match-contract GasTest -vv   (or --gas-report)
contract GasTest is ArenaTestBase {
    uint128 internal constant STAKE = 10e18;

    function _proof5(uint40 sec, uint256 bnbPrice) internal returns (bytes memory) {
        uint128[5] memory px = [uint128(95_400e18), 2_850e18, 245e15, 182e18, uint128(bnbPrice)];
        return SupraProofBuilder.build(committee, 0, _feeds5(uint64(sec) * 1000, px), 0);
    }

    function test_gas_hotPaths() public {
        // warm the player's nonce and balance slots the way a returning player has them
        _open(bob, ETH, CRUISE, Direction.Long, STAKE);

        OpenRoundIntent memory i = _openIntent(alice, BNB, CRUISE, Direction.Long, STAKE);
        bytes memory sig = _signOpen(aliceKey, i);
        uint256 g = gasleft();
        uint256 id = arena.openRoundWithSig(i, sig);
        uint256 gOpen = g - gasleft();

        Round memory r = _round(id);
        bytes[] memory proofs = new bytes[](21);
        for (uint256 k; k < 21; ++k) {
            proofs[k] = _proof5(r.entrySec + uint40(k), P0_BNB + k * 1e15);
        }

        vm.warp(r.entrySec + 5);
        uint256 gRecord;
        for (uint256 k; k < 4; ++k) {
            bytes memory p = proofs[k];
            g = gasleft();
            oracle.record(p);
            gRecord = g - gasleft();
        }

        CashOutIntent memory c = CashOutIntent({player: alice, roundId: id, deadline: uint48(r.entrySec + 30)});
        vm.warp(r.entrySec + 18);
        bytes memory csig = _signCashOut(aliceKey, c);
        g = gasleft();
        arena.requestCashOutWithSig(c, csig);
        uint256 gCashOut = g - gasleft();
        assertEq(_round(id).endSec, r.entrySec + 20);

        vm.warp(r.entrySec + 20);
        for (uint256 k = 4; k < 20; ++k) {
            oracle.record(proofs[k]);
        }
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        bytes memory lastProof = proofs[20];
        vm.warp(r.entrySec + 21);
        g = gasleft();
        arena.recordAndSettle(0, lastProof, ids);
        uint256 gRecordSettle = g - gasleft();
        assertEq(uint8(_round(id).outcome), uint8(Outcome.CashedOut));

        // settle alone over a full 21-second path (every checkpoint already recorded)
        uint256 id2 = _open(carol, BNB, CRUISE, Direction.Short, STAKE);
        Round memory r2 = _round(id2);
        vm.warp(r2.entrySec + 18);
        vm.prank(carol);
        arena.requestCashOut(id2);
        vm.warp(r2.entrySec + 21);
        for (uint256 k; k < 21; ++k) {
            oracle.record(_proof5(r2.entrySec + uint40(k), P0_BNB - k * 1e15));
        }
        g = gasleft();
        arena.settle(id2);
        uint256 gSettle = g - gasleft();

        console.log("openRoundWithSig            ", gOpen);
        console.log("requestCashOutWithSig       ", gCashOut);
        console.log("record (5 pairs, mock BLS)  ", gRecord);
        console.log("recordAndSettle (21 s path) ", gRecordSettle);
        console.log("settle (21 s path)          ", gSettle);
        assertLt(gOpen, 200_000);
        assertLt(gCashOut, 40_000);
        assertLt(gSettle, 150_000);
    }
}
