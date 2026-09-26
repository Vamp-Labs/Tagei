// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IBnbPlayArena} from "../../src/interfaces/IBnbPlayArena.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {Intents} from "../../src/libraries/Intents.sol";
import {LaneMath} from "../../src/libraries/LaneMath.sol";
import {TestUSD} from "../../src/token/TestUSD.sol";
import {
    AssetConfig,
    CashOutIntent,
    Direction,
    LaneParams,
    OpenRoundIntent,
    Outcome,
    Round,
    RoundStatus,
    VoidReason,
    WithdrawIntent
} from "../../src/types/ArenaTypes.sol";
import {MockCheckpointOracle} from "../mocks/MockCheckpointOracle.sol";
import {ArenaHarness} from "../utils/ArenaHarness.sol";

/// @notice Differential tests against the golden vectors generated from packages/shared (the TS reference).
/// Every case of lane-, path- and eip712-vectors.json is asserted field by field.
contract VectorsTest is Test {
    string internal constant VECTORS = "/../packages/shared/vectors/";
    uint32 internal constant PAIR = 99;
    uint8 internal constant ASSET = 5;

    // ── lane-vectors.json ────────────────────────────────────────────────────────

    struct LaneExpected {
        bool fav;
        uint256 mag;
        uint8 touch;
        uint256 maxPayout;
        uint256 interiorPayout;
    }

    struct LaneCase {
        uint8 direction;
        uint256 p0;
        uint256 p;
        uint256 targetPpm;
        uint256 stopPpm;
        uint256 multiplierBps;
        uint256 feeBps;
        uint256 stake;
        LaneExpected expected;
    }

    function _read(string memory file) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), VECTORS, file));
    }

    function test_laneVectors_allCases() public view {
        string memory json = _read("lane-vectors.json");
        LaneCase[] memory cs = abi.decode(
            vm.parseJsonTypeArray(
                json,
                ".cases",
                "LaneCase(uint8 direction,uint256 p0,uint256 p,uint256 targetPpm,uint256 stopPpm,uint256 multiplierBps,uint256 feeBps,uint256 stake,LaneExpected expected)LaneExpected(bool fav,uint256 mag,uint8 touch,uint256 maxPayout,uint256 interiorPayout)"
            ),
            (LaneCase[])
        );
        assertEq(cs.length, 600, "lane case count");
        for (uint256 i; i < cs.length; ++i) {
            LaneCase memory c = cs[i];
            (bool fav, uint256 mag) = LaneMath.directional(Direction(c.direction), c.p0, c.p);
            assertEq(fav, c.expected.fav, string.concat("fav #", vm.toString(i)));
            assertEq(mag, c.expected.mag, string.concat("mag #", vm.toString(i)));
            uint8 t = LaneMath.touch(fav, mag, c.p0, c.targetPpm, c.stopPpm);
            assertEq(t, c.expected.touch, string.concat("touch #", vm.toString(i)));
            assertEq(
                LaneMath.maxPayout(c.stake, c.multiplierBps),
                c.expected.maxPayout,
                string.concat("maxPayout #", vm.toString(i))
            );
            if (t == LaneMath.TOUCH_NONE) {
                assertEq(
                    LaneMath.interiorPayout(c.stake, fav, mag, c.p0, c.targetPpm, c.stopPpm, c.multiplierBps, c.feeBps),
                    c.expected.interiorPayout,
                    string.concat("interior #", vm.toString(i))
                );
            }
        }
    }

    // ── path-vectors.json ────────────────────────────────────────────────────────

    struct PathTerms {
        uint8 direction;
        uint256 stake;
        uint256 maxPayout;
        uint256 entrySec;
        uint256 endSec;
        uint256 targetPpm;
        uint256 stopPpm;
        uint256 multiplierBps;
        uint256 feeBps;
        uint256 maxJumpPpm;
        bool cashOutRequested;
    }

    struct PathExpected {
        bool decidable;
        uint8 outcome;
        uint256 payout;
        uint256 decisionSec;
        uint8 voidReason;
        uint256 missingSec;
    }

    struct PathCase {
        PathTerms t;
        bool[] present;
        uint256[] prices;
        bool[] disputed;
        uint256[] permanentlyMissing;
        uint256 nowSec;
        PathExpected e;
    }

    TestUSD internal token;
    ArenaHarness internal harness;
    MockCheckpointOracle internal mock;
    uint256 internal endToEnd;

    function _deployHarness() internal {
        token = new TestUSD(address(this));
        harness = new ArenaHarness(token, address(this));
        mock = new MockCheckpointOracle(true); // permanence comes only from the vector's per-second list
        harness.grantRole(harness.CONFIG_ROLE(), address(this));
        harness.addOracle(mock);
        harness.setLimits(10_000, type(uint128).max);
        token.mint(address(this), 1e30);
        token.approve(address(harness), type(uint256).max);
        harness.fundHouse(1e30);
    }

    function _loadCase(string memory json, uint256 i) internal view returns (PathCase memory c) {
        string memory key = string.concat(".cases[", vm.toString(i), "]");
        c.t = abi.decode(
            vm.parseJsonType(
                json,
                string.concat(key, ".terms"),
                "PathTerms(uint8 direction,uint256 stake,uint256 maxPayout,uint256 entrySec,uint256 endSec,uint256 targetPpm,uint256 stopPpm,uint256 multiplierBps,uint256 feeBps,uint256 maxJumpPpm,bool cashOutRequested)"
            ),
            (PathTerms)
        );
        c.e = abi.decode(
            vm.parseJsonType(
                json,
                string.concat(key, ".expected"),
                "PathExpected(bool decidable,uint8 outcome,uint256 payout,uint256 decisionSec,uint8 voidReason,uint256 missingSec)"
            ),
            (PathExpected)
        );
        c.nowSec = vm.parseJsonUint(json, string.concat(key, ".nowSec"));
        c.permanentlyMissing = vm.parseJsonUintArray(json, string.concat(key, ".permanentlyMissing"));

        uint256 n = c.t.endSec - c.t.entrySec + 1;
        c.present = new bool[](n);
        c.prices = new uint256[](n);
        c.disputed = new bool[](n);
        for (uint256 j; j < n; ++j) {
            (c.present[j], c.prices[j], c.disputed[j]) =
                _checkpointAt(json, string.concat(key, ".checkpoints[", vm.toString(j), "]"));
        }
    }

    struct CpNum {
        bool disputed;
        uint256 price18;
    }

    struct CpStr {
        bool disputed;
        string price18;
    }

    /// @dev One parse per checkpoint: `null` (never recorded) encodes as a single zero word.
    function _checkpointAt(string memory json, string memory key)
        internal
        pure
        returns (bool present, uint256 price, bool disputed)
    {
        bytes memory raw = vm.parseJson(json, key);
        if (raw.length == 32) return (false, 0, false);
        present = true;
        if (raw.length == 64) {
            CpNum memory o = abi.decode(raw, (CpNum));
            return (true, o.price18, o.disputed);
        }
        CpStr memory s = abi.decode(raw, (CpStr));
        return (true, vm.parseUint(s.price18), s.disputed);
    }

    function _populate(PathCase memory c) internal {
        for (uint256 j; j < c.present.length; ++j) {
            uint40 sec = uint40(c.t.entrySec + j);
            if (!c.present[j]) continue;
            mock.set(PAIR, sec, uint128(c.prices[j]));
            if (c.disputed[j]) mock.setDisputed(PAIR, sec);
        }
        for (uint256 j; j < c.permanentlyMissing.length; ++j) {
            mock.setForcedMissing(PAIR, uint40(c.permanentlyMissing[j]), true);
        }
    }

    function _roundOf(PathCase memory c) internal pure returns (Round memory r) {
        r.player = address(0xBEEF);
        r.direction = Direction(c.t.direction);
        r.status = RoundStatus.Open;
        r.cashOutRequested = c.t.cashOutRequested;
        r.entrySec = uint40(c.t.entrySec);
        r.endSec = uint40(c.t.endSec);
        r.stake = uint128(c.t.stake);
        r.maxPayout = uint128(c.t.maxPayout);
        r.targetPpm = uint32(c.t.targetPpm);
        r.stopPpm = uint32(c.t.stopPpm);
        r.multiplierBps = uint32(c.t.multiplierBps);
        r.feeBps = uint16(c.t.feeBps);
        r.maxJumpPpm = uint32(c.t.maxJumpPpm);
        r.pairId = PAIR;
    }

    uint256 internal constant PATH_CASES = 300;
    uint256 internal constant SHARD = 30;

    function test_pathVectors_00() public {
        _pathShard(0);
    }

    function test_pathVectors_01() public {
        _pathShard(1);
    }

    function test_pathVectors_02() public {
        _pathShard(2);
    }

    function test_pathVectors_03() public {
        _pathShard(3);
    }

    function test_pathVectors_04() public {
        _pathShard(4);
    }

    function test_pathVectors_05() public {
        _pathShard(5);
    }

    function test_pathVectors_06() public {
        _pathShard(6);
    }

    function test_pathVectors_07() public {
        _pathShard(7);
    }

    function test_pathVectors_08() public {
        _pathShard(8);
    }

    function test_pathVectors_09() public {
        _pathShard(9);
    }

    function test_pathVectors_caseCount() public view {
        string memory json = _read("path-vectors.json");
        assertTrue(vm.keyExistsJson(json, string.concat(".cases[", vm.toString(PATH_CASES - 1), "]")));
        assertFalse(vm.keyExistsJson(json, string.concat(".cases[", vm.toString(PATH_CASES), "]")));
    }

    /// @dev Cases [shard·30, shard·30 + 30).
    function _pathShard(uint256 shard) internal {
        _deployHarness();
        string memory json = _read("path-vectors.json");
        for (uint256 i = shard * SHARD; i < (shard + 1) * SHARD; ++i) {
            PathCase memory c = _loadCase(json, i);
            string memory tag = string.concat(" #", vm.toString(i));

            // 1) End to end (open → cash-out → record → settle) whenever the lane passes the setLane guard.
            if (!_endToEnd(c, i, tag)) _populate(c);

            // 2) The production evaluator on the exact vector terms (any lane).
            vm.warp(c.nowSec);
            BnbPlayArena.Evaluation memory e = harness.exposedEvaluate(_roundOf(c));
            assertEq(e.decidable, c.e.decidable, string.concat("decidable", tag));
            assertEq(uint8(e.outcome), c.e.outcome, string.concat("outcome", tag));
            assertEq(e.payout, c.e.payout, string.concat("payout", tag));
            assertEq(e.decisionSec, c.e.decisionSec, string.concat("decisionSec", tag));
            assertEq(uint8(e.voidReason), c.e.voidReason, string.concat("voidReason", tag));
            assertEq(e.missingSec, c.e.missingSec, string.concat("missingSec", tag));
        }
        console.log("path shard", shard, "end-to-end cases:", endToEnd);
        assertGt(endToEnd, 0, "end-to-end coverage");
    }

    function _endToEnd(PathCase memory c, uint256 i, string memory tag) internal returns (bool) {
        uint256 span = c.t.endSec - c.t.entrySec;
        LaneParams memory p = LaneParams({
            targetPpm: uint32(c.t.targetPpm),
            stopPpm: uint32(c.t.stopPpm),
            multiplierBps: uint32(c.t.multiplierBps),
            feeBps: uint16(c.t.feeBps),
            durationSec: uint16(c.t.cashOutRequested ? 30 : span),
            enabled: true,
            minStake: 1,
            maxStake: type(uint128).max
        });
        if (LaneMath.checkLane(p, 0) != LaneMath.LANE_OK) return false;
        uint40 entry = uint40(c.t.entrySec);

        harness.setAsset(
            ASSET, AssetConfig({pairId: PAIR, maxJumpPpm: uint32(c.t.maxJumpPpm), gapMarginPpm: 0, enabled: true})
        );
        harness.setLane(ASSET, 0, p);
        address player = address(uint160(0x10000 + i));
        token.mint(player, c.t.stake);
        vm.startPrank(player);
        token.approve(address(harness), c.t.stake);
        harness.deposit(c.t.stake);
        vm.warp(entry - 3);
        uint256 id = harness.openRound(
            ASSET, 0, Direction(c.t.direction), uint128(c.t.stake), harness.getLane(ASSET, 0).version, 0
        );
        if (c.t.cashOutRequested) {
            vm.warp(c.t.endSec - 2);
            assertEq(harness.requestCashOut(id), c.t.endSec, string.concat("exitSec", tag));
        }
        vm.stopPrank();
        Round memory r = harness.getRound(id);
        assertEq(r.entrySec, c.t.entrySec, string.concat("entrySec", tag));
        assertEq(r.endSec, c.t.endSec, string.concat("endSec", tag));
        assertEq(r.maxPayout, c.t.maxPayout, string.concat("maxPayout", tag));

        _populate(c);
        vm.warp(c.nowSec);
        if (!c.e.decidable) {
            vm.expectRevert(abi.encodeWithSelector(IBnbPlayArena.NotDecidable.selector, id, uint40(c.e.missingSec)));
            harness.settle(id);
        } else {
            (Outcome o, uint256 payout) = harness.settle(id);
            r = harness.getRound(id);
            assertEq(uint8(o), c.e.outcome, string.concat("e2e outcome", tag));
            assertEq(payout, c.e.payout, string.concat("e2e payout", tag));
            assertEq(r.decisionSec, c.e.decisionSec, string.concat("e2e decisionSec", tag));
            assertEq(uint8(r.voidReason), c.e.voidReason, string.concat("e2e voidReason", tag));
            assertEq(harness.balanceOf(player), payout, string.concat("e2e credited", tag));
        }
        ++endToEnd;
        return true;
    }

    // ── eip712-vectors.json ──────────────────────────────────────────────────────

    struct OpenMsg {
        address player;
        uint8 assetId;
        uint8 tier;
        uint8 direction;
        uint256 stake;
        uint32 laneVersion;
        uint8 oracleIdx;
        uint256 nonce;
        uint48 deadline;
    }

    struct OpenItem {
        OpenMsg message;
        bytes32 digest;
    }

    struct CashOutMsg {
        address player;
        uint256 roundId;
        uint48 deadline;
    }

    struct CashOutItem {
        CashOutMsg message;
        bytes32 digest;
    }

    struct WithdrawMsg {
        address player;
        address to;
        uint256 amount;
        uint256 nonce;
        uint48 deadline;
    }

    struct WithdrawItem {
        WithdrawMsg message;
        bytes32 digest;
    }

    function test_eip712Vectors_allCases() public {
        string memory json = _read("eip712-vectors.json");
        assertEq(vm.parseJsonUint(json, ".domain.chainId"), 97);
        address verifying = vm.parseJsonAddress(json, ".domain.verifyingContract");
        assertEq(vm.parseJsonString(json, ".domain.name"), "BnbPlayArena");
        assertEq(vm.parseJsonString(json, ".domain.version"), "1");

        // Type strings and hashes.
        assertEq(keccak256(bytes(vm.parseJsonString(json, ".typeStrings.OpenRound"))), Intents.OPEN_ROUND_TYPEHASH);
        assertEq(keccak256(bytes(vm.parseJsonString(json, ".typeStrings.CashOut"))), Intents.CASH_OUT_TYPEHASH);
        assertEq(keccak256(bytes(vm.parseJsonString(json, ".typeStrings.Withdraw"))), Intents.WITHDRAW_TYPEHASH);
        assertEq(
            keccak256(bytes(vm.parseJsonString(json, ".typeStrings.SessionGrant"))), Intents.SESSION_GRANT_TYPEHASH
        );
        assertEq(vm.parseJsonBytes32(json, ".typeHashes.OpenRound"), Intents.OPEN_ROUND_TYPEHASH);
        assertEq(vm.parseJsonBytes32(json, ".typeHashes.CashOut"), Intents.CASH_OUT_TYPEHASH);
        assertEq(vm.parseJsonBytes32(json, ".typeHashes.Withdraw"), Intents.WITHDRAW_TYPEHASH);
        assertEq(vm.parseJsonBytes32(json, ".typeHashes.SessionGrant"), Intents.SESSION_GRANT_TYPEHASH);

        // The real Arena bytecode at the vectors' verifying contract on chain 97.
        vm.chainId(97);
        TestUSD t = new TestUSD(address(this));
        BnbPlayArena a = new BnbPlayArena(t, address(this));
        vm.etch(verifying, address(a).code);
        IBnbPlayArena arena = IBnbPlayArena(verifying);

        OpenItem[] memory opens = abi.decode(
            vm.parseJsonTypeArray(
                json,
                ".openRound",
                "OpenItem(OpenMsg message,bytes32 digest)OpenMsg(address player,uint8 assetId,uint8 tier,uint8 direction,uint256 stake,uint32 laneVersion,uint8 oracleIdx,uint256 nonce,uint48 deadline)"
            ),
            (OpenItem[])
        );
        CashOutItem[] memory cashOuts = abi.decode(
            vm.parseJsonTypeArray(
                json,
                ".cashOut",
                "CashOutItem(CashOutMsg message,bytes32 digest)CashOutMsg(address player,uint256 roundId,uint48 deadline)"
            ),
            (CashOutItem[])
        );
        WithdrawItem[] memory withdraws = abi.decode(
            vm.parseJsonTypeArray(
                json,
                ".withdraw",
                "WithdrawItem(WithdrawMsg message,bytes32 digest)WithdrawMsg(address player,address to,uint256 amount,uint256 nonce,uint48 deadline)"
            ),
            (WithdrawItem[])
        );
        assertEq(opens.length, 40);
        assertEq(cashOuts.length, 40);
        assertEq(withdraws.length, 40);

        for (uint256 i; i < opens.length; ++i) {
            OpenMsg memory m = opens[i].message;
            OpenRoundIntent memory intent = OpenRoundIntent({
                player: m.player,
                assetId: m.assetId,
                tier: m.tier,
                direction: Direction(m.direction),
                stake: uint128(m.stake),
                laneVersion: m.laneVersion,
                oracleIdx: m.oracleIdx,
                nonce: m.nonce,
                deadline: m.deadline
            });
            assertEq(arena.hashOpenRound(intent), opens[i].digest, string.concat("OpenRound #", vm.toString(i)));
        }
        for (uint256 i; i < cashOuts.length; ++i) {
            CashOutMsg memory m = cashOuts[i].message;
            assertEq(
                arena.hashCashOut(CashOutIntent({player: m.player, roundId: m.roundId, deadline: m.deadline})),
                cashOuts[i].digest,
                string.concat("CashOut #", vm.toString(i))
            );
        }
        for (uint256 i; i < withdraws.length; ++i) {
            WithdrawMsg memory m = withdraws[i].message;
            assertEq(
                arena.hashWithdraw(
                    WithdrawIntent({player: m.player, to: m.to, amount: m.amount, nonce: m.nonce, deadline: m.deadline})
                ),
                withdraws[i].digest,
                string.concat("Withdraw #", vm.toString(i))
            );
        }
    }
}
