// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Test doubles for the A3 anvil integration tests. NOT production contracts (A2 owns those).
// They expose the F1a v2 signatures, events and custom errors the backend uses, with the
// full-path settlement of packages/shared/src/path.ts. Signature/BLS checks are skipped: the
// stub oracle decodes OracleProofV2 and enforces the canonical-round and future-round rules.
// Build: node server/test/recorder/harness/build-stubs.ts

struct CommitteeFeed { uint32 pair; uint128 price; uint64 timestamp; uint16 decimals; uint64 round; }
struct CommitteeFeedsWithProof { CommitteeFeed[] committee_feed; bytes32[] proof; bool[] flags; }
struct PriceDetailsWithCommittee { uint64 committee_id; bytes32 root; uint256[2] sigs; CommitteeFeedsWithProof committee_data; }
struct OracleProofV2 { PriceDetailsWithCommittee[] data; }

struct Checkpoint { uint128 price18; uint64 tsMs; uint8 flags; }

contract StubCheckpointOracle {
    event CheckpointRecorded(uint32 indexed pairId, uint40 indexed sec, uint128 price18, uint64 tsMs);
    event CheckpointDisputed(uint32 indexed pairId, uint40 indexed sec, uint128 recorded, uint128 conflicting);
    error NonCanonicalRound();
    error FutureRound();

    mapping(uint32 => mapping(uint40 => Checkpoint)) internal cps;
    mapping(uint32 => uint40) public lastRecordedSec;
    mapping(uint32 => bool) internal tracked;
    address public verifier;

    constructor() {
        tracked[0] = true; tracked[1] = true; tracked[3] = true; tracked[10] = true; tracked[49] = true;
    }

    function record(bytes calldata proof) public returns (uint256 n) {
        OracleProofV2 memory p = abi.decode(proof, (OracleProofV2));
        for (uint256 i; i < p.data.length; ++i) {
            CommitteeFeed[] memory feeds = p.data[i].committee_data.committee_feed;
            for (uint256 j; j < feeds.length; ++j) {
                CommitteeFeed memory f = feeds[j];
                if (!tracked[f.pair]) continue;
                if (f.round % 1000 != 0 || f.timestamp < f.round || f.timestamp - f.round >= 1000 || f.decimals != 18) revert NonCanonicalRound();
                if (f.round > block.timestamp * 1000 + 3000) revert FutureRound();
                uint40 sec = uint40(f.round / 1000);
                Checkpoint storage c = cps[f.pair][sec];
                if (c.flags & 1 == 0) {
                    c.price18 = f.price; c.tsMs = f.timestamp; c.flags = 1; n++;
                    if (sec > lastRecordedSec[f.pair]) lastRecordedSec[f.pair] = sec;
                    emit CheckpointRecorded(f.pair, sec, f.price, f.timestamp);
                } else if (c.price18 != f.price && c.flags & 2 == 0) {
                    c.flags |= 2;
                    emit CheckpointDisputed(f.pair, sec, c.price18, f.price);
                }
            }
        }
    }

    function get(uint32 pairId, uint40 sec) external view returns (Checkpoint memory) { return cps[pairId][sec]; }

    function getRange(uint32 pairId, uint40 fromSec, uint40 toSec) public view returns (Checkpoint[] memory out) {
        require(toSec >= fromSec && toSec - fromSec < 256, "range");
        out = new Checkpoint[](toSec - fromSec + 1);
        for (uint40 s = fromSec; s <= toSec; s++) out[s - fromSec] = cps[pairId][s];
    }

    function latestKnownSec(uint32 pairId) external view returns (uint40) { return lastRecordedSec[pairId]; }
    function isPermanentlyMissing(uint32, uint40) external pure returns (bool) { return false; }
}

contract StubArena {
    struct AssetConfig { uint32 pairId; uint32 maxJumpPpm; uint32 gapMarginPpm; bool enabled; }
    struct LaneParams { uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps; uint16 durationSec; bool enabled; uint128 minStake; uint128 maxStake; }
    struct Lane { LaneParams p; uint32 version; }
    struct Round {
        address player; uint8 assetId; uint8 tier; uint8 direction; uint8 status; uint8 outcome; bool cashOutRequested; uint8 oracleIdx;
        uint40 entrySec; uint128 stake; uint128 maxPayout; uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps;
        uint32 maxJumpPpm; uint32 pairId; uint40 endSec; uint40 openedAt; uint128 payout; uint40 decisionSec; uint8 voidReason;
    }
    struct RoundTerms {
        uint8 tier; uint8 direction; uint128 stake; uint128 maxPayout; uint40 entrySec; uint40 endSec; uint32 laneVersion; uint8 oracleIdx;
        uint32 pairId; uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps; uint32 maxJumpPpm;
    }
    struct Eval { bool decidable; uint8 outcome; uint256 payout; uint40 decisionSec; uint8 voidReason; uint256 p0; uint256 exitPrice; uint40 missingSec; }

    event RoundOpened(uint256 indexed roundId, address indexed player, uint8 indexed assetId, RoundTerms terms);
    event CashOutRequested(uint256 indexed roundId, address indexed player, uint40 requestedAt, uint40 exitSec);
    event RoundSettled(uint256 indexed roundId, address indexed player, uint8 indexed outcome, uint256 payout, int256 pnl, uint256 entryPrice, uint256 exitPrice, uint40 decisionSec, uint8 voidReason);
    event Deposited(address indexed player, address indexed from, uint256 amount);
    event LaneConfigured(uint8 indexed assetId, uint8 indexed tier, uint32 indexed version, LaneParams params);
    event AssetConfigured(uint8 indexed assetId, AssetConfig config);
    event OracleAdded(uint8 indexed idx, address oracle, bytes32 sourceId, bool trusted);

    error AssetDisabled(uint8 assetId);
    error LaneDisabled(uint8 assetId, uint8 tier);
    error LaneVersionMismatch(uint32 expected, uint32 actual);
    error OracleMismatch(uint8 expected, uint8 actual);
    error StakeOutOfRange(uint256 stake, uint256 min, uint256 max);
    error InsufficientBalance(uint256 needed, uint256 available);
    error PlayerHasOpenRound(uint256 roundId);
    error EntryNotInFuture(uint40 entrySec, uint40 latestKnownSec);
    error ExitNotInFuture(uint40 exitSec, uint40 latestKnownSec);
    error RoundNotOpen(uint256 roundId);
    error NotRoundPlayer(uint256 roundId, address caller);
    error CashOutAlreadyRequested(uint256 roundId);
    error CashOutTooLate(uint256 roundId, uint40 exitSec, uint40 endSec);
    error NotDecidable(uint256 roundId, uint40 missingSec);
    error NotVoidable(uint256 roundId, uint256 detail);

    uint40 public constant ENTRY_DELAY_SEC = 3;
    uint40 public constant EXIT_DELAY_SEC = 2;
    uint40 public constant STALL_AFTER_SEC = 60;

    StubCheckpointOracle[] internal _oracles;
    uint8 public activeOracleIdx;
    mapping(uint8 => AssetConfig) internal assets;
    mapping(uint8 => mapping(uint8 => Lane)) internal lanes;
    mapping(uint256 => Round) internal rounds;
    uint256 public nextRoundId = 1;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public activeRoundOf;

    function addOracle(address o) external {
        _oracles.push(StubCheckpointOracle(o));
        emit OracleAdded(uint8(_oracles.length - 1), o, bytes32("SUPRA_DORA2_PULL_V2"), false);
    }
    function oracles(uint256 idx) external view returns (address) { return address(_oracles[idx]); }
    function setAsset(uint8 assetId, AssetConfig calldata c) external { assets[assetId] = c; emit AssetConfigured(assetId, c); }
    function getAsset(uint8 assetId) external view returns (AssetConfig memory) { return assets[assetId]; }
    function setLane(uint8 assetId, uint8 tier, LaneParams calldata p) external {
        Lane storage l = lanes[assetId][tier];
        l.p = p; l.version += 1;
        emit LaneConfigured(assetId, tier, l.version, p);
    }
    function getLane(uint8 assetId, uint8 tier) external view returns (Lane memory) { return lanes[assetId][tier]; }
    function deposit(uint256 amount) external { balanceOf[msg.sender] += amount; emit Deposited(msg.sender, msg.sender, amount); }
    function depositFor(address player, uint256 amount) external { balanceOf[player] += amount; emit Deposited(player, msg.sender, amount); }

    function openRound(uint8 assetId, uint8 tier, uint8 d, uint128 stake, uint32 laneVersion, uint8 oracleIdx) external returns (uint256 id) {
        AssetConfig memory a = assets[assetId];
        if (!a.enabled) revert AssetDisabled(assetId);
        Lane memory l = lanes[assetId][tier];
        if (!l.p.enabled) revert LaneDisabled(assetId, tier);
        if (l.version != laneVersion) revert LaneVersionMismatch(l.version, laneVersion);
        if (oracleIdx != activeOracleIdx) revert OracleMismatch(activeOracleIdx, oracleIdx);
        if (stake < l.p.minStake || stake > l.p.maxStake) revert StakeOutOfRange(stake, l.p.minStake, l.p.maxStake);
        if (balanceOf[msg.sender] < stake) revert InsufficientBalance(stake, balanceOf[msg.sender]);
        if (activeRoundOf[msg.sender] != 0) revert PlayerHasOpenRound(activeRoundOf[msg.sender]);
        uint40 entrySec = uint40(block.timestamp) + ENTRY_DELAY_SEC;
        uint40 known = _oracles[oracleIdx].latestKnownSec(a.pairId);
        if (entrySec <= known) revert EntryNotInFuture(entrySec, known);
        id = nextRoundId++;
        Round storage r = rounds[id];
        r.player = msg.sender; r.assetId = assetId; r.tier = tier; r.direction = d; r.status = 1; r.oracleIdx = oracleIdx;
        r.entrySec = entrySec; r.stake = stake; r.maxPayout = uint128(uint256(stake) * l.p.multiplierBps / 1e4);
        r.targetPpm = l.p.targetPpm; r.stopPpm = l.p.stopPpm; r.multiplierBps = l.p.multiplierBps; r.feeBps = l.p.feeBps;
        r.maxJumpPpm = a.maxJumpPpm; r.pairId = a.pairId; r.endSec = entrySec + l.p.durationSec; r.openedAt = uint40(block.timestamp);
        balanceOf[msg.sender] -= stake;
        activeRoundOf[msg.sender] = id;
        emit RoundOpened(id, msg.sender, assetId, RoundTerms(tier, d, stake, r.maxPayout, entrySec, r.endSec, laneVersion, oracleIdx, a.pairId, r.targetPpm, r.stopPpm, r.multiplierBps, r.feeBps, r.maxJumpPpm));
    }

    function requestCashOut(uint256 id) external returns (uint40 exitSec) {
        Round storage r = rounds[id];
        if (r.status != 1) revert RoundNotOpen(id);
        if (r.player != msg.sender) revert NotRoundPlayer(id, msg.sender);
        if (r.cashOutRequested) revert CashOutAlreadyRequested(id);
        exitSec = uint40(block.timestamp) + EXIT_DELAY_SEC;
        if (exitSec < r.entrySec + 1) exitSec = r.entrySec + 1;
        uint40 known = _oracles[r.oracleIdx].latestKnownSec(r.pairId);
        if (exitSec <= known) revert ExitNotInFuture(exitSec, known);
        if (exitSec >= r.endSec) revert CashOutTooLate(id, exitSec, r.endSec);
        r.endSec = exitSec; r.cashOutRequested = true;
        emit CashOutRequested(id, msg.sender, uint40(block.timestamp), exitSec);
    }

    function _eval(uint256 id) internal view returns (Eval memory e) {
        Round storage r = rounds[id];
        Checkpoint[] memory cp = _oracles[r.oracleIdx].getRange(r.pairId, r.entrySec, r.endSec);
        if (cp[0].flags & 1 == 0) return _missing(r, r.entrySec, 0);
        if (cp[0].flags & 2 != 0) { e.decidable = true; e.outcome = 5; e.payout = r.stake; e.decisionSec = r.entrySec; e.voidReason = 1; return e; }
        uint256 p0 = cp[0].price18;
        uint256 prev = p0;
        for (uint40 s = r.entrySec + 1; s <= r.endSec; s++) {
            Checkpoint memory c = cp[s - r.entrySec];
            if (c.flags & 1 == 0) return _missing(r, s, p0);
            uint256 p = c.price18;
            uint256 jmp = p >= prev ? p - prev : prev - p;
            bool valid = c.flags & 2 == 0 && jmp * 1e6 <= uint256(r.maxJumpPpm) * prev;
            prev = p;
            bool terminal = s == r.endSec;
            if (!valid) {
                if (terminal) { e.decidable = true; e.outcome = 5; e.payout = r.stake; e.decisionSec = s; e.voidReason = 2; e.p0 = p0; return e; }
                continue;
            }
            bool fav; uint256 mag;
            if (p >= p0) { mag = p - p0; fav = r.direction == 0 || mag == 0; } else { mag = p0 - p; fav = r.direction == 1; }
            e.p0 = p0; e.exitPrice = p; e.decisionSec = s;
            if (fav && mag * 1e6 >= uint256(r.targetPpm) * p0) { e.decidable = true; e.outcome = 1; e.payout = r.maxPayout; return e; }
            if (!fav && mag * 1e6 >= uint256(r.stopPpm) * p0) { e.decidable = true; e.outcome = 2; e.payout = 0; return e; }
            if (terminal) {
                e.decidable = true; e.outcome = r.cashOutRequested ? 4 : 3;
                uint256 keep = 1e4 - r.feeBps;
                if (fav) {
                    uint256 den = p0 * r.targetPpm;
                    uint256 num = 1e4 * den + (uint256(r.multiplierBps) - 1e4) * mag * 1e6;
                    e.payout = uint256(r.stake) * (num * keep) / (den * 1e8);
                } else {
                    uint256 d = p0 * r.stopPpm;
                    e.payout = uint256(r.stake) * ((d - mag * 1e6) * keep) / (d * 1e4);
                }
                return e;
            }
        }
        revert("unreachable");
    }

    function _missing(Round storage r, uint40 s, uint256 p0) internal view returns (Eval memory e) {
        if (block.timestamp > uint256(r.endSec) + STALL_AFTER_SEC) { e.decidable = true; e.outcome = 5; e.payout = r.stake; e.decisionSec = s; e.voidReason = 4; e.p0 = p0; return e; }
        e.missingSec = s;
    }

    function _finalize(uint256 id, Eval memory e) internal {
        Round storage r = rounds[id];
        r.status = 2; r.outcome = e.outcome; r.payout = uint128(e.payout); r.decisionSec = e.decisionSec; r.voidReason = e.voidReason;
        balanceOf[r.player] += e.payout;
        activeRoundOf[r.player] = 0;
        emit RoundSettled(id, r.player, e.outcome, e.payout, int256(e.payout) - int256(uint256(r.stake)), e.p0, e.outcome == 5 ? 0 : e.exitPrice, e.decisionSec, e.voidReason);
    }

    function settle(uint256 id) external returns (uint8, uint256) {
        if (rounds[id].status != 1) revert RoundNotOpen(id);
        Eval memory e = _eval(id);
        if (!e.decidable) revert NotDecidable(id, e.missingSec);
        _finalize(id, e);
        return (e.outcome, e.payout);
    }

    function settleMany(uint256[] calldata ids) public {
        for (uint256 i; i < ids.length; ++i) {
            if (rounds[ids[i]].status != 1) continue;
            Eval memory e = _eval(ids[i]);
            if (e.decidable) _finalize(ids[i], e);
        }
    }

    function recordAndSettle(uint8 oracleIdx, bytes calldata proof, uint256[] calldata ids) external {
        _oracles[oracleIdx].record(proof);
        settleMany(ids);
    }

    function voidStale(uint256 id) external {
        if (rounds[id].status != 1) revert RoundNotOpen(id);
        Eval memory e = _eval(id);
        if (!e.decidable || e.outcome != 5) revert NotVoidable(id, uint256(rounds[id].endSec) + STALL_AFTER_SEC);
        _finalize(id, e);
    }

    function previewSettle(uint256 id) external view returns (bool decidable, uint8 outcome, uint256 payout, uint40 decisionSec, uint40 missingSec) {
        if (rounds[id].status != 1) return (false, 0, 0, 0, 0);
        Eval memory e = _eval(id);
        return (e.decidable, e.outcome, e.payout, e.decisionSec, e.missingSec);
    }

    function getRound(uint256 id) external view returns (Round memory) { return rounds[id]; }
}

// Mirrors the real TestUSDFaucet surface: drip(address) pays the configured amount.
contract StubFaucet {
    event Dripped(address indexed player, uint256 amount, uint256 totalDripped);
    StubArena public immutable arena;
    address public immutable operator;
    uint256 public constant dripAmount = 100e18;
    mapping(address => uint256) public totalDripped;
    constructor(StubArena a, address op) { arena = a; operator = op; }
    function drip(address player) external returns (uint256 amount) {
        require(msg.sender == operator, "operator");
        amount = dripAmount;
        totalDripped[player] += amount;
        arena.depositFor(player, amount);
        emit Dripped(player, amount, totalDripped[player]);
    }
}
