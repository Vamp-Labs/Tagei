// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {StatelessSupraVerifier} from "../../src/oracle/StatelessSupraVerifier.sol";
import {SupraPriceVerifier} from "../../src/oracle/SupraPriceVerifier.sol";
import {ISupraOraclePull} from "../../src/oracle/interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../../src/oracle/interfaces/ISupraSValueFeed.sol";
import {ISupraSValueFeedVerifier} from "../../src/oracle/interfaces/ISupraSValueFeedVerifier.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {CashOutIntent, Direction, OpenRoundIntent, Outcome, Round} from "../../src/types/ArenaTypes.sol";
import {ArenaSetup} from "../../script/lib/ArenaSetup.sol";
import {DeployConfig} from "../../script/lib/DeployConfig.sol";

/// @notice Chain 97 fork at the fixture's `blockBeforeFirstProof` with the REAL Supra committee verifier (BLS on
/// BN254). Run with `forge test --fork-url $BSC_TESTNET_RPC_URL --match-path 'test/fork/*'` (archive RPC:
/// https://bsc-testnet-rpc.publicnode.com), or set BSC_TESTNET_RPC_URL for a plain `forge test`. Skipped otherwise.
contract SupraForkTest is Test {
    uint256 internal constant FORK_BLOCK = 133_261_858;
    uint256 internal constant N = 23;
    ISupraSValueFeedVerifier internal constant COMMITTEE =
        ISupraSValueFeedVerifier(0x8694E798112a9Df06d9Ccc772967A5AeCfb24320);
    ISupraOraclePull internal constant PULL = ISupraOraclePull(0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917);
    ISupraSValueFeed internal constant STORAGE = ISupraSValueFeed(0x004d42225631F6bec6503a281Ed4c233810CBC29);

    bool internal forked;
    bytes[N] internal proofs;
    uint256[N] internal rounds;
    uint256[N] internal bnb; // pair 49 is the 5th feed
    uint256[N] internal btc; // pair 0 is the 1st feed

    StatelessSupraVerifier internal verifier;
    CheckpointOracle internal oracle;

    function setUp() public {
        string memory url = vm.envOr("BSC_TESTNET_RPC_URL", string(""));
        if (block.chainid == 97) {
            vm.rollFork(FORK_BLOCK);
            forked = true;
        } else if (bytes(url).length != 0) {
            vm.createSelectFork(url, FORK_BLOCK);
            forked = true;
        }
        if (!forked) return;
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../research/fixtures/supra-97-1790414769.json"));
        assertEq(vm.parseJsonUint(json, ".blockBeforeFirstProof.number"), FORK_BLOCK);
        for (uint256 i; i < N; ++i) {
            string memory key = string.concat(".proofs[", vm.toString(i), "]");
            proofs[i] = vm.parseJsonBytes(json, string.concat(key, ".proof"));
            rounds[i] = vm.parseJsonUint(json, string.concat(key, ".round"));
            bnb[i] = vm.parseJsonUint(json, string.concat(key, ".committees[0].feeds[4].price"));
            btc[i] = vm.parseJsonUint(json, string.concat(key, ".committees[0].feeds[0].price"));
        }
        uint32[] memory pairs = new uint32[](5);
        (pairs[0], pairs[1], pairs[2], pairs[3], pairs[4]) = (0, 1, 3, 10, 49);
        verifier = new StatelessSupraVerifier(COMMITTEE, pairs);
        oracle = new CheckpointOracle(verifier);
    }

    modifier onlyFork() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    function _sec(uint256 i) internal view returns (uint40) {
        return uint40(rounds[i] / 1000);
    }

    /// @notice The 23 consecutive real proofs, recorded in order through the real BLS verifier.
    function test_fork_recordAllFixtureProofs() public onlyFork {
        uint256 maxGas;
        uint256 sum;
        for (uint256 i; i < N; ++i) {
            vm.warp(_sec(i) + 1); // Supra's future bound: round <= now·1000 + 3000
            bytes memory proof = proofs[i]; // outside the measured window (test storage reads)
            uint256 g = gasleft();
            uint256 n = oracle.record(proof);
            g -= gasleft();
            assertEq(n, 5);
            sum += g;
            if (g > maxGas) maxGas = g;
            assertEq(oracle.get(49, _sec(i)).price18, bnb[i], "BNB price");
            assertEq(oracle.get(0, _sec(i)).price18, btc[i], "BTC price");
            if (i > 0) assertEq(rounds[i], rounds[i - 1] + 1000, "consecutive");
        }
        console.log("record (5 pairs, real BLS) execution gas: avg", sum / N, "max", maxGas);
        // breakdown on warm state: stateless verification alone, and the BLS call inside it
        SupraProofV2.OracleProofV2 memory p = abi.decode(proofs[N - 1], (SupraProofV2.OracleProofV2));
        uint256 g0 = gasleft();
        verifier.verify(proofs[N - 1]);
        uint256 gVerify = g0 - gasleft();
        g0 = gasleft();
        COMMITTEE.requireHashVerified_V2(p.data[0].root, p.data[0].sigs, p.data[0].committee_id);
        uint256 gBls = g0 - gasleft();
        console.log("verify (warm) execution gas", gVerify, "of which BLS", gBls);
        assertLt(sum / N, 400_000, "steady-state record");
        assertLt(maxGas, 550_000, "first (cold) record");
        assertEq(oracle.lastRecordedSec(49), _sec(N - 1));
    }

    /// @notice (a) Stateless: an OLDER proof recorded after newer ones stores its own historical price — even after
    /// Supra's storage already holds a newer round (where `verifyOracleProofV2` exhibits F1).
    function test_fork_statelessProvesHistory() public onlyFork {
        vm.warp(_sec(N - 1) + 1);
        PULL.verifyOracleProofV2(proofs[N - 1]); // someone pushes the newest round into Supra
        ISupraOraclePull.PriceInfo memory info = PULL.verifyOracleProofV2(proofs[0]);
        assertEq(info.round[4], rounds[N - 1], "F1: Supra answers with its stored newer round");

        for (uint256 i = 1; i < N; ++i) {
            oracle.record(proofs[i]);
        }
        assertEq(oracle.get(49, _sec(0)).flags, 0);
        assertEq(oracle.record(proofs[0]), 5, "backfill of the oldest second");
        assertEq(oracle.get(49, _sec(0)).price18, bnb[0], "its OWN historical price");
        assertFalse(oracle.isPermanentlyMissing(49, _sec(0)));
        assertEq(verifier.latestRoundMs(49), 0);
    }

    /// @notice (b) Stateful fallback: the F1 guard rejects the stored-newer value instead of recording it.
    function test_fork_statefulF1Guard() public onlyFork {
        uint32[] memory pairs = new uint32[](5);
        (pairs[0], pairs[1], pairs[2], pairs[3], pairs[4]) = (0, 1, 3, 10, 49);
        SupraPriceVerifier sv = new SupraPriceVerifier(PULL, STORAGE, pairs);
        CheckpointOracle so = new CheckpointOracle(sv);
        vm.warp(_sec(0) + 1);
        assertEq(so.record(proofs[0]), 5, "fresh proof");
        assertEq(so.get(49, _sec(0)).price18, bnb[0]);

        vm.warp(_sec(10) + 1);
        PULL.verifyOracleProofV2(proofs[10]); // a third party pushes a newer round
        assertEq(so.record(proofs[5]), 0, "F1 guard: stale proof records nothing");
        assertEq(so.get(49, _sec(5)).flags, 0);
        assertTrue(so.isPermanentlyMissing(49, _sec(5)));
        assertEq(so.latestKnownSec(49), _sec(10));
        assertEq(so.record(proofs[10]), 5, "same round as stored is accepted");
    }

    /// @notice Tampered data still fails against the real verifier.
    function test_fork_tamperedRejected() public onlyFork {
        vm.warp(_sec(0) + 1);
        SupraProofV2.OracleProofV2 memory p = abi.decode(proofs[0], (SupraProofV2.OracleProofV2));
        p.data[0].sigs[1] ^= 1;
        vm.expectRevert(); // BLSInvalidPublicKeyorSignaturePoints / BLSIncorrectInputMessaage
        oracle.record(abi.encode(p));
        p = abi.decode(proofs[0], (SupraProofV2.OracleProofV2));
        p.data[0].committee_data.committee_feed[4].price += 1;
        vm.expectRevert(abi.encodeWithSelector(StatelessSupraVerifier.RootMismatch.selector, 0));
        oracle.record(abi.encode(p));
    }

    /// @notice The production wiring end to end on the fork: open, cash-out, record 21 real seconds, settle.
    function test_fork_fullRoundWithRealProofs() public onlyFork {
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(97));
        address deployer = c.deployer;
        vm.startPrank(deployer);
        ArenaSetup.Deployed memory d = ArenaSetup.deploy(c, deployer, COMMITTEE);
        ArenaSetup.configure(d, c, deployer);
        d.token.mint(deployer, c.houseSeed);
        d.token.approve(address(d.arena), c.houseSeed);
        d.arena.fundHouse(c.houseSeed);
        vm.stopPrank();
        BnbPlayArena arena = d.arena;

        (address player, uint256 key) = makeAddrAndKey("fork-player");
        vm.prank(ops(c));
        d.faucet.drip(player);

        // Open so that entry = fixture round #1 (the fork clock is rewound to 2 s before it minus the delay).
        vm.warp(_sec(1) - 3);
        uint256 id;
        {
            uint256 g = gasleft();
            id = _openSigned(arena, player, key);
            console.log("openRoundWithSig execution gas", g - gasleft());
        }
        Round memory r = arena.getRound(id);
        assertEq(r.entrySec, _sec(1));
        vm.warp(r.entrySec + 18);
        {
            (bytes memory sig, uint48 deadline) = _signCashOut(arena, player, key, id);
            uint256 g = gasleft();
            arena.requestCashOutWithSig(_cashOutIntent(player, id, deadline), sig);
            console.log("requestCashOutWithSig execution gas", g - gasleft());
        }
        r = arena.getRound(id);
        assertEq(r.endSec, _sec(21));

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        for (uint256 i = 1; i <= 20; ++i) {
            vm.warp(_sec(i) + 1);
            arena.recordAndSettle(0, proofs[i], ids); // not decidable yet (no touch in this calm window)
        }
        vm.warp(_sec(21) + 1);
        bytes memory last = proofs[21];
        uint256 g2 = gasleft();
        arena.recordAndSettle(0, last, ids);
        console.log("recordAndSettle (5 pairs + 21 s path) execution gas", g2 - gasleft());
        r = arena.getRound(id);
        assertEq(uint8(r.outcome), uint8(Outcome.CashedOut));
        assertEq(r.decisionSec, _sec(21));
        assertLt(r.payout, r.stake, "BNB fell ~84 ppm: an unfavourable interior payout");
        assertGt(r.payout, 0);
        assertEq(arena.balanceOf(player), 100e18 - r.stake + r.payout);
    }

    function ops(DeployConfig.Config memory c) internal pure returns (address) {
        return c.ops;
    }

    function _openSigned(BnbPlayArena arena, address player, uint256 key) internal returns (uint256) {
        OpenRoundIntent memory i = OpenRoundIntent({
            player: player,
            assetId: 0,
            tier: 0,
            direction: Direction.Long,
            stake: 10e18,
            laneVersion: arena.getLane(0, 0).version,
            oracleIdx: 0,
            nonce: arena.nonces(player, 0),
            deadline: uint48(vm.getBlockTimestamp() + 5)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, arena.hashOpenRound(i));
        return arena.openRoundWithSig(i, abi.encodePacked(r, s, v));
    }

    function _cashOutIntent(address player, uint256 id, uint48 deadline) internal pure returns (CashOutIntent memory) {
        return CashOutIntent(player, id, deadline);
    }

    function _signCashOut(BnbPlayArena arena, address player, uint256 key, uint256 id)
        internal
        view
        returns (bytes memory sig, uint48 deadline)
    {
        deadline = uint48(vm.getBlockTimestamp() + 3);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, arena.hashCashOut(_cashOutIntent(player, id, deadline)));
        sig = abi.encodePacked(r, s, v);
    }
}
