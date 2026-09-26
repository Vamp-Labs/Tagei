// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {ICheckpointOracle} from "../../src/oracle/interfaces/ICheckpointOracle.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
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
import {MockSupraCommitteeVerifier} from "../mocks/MockSupraCommitteeVerifier.sol";
import {MockSupraPull} from "../mocks/MockSupraPull.sol";
import {RefPath} from "../utils/RefPath.sol";
import {SupraProofBuilder} from "../utils/SupraProofBuilder.sol";

/// @notice Drives the Arena with 5 players, an in-order recorder (with skipped seconds and disputes), a backfiller, a
/// griefer that pushes newer rounds straight into Supra (permanent gaps on the stateful oracle), settlers, admin
/// actions and donations. Violations are latched into ghost flags that the invariant functions assert.
contract ArenaHandler is Test {
    uint8 internal constant STATELESS = 0;
    uint8 internal constant STATEFUL = 2;

    BnbPlayArena public arena;
    TestUSD public token;
    MockSupraCommitteeVerifier public committee;
    MockSupraPull public pull;
    CheckpointOracle[3] public oracles; // idx 1 (signed backup) is never recorded, so never activated here
    address public admin;
    address public tuner; // LANE_TUNER_ROLE (the ops key)

    address[5] public players;
    uint256[5] internal keys;
    uint32[5] internal pairs = [uint32(0), 1, 3, 10, 49];
    uint256[5] internal basePrice = [uint256(95_400e18), 2_850e18, 245e15, 182e18, 612e18];
    uint8[5] internal assetOfPair = [1, 2, 4, 3, 0]; // pair index → assetId

    // price archive (the "true" Supra path), generated in order
    uint40 public archiveSec;
    mapping(uint32 pair => mapping(uint40 sec => uint128)) public archive;
    uint40 public recorderCursor; // last second the in-order recorder handled
    uint40[] internal skipped;
    mapping(uint32 pair => uint40) public supraLatestSec; // max round pushed into MockSupraPull

    // ghost state
    uint256[] public ids;
    mapping(uint256 id => bytes32) public snapshot;
    mapping(uint256 id => uint256) public settleCount;
    mapping(address p => mapping(uint192 key => uint256)) public lastNonce;
    uint256 public donated;
    uint256 public skimmed;
    struct Rec {
        uint8 oracle;
        uint32 pair;
        uint40 sec;
        uint128 price;
    }
    Rec[] internal recs;

    bool public mismatch; // invariant 9
    bool public payoutRuleBroken; // invariant 4
    bool public doubleSettle; // invariant 5
    bool public pauseBlocked; // invariant 8
    bool public checkpointRewritten; // invariant 10
    bool public nonceDecreased; // invariant 11
    string public why;

    mapping(bytes32 => uint256) public calls;

    constructor(
        BnbPlayArena arena_,
        TestUSD token_,
        MockSupraCommitteeVerifier committee_,
        MockSupraPull pull_,
        CheckpointOracle o0,
        CheckpointOracle o2,
        address admin_,
        address[5] memory players_,
        uint256[5] memory keys_
    ) {
        arena = arena_;
        token = token_;
        committee = committee_;
        pull = pull_;
        oracles[0] = o0;
        oracles[2] = o2;
        admin = admin_;
        players = players_;
        keys = keys_;
        archiveSec = uint40(block.timestamp);
        recorderCursor = uint40(block.timestamp);
        for (uint256 i; i < 5; ++i) {
            archive[pairs[i]][archiveSec] = uint128(basePrice[i]);
        }
    }

    function setTuner(address t) external {
        tuner = t;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function recCount() external view returns (uint256) {
        return recs.length;
    }

    function recAt(uint256 i) external view returns (Rec memory) {
        return recs[i];
    }

    // ── price archive ───────────────────────────────────────────────────────────

    function _ensureArchive(uint40 sec) internal {
        while (archiveSec < sec) {
            uint40 s = archiveSec + 1;
            for (uint256 i; i < 5; ++i) {
                uint256 h = uint256(keccak256(abi.encode(s, i, "walk")));
                uint256 prev = archive[pairs[i]][archiveSec];
                uint256 move = (prev * (h % 180)) / 1e6; // up to 180 ppm per second
                if ((h >> 64) % 60 == 0) move = (prev * 45_000) / 1e6; // rare 4.5 % jump (invalid everywhere)
                uint256 p = (h >> 128) % 2 == 0 ? prev + move : prev - move;
                archive[pairs[i]][s] = uint128(p);
            }
            archiveSec = s;
        }
    }

    function _proof(uint40 sec, uint64 committeeId, int256 bump) internal returns (bytes memory) {
        SupraProofV2.CommitteeFeed[] memory f = new SupraProofV2.CommitteeFeed[](5);
        for (uint256 i; i < 5; ++i) {
            uint256 p = archive[pairs[i]][sec];
            if (bump != 0 && i == uint256(sec) % 5) p = uint256(int256(p) + bump);
            f[i] = SupraProofBuilder.feed(pairs[i], uint128(p), uint64(sec) * 1000);
        }
        return SupraProofBuilder.build(committee, committeeId, f, 0);
    }

    function _recordBoth(uint40 sec, bytes memory proof) internal {
        for (uint8 o = 0; o < 3; o += 2) {
            try oracles[o].record(proof) {} catch {}
            _trackRecords(o, sec);
        }
        for (uint256 i; i < 5; ++i) {
            if (sec > supraLatestSec[pairs[i]]) supraLatestSec[pairs[i]] = sec;
        }
    }

    function _trackRecords(uint8 o, uint40 sec) internal {
        for (uint256 i; i < 5; ++i) {
            ICheckpointOracle.Checkpoint memory c = oracles[o].get(pairs[i], sec);
            if (c.flags & 1 == 0) continue;
            recs.push(Rec(o, pairs[i], sec, c.price18));
        }
        // write-once spot check of an older record
        if (recs.length > 0) {
            Rec memory r = recs[uint256(keccak256(abi.encode(sec, recs.length))) % recs.length];
            if (oracles[r.oracle].get(r.pair, r.sec).price18 != r.price) _flag(3, "checkpoint rewritten");
        }
    }

    // ── recorder / backfill / griefer ───────────────────────────────────────────

    function record(uint256 seed) external {
        ++calls["record"];
        uint40 nowSec = uint40(block.timestamp);
        _ensureArchive(nowSec);
        uint40 from = recorderCursor + 1;
        if (nowSec > from + 12) from = nowSec - 12;
        for (uint40 s = from; s <= nowSec; ++s) {
            uint256 h = uint256(keccak256(abi.encode(seed, s)));
            if (h % 40 == 0) {
                skipped.push(s); // a missed second, maybe backfilled later
                continue;
            }
            _recordBoth(s, _proof(s, 0, 0));
            if ((h >> 8) % 40 == 0) _recordBoth(s, _proof(s, 1, 1)); // equivocation → DISPUTED
        }
        recorderCursor = nowSec;
        _afterCall();
    }

    function backfill(uint256 k) external {
        ++calls["backfill"];
        if (skipped.length == 0) return;
        uint256 i = k % skipped.length;
        uint40 s = skipped[i];
        skipped[i] = skipped[skipped.length - 1];
        skipped.pop();
        _recordBoth(s, _proof(s, 0, 0)); // stateless accepts; stateful drops it once Supra holds a newer round
        _afterCall();
    }

    /// @notice Anyone can push a (slightly future) round into Supra: on the stateful oracle every unrecorded older
    /// second becomes permanently missing.
    function grief(uint256 ahead) external {
        ++calls["grief"];
        uint40 s = uint40(block.timestamp) + uint40(ahead % 4);
        _ensureArchive(s);
        try pull.verifyOracleProofV2(_proof(s, 0, 0)) {
            for (uint256 i; i < 5; ++i) {
                if (s > supraLatestSec[pairs[i]]) supraLatestSec[pairs[i]] = s;
            }
        } catch {}
        _afterCall();
    }

    function warp(uint256 secs) external {
        ++calls["warp"];
        vm.warp(block.timestamp + 1 + (secs % 15));
        _afterCall();
    }

    // ── players ─────────────────────────────────────────────────────────────────

    function open(uint256 pSeed, uint256 pairSeed, bool boost, bool short, uint256 stakeSeed, bool signed) external {
        ++calls["open"];
        uint256 pi = pSeed % 5;
        address p = players[pi];
        if (arena.activeRoundOf(p) != 0) return;
        uint8 assetId = assetOfPair[pairSeed % 5];
        uint8 tier = boost && assetId != 1 ? 1 : 0;
        LaneParams memory lp = arena.getLane(assetId, tier).p;
        uint128 stake = uint128(lp.minStake + stakeSeed % (uint256(lp.maxStake) - lp.minStake + 1));
        uint32 v = arena.getLane(assetId, tier).version;
        uint8 oi = arena.activeOracleIdx();
        Direction d = short ? Direction.Short : Direction.Long;
        uint256 id;
        if (signed) {
            OpenRoundIntent memory i = OpenRoundIntent(p, assetId, tier, d, stake, v, oi, arena.nonces(p, 0), uint48(block.timestamp + 5));
            (uint8 sv, bytes32 r, bytes32 s) = vm.sign(keys[pi], arena.hashOpenRound(i));
            try arena.openRoundWithSig(i, abi.encodePacked(r, s, sv)) returns (uint256 x) {
                id = x;
            } catch {}
        } else {
            vm.prank(p);
            try arena.openRound(assetId, tier, d, stake, v, oi) returns (uint256 x) {
                id = x;
            } catch {}
        }
        if (id != 0) {
            ids.push(id);
            snapshot[id] = _snap(arena.getRound(id));
        }
        _afterCall();
    }

    function cashOut(uint256 pSeed, bool signed) external {
        ++calls["cashOut"];
        uint256 pi = pSeed % 5;
        address p = players[pi];
        uint256 id = arena.activeRoundOf(p);
        if (id == 0) return;
        bytes4 err;
        if (signed) {
            CashOutIntent memory c = CashOutIntent(p, id, uint48(block.timestamp + 3));
            (uint8 sv, bytes32 r, bytes32 s) = vm.sign(keys[pi], arena.hashCashOut(c));
            try arena.requestCashOutWithSig(c, abi.encodePacked(r, s, sv)) {} catch (bytes memory e) {
                err = bytes4(e);
            }
        } else {
            vm.prank(p);
            try arena.requestCashOut(id) {} catch (bytes memory e) {
                err = bytes4(e);
            }
        }
        if (err == Pausable.EnforcedPause.selector) _flag(2, "pause blocked cash-out");
        _afterCall();
    }

    function withdraw(uint256 pSeed, uint256 amount, bool signed) external {
        ++calls["withdraw"];
        uint256 pi = pSeed % 5;
        address p = players[pi];
        uint256 bal = arena.balanceOf(p);
        if (bal == 0) return;
        amount = 1 + amount % bal;
        bytes4 err;
        if (signed) {
            WithdrawIntent memory w = WithdrawIntent(p, p, amount, arena.nonces(p, 1), uint48(block.timestamp + 60));
            (uint8 sv, bytes32 r, bytes32 s) = vm.sign(keys[pi], arena.hashWithdraw(w));
            try arena.withdrawWithSig(w, abi.encodePacked(r, s, sv)) {} catch (bytes memory e) {
                err = bytes4(e);
            }
        } else {
            vm.prank(p);
            try arena.withdraw(p, amount) {} catch (bytes memory e) {
                err = bytes4(e);
            }
        }
        if (err != bytes4(0)) _flag(2, "withdraw reverted");
        _afterCall();
    }

    function deposit(uint256 pSeed, uint256 amount) external {
        ++calls["deposit"];
        address p = players[pSeed % 5];
        amount = 1 + amount % 200e18;
        vm.prank(admin);
        token.mint(p, amount);
        vm.startPrank(p);
        token.approve(address(arena), amount);
        arena.deposit(amount);
        vm.stopPrank();
        _afterCall();
    }

    // ── settlers ────────────────────────────────────────────────────────────────

    function settle(uint256 idSeed) external {
        ++calls["settle"];
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        bool wasOpen = arena.getRound(id).status == RoundStatus.Open;
        try arena.settle(id) {} catch (bytes memory e) {
            if (bytes4(e) == Pausable.EnforcedPause.selector) _flag(2, "pause blocked settle");
        }
        if (wasOpen) _checkSettled(id);
        _afterCall();
    }

    function settleMany(uint256 seed) external {
        ++calls["settleMany"];
        uint256 n = ids.length < 6 ? ids.length : 6;
        uint256[] memory batch = new uint256[](n);
        bool[] memory wasOpen = new bool[](n);
        for (uint256 i; i < n; ++i) {
            batch[i] = ids[(seed % ids.length + i * 7) % ids.length]; // no overflow for any seed
            wasOpen[i] = arena.getRound(batch[i]).status == RoundStatus.Open;
        }
        bool useRecord = seed % 2 == 0;
        uint40 s = uint40(block.timestamp);
        _ensureArchive(s);
        if (useRecord) {
            uint8 oi = seed % 4 == 0 ? STATEFUL : STATELESS;
            try arena.recordAndSettle(oi, _proof(s, 0, 0), batch) {} catch {}
            _trackRecords(oi, s);
            if (oi == STATEFUL) {
                for (uint256 i; i < 5; ++i) {
                    if (s > supraLatestSec[pairs[i]]) supraLatestSec[pairs[i]] = s;
                }
            }
        } else {
            try arena.settleMany(batch) {} catch {}
        }
        for (uint256 i; i < n; ++i) {
            if (!wasOpen[i]) continue;
            for (uint256 j = i + 1; j < n; ++j) {
                if (batch[j] == batch[i]) wasOpen[j] = false; // duplicate ids in one batch settle once
            }
            _checkSettled(batch[i]);
        }
        _afterCall();
    }

    function voidStale(uint256 idSeed) external {
        ++calls["voidStale"];
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        bool wasOpen = arena.getRound(id).status == RoundStatus.Open;
        try arena.voidStale(id) {
            if (arena.getRound(id).outcome != Outcome.Voided) _flag(1, "voidStale settled a real outcome");
        } catch {}
        if (wasOpen) _checkSettled(id);
        _afterCall();
    }

    /// @dev If `id` just settled, compare it with the reference evaluation of the recorded path (same block).
    function _checkSettled(uint256 id) internal {
        Round memory r = arena.getRound(id);
        if (r.status != RoundStatus.Settled) return;
        if (++settleCount[id] > 1) _flag(4, "settled twice");
        RefPath.Result memory x = RefPath.evaluate(_terms(r), _path(r), block.timestamp);
        if (
            !x.decidable || x.outcome != uint8(r.outcome) || x.payout != r.payout || x.decisionSec != r.decisionSec
                || x.voidReason != uint8(r.voidReason)
        ) _flag(0, "reference mismatch");
        if (r.payout > r.maxPayout) _flag(1, "payout > maxPayout");
        if (r.outcome == Outcome.TargetHit && r.payout != r.maxPayout) _flag(1, "target != maxPayout");
        if (r.outcome == Outcome.StopHit && r.payout != 0) _flag(1, "stop != 0");
        if (r.outcome == Outcome.Voided && r.payout != r.stake) _flag(1, "void != stake");
    }

    function _terms(Round memory r) internal pure returns (RefPath.Terms memory t) {
        t.direction = uint8(r.direction);
        t.stake = r.stake;
        t.maxPayout = r.maxPayout;
        t.entrySec = r.entrySec;
        t.endSec = r.endSec;
        t.targetPpm = r.targetPpm;
        t.stopPpm = r.stopPpm;
        t.multiplierBps = r.multiplierBps;
        t.feeBps = r.feeBps;
        t.maxJumpPpm = r.maxJumpPpm;
        t.cashOutRequested = r.cashOutRequested;
    }

    function _path(Round memory r) internal view returns (RefPath.Point[] memory pts) {
        uint256 n = uint256(r.endSec) - r.entrySec + 1;
        pts = new RefPath.Point[](n);
        CheckpointOracle o = oracles[r.oracleIdx];
        for (uint256 k; k < n; ++k) {
            uint40 sec = r.entrySec + uint40(k);
            ICheckpointOracle.Checkpoint memory c = o.get(r.pairId, sec);
            pts[k].recorded = c.flags & 1 != 0;
            pts[k].price18 = c.price18;
            pts[k].disputed = c.flags & 2 != 0;
            // stateful oracle: unrecorded seconds below Supra's stored round can never be recorded
            pts[k].permanentlyMissing = !pts[k].recorded && r.oracleIdx == STATEFUL && supraLatestSec[r.pairId] > sec;
        }
    }

    // ── admin & donations ───────────────────────────────────────────────────────

    function adminSetLane(uint256 seed) external {
        ++calls["adminSetLane"];
        uint8 assetId = uint8(seed % 5);
        uint8 tier = assetId == 1 ? 0 : uint8((seed >> 8) % 2);
        LaneParams memory p = arena.getLane(assetId, tier).p;
        uint256 k = 50 + (seed >> 16) % 150; // scale 0.5x … 2x like the adaptive-lane job
        p.targetPpm = uint32((uint256(p.targetPpm) * k) / 100);
        p.stopPpm = uint32((uint256(p.stopPpm) * k) / 100);
        p.durationSec = uint16(5 + (seed >> 32) % 36);
        vm.prank(admin);
        try arena.setLane(assetId, tier, p) {} catch {}
        _afterCall();
    }

    /// @notice The adaptive-lanes job: scale T and S by k in [0.5, 2] of the current lane (bounds + guard enforced).
    function tunerTuneLane(uint256 seed) external {
        ++calls["tunerTuneLane"];
        uint8 assetId = uint8(seed % 5);
        uint8 tier = uint8((seed >> 8) % 2);
        LaneParams memory p = arena.getLane(assetId, tier).p;
        uint256 k = 50 + (seed >> 16) % 151;
        vm.prank(tuner);
        try arena.tuneLane(assetId, tier, uint32((uint256(p.targetPpm) * k) / 100), uint32((uint256(p.stopPpm) * k) / 100)) {
            if (arena.getLane(assetId, tier).p.enabled != p.enabled) _flag(1, "tuneLane changed enabled");
        } catch {}
        _afterCall();
    }

    /// @notice Cold-key asset update (jump filter), which re-versions the asset's lanes.
    function adminSetAsset(uint256 seed) external {
        ++calls["adminSetAsset"];
        uint8 assetId = uint8(seed % 5);
        AssetConfig memory a = arena.getAsset(assetId);
        a.maxJumpPpm = uint32(5_000 + (seed >> 8) % 45_001);
        uint32 v = arena.getLane(assetId, 0).version;
        vm.prank(admin);
        try arena.setAsset(assetId, a) {
            if (arena.getLane(assetId, 0).version != v + 1) _flag(1, "setAsset did not bump lane version");
        } catch {}
        _afterCall();
    }

    function adminToggleOracle(uint256 seed) external {
        ++calls["adminToggleOracle"];
        vm.prank(admin);
        arena.setActiveOracle(seed % 2 == 0 ? STATELESS : STATEFUL);
        _afterCall();
    }

    function adminPause(bool on) external {
        ++calls["adminPause"];
        vm.prank(admin);
        if (on) {
            try arena.pause() {} catch {}
        } else {
            try arena.unpause() {} catch {}
        }
        _afterCall();
    }

    function adminHouse(uint256 amount, bool fund) external {
        ++calls["adminHouse"];
        vm.startPrank(admin);
        if (fund) {
            amount = 1 + amount % 10_000e18;
            token.mint(admin, amount);
            token.approve(address(arena), amount);
            arena.fundHouse(amount);
        } else {
            uint256 free = arena.houseFree();
            if (free > 0) arena.withdrawHouse(admin, 1 + amount % free);
        }
        vm.stopPrank();
        _afterCall();
    }

    function donate(uint256 amount, bool andSkim) external {
        ++calls["donate"];
        amount = 1 + amount % 1_000e18;
        vm.prank(admin);
        token.mint(address(arena), amount);
        donated += amount;
        if (andSkim) {
            uint256 s = arena.surplus();
            arena.skim();
            skimmed += s;
        }
        _afterCall();
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    function _snap(Round memory r) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                r.player,
                r.assetId,
                r.tier,
                r.direction,
                r.oracleIdx,
                r.entrySec,
                r.stake,
                r.maxPayout,
                r.targetPpm,
                r.stopPpm,
                r.multiplierBps,
                r.feeBps,
                r.maxJumpPpm,
                r.pairId,
                r.openedAt
            )
        );
    }

    function snapOf(uint256 id) external view returns (bytes32) {
        return _snap(arena.getRound(id));
    }

    function _afterCall() internal {
        for (uint256 i; i < 5; ++i) {
            for (uint192 key; key < 2; ++key) {
                uint256 n = arena.nonces(players[i], key);
                if (n < lastNonce[players[i]][key]) _flag(5, "nonce decreased");
                lastNonce[players[i]][key] = n;
            }
        }
    }

    function _flag(uint256 kind, string memory reason) internal {
        if (kind == 0) mismatch = true;
        else if (kind == 1) payoutRuleBroken = true;
        else if (kind == 2) pauseBlocked = true;
        else if (kind == 3) checkpointRewritten = true;
        else if (kind == 4) doubleSettle = true;
        else nonceDecreased = true;
        if (bytes(why).length == 0) why = reason;
    }
}
