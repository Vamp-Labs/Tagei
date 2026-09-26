// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Test} from "forge-std/Test.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {PriceVerifierBase} from "../../src/oracle/PriceVerifierBase.sol";
import {SignedPriceVerifier} from "../../src/oracle/SignedPriceVerifier.sol";
import {StatelessSupraVerifier} from "../../src/oracle/StatelessSupraVerifier.sol";
import {SupraPriceVerifier} from "../../src/oracle/SupraPriceVerifier.sol";
import {ICheckpointOracle} from "../../src/oracle/interfaces/ICheckpointOracle.sol";
import {IPriceVerifier} from "../../src/oracle/interfaces/IPriceVerifier.sol";
import {ISupraOraclePull} from "../../src/oracle/interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../../src/oracle/interfaces/ISupraSValueFeed.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {MockSupraCommitteeVerifier} from "../mocks/MockSupraCommitteeVerifier.sol";
import {MockSupraPull} from "../mocks/MockSupraPull.sol";
import {SupraProofBuilder} from "../utils/SupraProofBuilder.sol";

contract OracleTest is Test {
    uint40 internal constant T0 = 1_790_000_000;
    string internal constant FIXTURE = "/../research/fixtures/supra-97-1790414769.json";

    MockSupraCommitteeVerifier internal committee;
    StatelessSupraVerifier internal verifier;
    CheckpointOracle internal oracle;

    function setUp() public {
        vm.warp(T0);
        committee = new MockSupraCommitteeVerifier();
        verifier = new StatelessSupraVerifier(committee, SupraProofBuilder.pairs());
        oracle = new CheckpointOracle(verifier);
    }

    function _one(uint32 pair, uint128 price, uint64 roundMs) internal pure returns (SupraProofV2.CommitteeFeed[] memory f) {
        f = new SupraProofV2.CommitteeFeed[](1);
        f[0] = SupraProofBuilder.feed(pair, price, roundMs);
    }

    function _five(uint40 sec, uint128 base) internal pure returns (SupraProofV2.CommitteeFeed[] memory f) {
        uint32[] memory ps = SupraProofBuilder.pairs();
        f = new SupraProofV2.CommitteeFeed[](5);
        for (uint256 i; i < 5; ++i) {
            f[i] = SupraProofBuilder.feed(ps[i], base + uint128(i), uint64(sec) * 1000);
        }
    }

    // ── fixture: leaf encoding and real multiproofs ─────────────────────────────

    struct FixtureFeed {
        uint32 pair;
        uint256 price;
        uint64 timestamp;
        uint16 decimals;
        uint64 round;
        bytes32 leaf;
    }

    function test_fixture_leavesAndProofsVerify() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), FIXTURE));
        for (uint256 i; i < 23; ++i) {
            string memory key = string.concat(".proofs[", vm.toString(i), "]");
            bytes memory proof = vm.parseJsonBytes(json, string.concat(key, ".proof"));
            bytes32 root = vm.parseJsonBytes32(json, string.concat(key, ".committees[0].root"));
            FixtureFeed[] memory feeds = abi.decode(
                vm.parseJsonTypeArray(
                    json,
                    string.concat(key, ".committees[0].feeds"),
                    "FixtureFeed(uint32 pair,uint256 price,uint64 timestamp,uint16 decimals,uint64 round,bytes32 leaf)"
                ),
                (FixtureFeed[])
            );
            assertEq(feeds.length, 5);
            for (uint256 k; k < 5; ++k) {
                FixtureFeed memory f = feeds[k];
                bytes32 leaf = SupraProofV2.leaf(
                    SupraProofV2.CommitteeFeed(f.pair, uint128(f.price), f.timestamp, f.decimals, f.round)
                );
                assertEq(leaf, f.leaf, "LE leaf encoding");
            }
            // The real Supra multiproof rebuilds the signed root (BLS itself is covered by the fork suite).
            committee.register(root, 0);
            vm.warp(feeds[0].round / 1000 + 1);
            IPriceVerifier.VerifiedPrice[] memory v = verifier.verify(proof);
            assertEq(v.length, 5);
            for (uint256 k; k < 5; ++k) {
                assertEq(v[k].pairId, feeds[k].pair);
                assertEq(v[k].price18, feeds[k].price);
                assertEq(v[k].roundMs, feeds[k].round);
                assertEq(v[k].tsMs, feeds[k].timestamp);
            }
            assertEq(oracle.record(proof), 5);
        }
        assertEq(oracle.lastRecordedSec(49), 1_790_414_791);
        assertEq(oracle.get(49, 1_790_414_769).price18, 770_770_500_000_000_000_000);
    }

    function test_fixture_tamperedPriceRejected() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), FIXTURE));
        bytes memory proof = vm.parseJsonBytes(json, ".proofs[0].proof");
        committee.register(vm.parseJsonBytes32(json, ".proofs[0].committees[0].root"), 0);
        vm.warp(1_790_414_770);
        SupraProofV2.OracleProofV2 memory p = abi.decode(proof, (SupraProofV2.OracleProofV2));
        p.data[0].committee_data.committee_feed[0].price += 1;
        vm.expectRevert(abi.encodeWithSelector(StatelessSupraVerifier.RootMismatch.selector, 0));
        verifier.verify(abi.encode(p));
    }

    // ── StatelessSupraVerifier checks ───────────────────────────────────────────

    function test_verifier_rejectsUnsignedRoot() public {
        SupraProofV2.OracleProofV2 memory p;
        p.data = new SupraProofV2.PriceDetailsWithCommittee[](1);
        p.data[0] = SupraProofBuilder.committee(committee, 0, _one(49, 1e18, uint64(T0) * 1000), 0);
        p.data[0].committee_id = 1; // root registered for committee 0 only
        vm.expectRevert(MockSupraCommitteeVerifier.BLSIncorrectInputMessaage.selector);
        verifier.verify(abi.encode(p));
    }

    function test_verifier_multiCommitteeAndSiblings() public {
        SupraProofV2.OracleProofV2 memory p;
        p.data = new SupraProofV2.PriceDetailsWithCommittee[](2);
        p.data[0] = SupraProofBuilder.committee(committee, 0, _five(T0, 100e18), 3);
        p.data[1] = SupraProofBuilder.committee(committee, 1, _one(49, 7e18, uint64(T0 - 1) * 1000), 2);
        IPriceVerifier.VerifiedPrice[] memory v = verifier.verify(abi.encode(p));
        assertEq(v.length, 6);
        assertEq(v[5].price18, 7e18);
        assertEq(oracle.record(abi.encode(p)), 6);
    }

    function test_verifier_skipsUntrackedPairs() public {
        uint32[] memory only = new uint32[](1);
        only[0] = 49;
        StatelessSupraVerifier bnbOnly = new StatelessSupraVerifier(committee, only);
        SupraProofV2.CommitteeFeed[] memory f = _five(T0, 100e18);
        f[0].decimals = 8; // untracked feeds are not validated or returned
        IPriceVerifier.VerifiedPrice[] memory v = bnbOnly.verify(SupraProofBuilder.build(committee, 0, f, 0));
        assertEq(v.length, 1);
        assertEq(v[0].pairId, 49);
        assertFalse(bnbOnly.isTracked(0));
        assertFalse(bnbOnly.isTracked(300));
    }

    function _expectFeedRevert(SupraProofV2.CommitteeFeed[] memory f, bytes memory err) internal {
        bytes memory proof = SupraProofBuilder.build(committee, 0, f, 0);
        vm.expectRevert(err);
        verifier.verify(proof);
    }

    function test_verifier_feedChecks() public {
        uint64 r = uint64(T0) * 1000;
        SupraProofV2.CommitteeFeed[] memory f = _one(49, 5e18, r);

        f[0].decimals = 8;
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.UnsupportedDecimals.selector, 49, 8));

        f = _one(49, 0, r);
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.InvalidPrice.selector, 49, 0));

        f = _one(49, 5e18, r + 1); // round not second-aligned
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.NonCanonicalRound.selector, 49, r + 1, r + 164));

        f = _one(49, 5e18, r);
        f[0].timestamp = r - 1; // ts before the round
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.NonCanonicalRound.selector, 49, r, r - 1));
        f[0].timestamp = r + 1000; // ts in the next round
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.NonCanonicalRound.selector, 49, r, r + 1000));

        f = _one(49, 5e18, r + 3000); // exactly Supra's +3 s tolerance: ok
        assertEq(verifier.verify(SupraProofBuilder.build(committee, 0, f, 0)).length, 1);
        f = _one(49, 5e18, r + 4000);
        _expectFeedRevert(f, abi.encodeWithSelector(PriceVerifierBase.FutureRound.selector, 49, r + 4000, r));

        assertEq(verifier.latestRoundMs(49), 0);
        assertTrue(verifier.supportsLateVerification());
        assertFalse(verifier.isTrusted());
    }

    // ── CheckpointOracle ────────────────────────────────────────────────────────

    function test_oracle_setOnceDisputeAndRanges() public {
        bytes memory a = SupraProofBuilder.build(committee, 0, _one(49, 5e18, uint64(T0) * 1000), 0);
        assertEq(oracle.record(a), 1);
        assertEq(oracle.record(a), 0, "idempotent");
        ICheckpointOracle.Checkpoint memory c = oracle.get(49, T0);
        assertEq(c.price18, 5e18);
        assertEq(c.tsMs, uint64(T0) * 1000 + 163);
        assertEq(c.flags, 1);

        bytes memory b = SupraProofBuilder.build(committee, 1, _one(49, 6e18, uint64(T0) * 1000), 0);
        vm.expectEmit(true, true, true, true, address(oracle));
        emit ICheckpointOracle.CheckpointDisputed(49, T0, 5e18, 6e18);
        assertEq(oracle.record(b), 0);
        c = oracle.get(49, T0);
        assertEq(c.price18, 5e18, "write-once");
        assertEq(c.flags, 3);
        vm.recordLogs();
        oracle.record(b); // already disputed: no second event
        assertEq(vm.getRecordedLogs().length, 0);

        // Older seconds never lower lastRecordedSec.
        oracle.record(SupraProofBuilder.build(committee, 0, _one(49, 5e18, uint64(T0 - 10) * 1000), 0));
        assertEq(oracle.lastRecordedSec(49), T0);
        assertEq(oracle.latestKnownSec(49), T0);
        assertFalse(oracle.isPermanentlyMissing(49, T0 - 5));

        ICheckpointOracle.Checkpoint[] memory range = oracle.getRange(49, T0 - 255, T0);
        assertEq(range.length, 256);
        assertEq(range[255].price18, 5e18);
        assertEq(range[245].price18, 5e18);
        assertEq(range[0].flags, 0);
        vm.expectRevert(abi.encodeWithSelector(CheckpointOracle.InvalidRange.selector, T0 - 256, T0));
        oracle.getRange(49, T0 - 256, T0);
        vm.expectRevert(abi.encodeWithSelector(CheckpointOracle.InvalidRange.selector, T0, T0 - 1));
        oracle.getRange(49, T0, T0 - 1);
    }

    // ── SupraPriceVerifier (P1 stateful fallback) ───────────────────────────────

    function test_stateful_f1GuardDropsStaleValues() public {
        MockSupraPull pull = new MockSupraPull();
        SupraPriceVerifier sv =
            new SupraPriceVerifier(ISupraOraclePull(address(pull)), ISupraSValueFeed(address(pull)), SupraProofBuilder.pairs());
        CheckpointOracle so = new CheckpointOracle(sv);
        assertFalse(so.lateVerification());

        bytes memory p0 = SupraProofBuilder.build(committee, 0, _five(T0, 100e18), 0);
        assertEq(so.record(p0), 5);
        assertEq(so.latestKnownSec(49), T0);

        // A griefer pushes a newer round straight into Supra; our older second can never be recorded any more.
        vm.warp(T0 + 5);
        pull.verifyOracleProofV2(SupraProofBuilder.build(committee, 0, _five(T0 + 5, 200e18), 0));
        bytes memory late = SupraProofBuilder.build(committee, 0, _five(T0 + 2, 150e18), 0);
        ISupraOraclePull.PriceInfo memory info = pull.verifyOracleProofV2(late);
        assertEq(info.round[4], uint256(T0 + 5) * 1000, "F1: Supra answers with the stored newer round");
        assertEq(so.record(late), 0, "F1 guard");
        assertEq(so.get(49, T0 + 2).flags, 0);
        assertEq(so.latestKnownSec(49), T0 + 5);
        assertTrue(so.isPermanentlyMissing(49, T0 + 2));
        assertFalse(so.isPermanentlyMissing(49, T0));
        assertFalse(so.isPermanentlyMissing(49, T0 + 5));

        // The same round someone else pushed first is still accepted.
        assertEq(so.record(SupraProofBuilder.build(committee, 0, _five(T0 + 5, 200e18), 0)), 5);
        assertEq(sv.latestRoundMs(49), uint64(T0 + 5) * 1000);
        assertEq(sv.sourceId(), bytes32("SUPRA_DORA2_PULL_V2"));
    }

    // ── SignedPriceVerifier ─────────────────────────────────────────────────────

    function test_signed_batch() public {
        (address signer, uint256 signerKey) = makeAddrAndKey("price-signer");
        address[] memory signers = new address[](1);
        signers[0] = signer;
        SignedPriceVerifier sv = new SignedPriceVerifier(address(this), signers, SupraProofBuilder.pairs());
        CheckpointOracle so = new CheckpointOracle(sv);

        IPriceVerifier.VerifiedPrice[] memory pts = new IPriceVerifier.VerifiedPrice[](2);
        pts[0] = IPriceVerifier.VerifiedPrice(49, uint64(T0) * 1000, uint64(T0) * 1000 + 10, 600e18);
        pts[1] = IPriceVerifier.VerifiedPrice(0, uint64(T0) * 1000, uint64(T0) * 1000 + 10, 95_000e18);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, sv.hashBatch(pts));
        assertEq(so.record(abi.encode(pts, abi.encodePacked(r, s, v))), 2);
        assertEq(so.get(0, T0).price18, 95_000e18);
        assertTrue(sv.isTrusted());
        assertTrue(sv.supportsLateVerification());

        (, uint256 otherKey) = makeAddrAndKey("other");
        (v, r, s) = vm.sign(otherKey, sv.hashBatch(pts));
        vm.expectRevert(SignedPriceVerifier.InvalidBatchSignature.selector);
        sv.verify(abi.encode(pts, abi.encodePacked(r, s, v)));

        pts[1].pairId = 2; // untracked
        (v, r, s) = vm.sign(signerKey, sv.hashBatch(pts));
        vm.expectRevert(abi.encodeWithSelector(PriceVerifierBase.UntrackedPair.selector, 2));
        sv.verify(abi.encode(pts, abi.encodePacked(r, s, v)));

        bytes32 role = sv.SIGNER_ADMIN_ROLE();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role));
        sv.setSigner(stranger, true);
        sv.setSigner(signer, false);
        pts[1].pairId = 0;
        (v, r, s) = vm.sign(signerKey, sv.hashBatch(pts));
        vm.expectRevert(SignedPriceVerifier.InvalidBatchSignature.selector);
        sv.verify(abi.encode(pts, abi.encodePacked(r, s, v)));
    }
}
