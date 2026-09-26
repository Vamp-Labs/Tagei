// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {NoncesKeyed} from "@openzeppelin/contracts/utils/NoncesKeyed.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IBnbPlayArena} from "./interfaces/IBnbPlayArena.sol";
import {Intents} from "./libraries/Intents.sol";
import {LaneMath} from "./libraries/LaneMath.sol";
import {ICheckpointOracle} from "./oracle/interfaces/ICheckpointOracle.sol";
import {IPriceVerifier} from "./oracle/interfaces/IPriceVerifier.sol";
import {
    AssetConfig,
    CashOutIntent,
    Direction,
    Lane,
    LaneParams,
    OpenRoundIntent,
    Outcome,
    Round,
    RoundStatus,
    RoundTerms,
    TuneBounds,
    VoidReason,
    WithdrawIntent
} from "./types/ArenaTypes.sol";

/// @title BnbPlayArena
/// @notice Ledger, house pool, versioned lanes and rounds for BNB PLAY (F1a v2).
/// A player commits without a price: the entry is the oracle checkpoint at `block.timestamp + 3`. Settlement replays
/// the full recorded path from `CheckpointOracle`; the first barrier touched wins, otherwise the terminal second pays
/// the interior curve. Missing data voids the round (stake refunded) only when it is provably permanent or the round
/// stalled. Settlement, recording, cash-out and withdrawals are permissionless and never paused; admins configure new
/// rounds only and can never touch open rounds or player balances. Every rounding favours the house.
/// Roles: CONFIG (cold key: oracles, limits, assets, lanes, tune bounds), LANE_TUNER (hot adaptive-lanes job: T/S only,
/// inside admin bounds), PAUSER (opens only), TREASURY (houseFree only), DEFAULT_ADMIN (roles, unpause).
/// @dev `_evaluate` mirrors `evaluatePath` in packages/shared/src/path.ts bit for bit.
contract BnbPlayArena is IBnbPlayArena, AccessControl, Pausable, ReentrancyGuardTransient, EIP712, NoncesKeyed {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant LANE_TUNER_ROLE = keccak256("LANE_TUNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    uint40 public constant ENTRY_DELAY_SEC = 3;
    uint40 public constant EXIT_DELAY_SEC = 2;
    uint40 public constant STALL_AFTER_SEC = 60;
    uint256 public constant MAX_RANGE = 256;
    uint256 public constant MAX_IDS = 100;
    uint8 public constant MAX_TIERS = 4;
    uint192 public constant NONCE_KEY_OPEN = 0;
    uint192 public constant NONCE_KEY_WITHDRAW = 1;
    uint192 public constant NONCE_KEY_SESSION = 2;
    /// @notice Gas `voidStale` must have left before probing the oracle, so a failed probe can never be an induced
    /// out-of-gas: the probe gets 63/64 of it (~1.48M) while the worst honest evaluation, a cold 121-second path,
    /// needs ~0.37M (test_voidStale_gasFloorMargin): ~4x headroom.
    uint256 public constant VOID_STALE_MIN_GAS = 1_500_000;

    uint256 private constant BPS = 10_000;
    uint8 private constant FLAG_RECORDED = 1;
    uint8 private constant FLAG_DISPUTED = 2;

    struct Evaluation {
        bool decidable;
        Outcome outcome;
        VoidReason voidReason;
        uint40 decisionSec;
        uint40 missingSec;
        uint256 payout;
        uint256 entryPrice;
        uint256 exitPrice;
    }

    IERC20 public immutable token;

    // Ledger buckets (two slots). token.balanceOf(this) == sum of the four + surplus().
    uint128 private _houseFree;
    uint128 private _houseReserved;
    uint128 private _stakesLocked;
    uint128 private _totalPlayerBalances;

    // Config for new rounds (one slot).
    uint8 public activeOracleIdx;
    uint16 public maxUtilizationBps;
    uint128 public maxPayoutPerRound;

    uint256 public roundCount;

    mapping(address player => uint256) public balanceOf;
    mapping(address player => uint256) public activeRoundOf;
    mapping(uint8 assetId => AssetConfig) private _assets;
    mapping(uint8 assetId => mapping(uint8 tier => Lane)) private _lanes;
    mapping(uint256 roundId => Round) private _rounds;
    mapping(uint8 assetId => mapping(uint8 tier => TuneBounds)) private _tuneBounds;
    ICheckpointOracle[] private _oracles;

    error InsufficientGas();

    constructor(IERC20 token_, address admin) EIP712("BnbPlayArena", "1") {
        if (address(token_) == address(0) || admin == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Ledger
    // ═════════════════════════════════════════════════════════════════════════════

    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, msg.sender, amount);
    }

    function depositFor(address player, uint256 amount) external nonReentrant {
        if (player == address(0)) revert ZeroAddress();
        _deposit(player, msg.sender, amount);
    }

    /// @notice Consumes the withdraw nonce (key 1), which cancels any pending signed withdrawal.
    function withdraw(address to, uint256 amount) external nonReentrant {
        _useNonce(msg.sender, NONCE_KEY_WITHDRAW);
        _withdraw(msg.sender, to, amount);
    }

    function withdrawWithSig(WithdrawIntent calldata w, bytes calldata sig) external nonReentrant {
        if (block.timestamp > w.deadline) revert IntentExpired(w.deadline);
        if (!_isValidSig(w.player, hashWithdraw(w), sig)) revert InvalidSignature();
        _useKeyedNonce(w.player, NONCE_KEY_WITHDRAW, w.nonce);
        _withdraw(w.player, w.to, w.amount);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Rounds
    // ═════════════════════════════════════════════════════════════════════════════

    function openRound(uint8 assetId, uint8 tier, Direction d, uint128 stake, uint32 laneVersion, uint8 oracleIdx)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 roundId)
    {
        _useNonce(msg.sender, NONCE_KEY_OPEN);
        return _open(msg.sender, assetId, tier, d, stake, laneVersion, oracleIdx);
    }

    function openRoundWithSig(OpenRoundIntent calldata i, bytes calldata sig)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 roundId)
    {
        if (block.timestamp > i.deadline) revert IntentExpired(i.deadline);
        if (!_isValidSig(i.player, hashOpenRound(i), sig)) revert InvalidSignature();
        _useKeyedNonce(i.player, NONCE_KEY_OPEN, i.nonce);
        return _open(i.player, i.assetId, i.tier, i.direction, i.stake, i.laneVersion, i.oracleIdx);
    }

    function requestCashOut(uint256 roundId) external nonReentrant returns (uint40 exitSec) {
        return _requestCashOut(roundId, msg.sender);
    }

    function requestCashOutWithSig(CashOutIntent calldata c, bytes calldata sig)
        external
        nonReentrant
        returns (uint40 exitSec)
    {
        if (block.timestamp > c.deadline) revert IntentExpired(c.deadline);
        if (!_isValidSig(c.player, hashCashOut(c), sig)) revert InvalidSignature();
        return _requestCashOut(c.roundId, c.player);
    }

    function settle(uint256 roundId) external nonReentrant returns (Outcome outcome, uint256 payout) {
        if (_rounds[roundId].status != RoundStatus.Open) revert RoundNotOpen(roundId);
        Evaluation memory e = _settleIfDecidable(roundId);
        if (!e.decidable) revert NotDecidable(roundId, e.missingSec);
        return (e.outcome, e.payout);
    }

    function settleMany(uint256[] calldata roundIds) external nonReentrant {
        _settleMany(roundIds);
    }

    function recordAndSettle(uint8 oracleIdx, bytes calldata proof, uint256[] calldata roundIds)
        external
        nonReentrant
    {
        if (oracleIdx >= _oracles.length) revert InvalidOracle(oracleIdx);
        _oracles[oracleIdx].record(proof);
        _settleMany(roundIds);
    }

    function voidStale(uint256 roundId) external nonReentrant {
        Round storage s = _rounds[roundId];
        if (s.status != RoundStatus.Open) revert RoundNotOpen(roundId);
        Round memory r = s;
        uint256 voidableAfter = uint256(r.endSec) + STALL_AFTER_SEC;
        if (gasleft() < VOID_STALE_MIN_GAS) revert InsufficientGas();
        Evaluation memory e;
        try this.previewSettle(roundId) returns (bool decidable, Outcome outcome, uint256, uint40, uint40) {
            if (!decidable) revert NotVoidable(roundId, voidableAfter);
            if (outcome != Outcome.Voided) revert NotVoidable(roundId, 0);
            e = _evaluate(r);
        } catch {
            // The oracle can no longer be read (e.g. a rotated upstream now reverts): refund once stalled.
            if (block.timestamp <= voidableAfter) revert NotVoidable(roundId, voidableAfter);
            e = _voided(VoidReason.Stalled, r.stake, r.entrySec, 0);
        }
        _finalize(roundId, s, r, e);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Views
    // ═════════════════════════════════════════════════════════════════════════════

    function previewSettle(uint256 roundId)
        external
        view
        returns (bool decidable, Outcome outcome, uint256 payout, uint40 decisionSec, uint40 missingSec)
    {
        Round memory r = _rounds[roundId];
        if (r.status == RoundStatus.Settled) return (true, r.outcome, r.payout, r.decisionSec, 0);
        if (r.status != RoundStatus.Open) revert RoundNotOpen(roundId);
        Evaluation memory e = _evaluate(r);
        return (e.decidable, e.outcome, e.payout, e.decisionSec, e.missingSec);
    }

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function quoteMaxPayout(uint8 assetId, uint8 tier, uint128 stake) external view returns (uint256) {
        return LaneMath.maxPayout(stake, _lanes[assetId][tier].p.multiplierBps);
    }

    function hashOpenRound(OpenRoundIntent calldata i) public view returns (bytes32) {
        return _hashTypedDataV4(Intents.hash(i));
    }

    function hashCashOut(CashOutIntent calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(Intents.hash(c));
    }

    function hashWithdraw(WithdrawIntent calldata w) public view returns (bytes32) {
        return _hashTypedDataV4(Intents.hash(w));
    }

    /// @notice ERC-5267, identical output to OZ's but with constant strings (saves runtime bytecode).
    function eip712Domain()
        public
        view
        override
        returns (bytes1, string memory, string memory, uint256, address, bytes32, uint256[] memory)
    {
        return (hex"0f", "BnbPlayArena", "1", block.chainid, address(this), bytes32(0), new uint256[](0));
    }

    function nonces(address owner, uint192 key) public view override(IBnbPlayArena, NoncesKeyed) returns (uint256) {
        return super.nonces(owner, key);
    }

    function getAsset(uint8 assetId) external view returns (AssetConfig memory) {
        return _assets[assetId];
    }

    function getLane(uint8 assetId, uint8 tier) external view returns (Lane memory) {
        return _lanes[assetId][tier];
    }

    function getLaneTuneBounds(uint8 assetId, uint8 tier) external view returns (TuneBounds memory) {
        return _tuneBounds[assetId][tier];
    }

    function oracles(uint256 idx) external view returns (ICheckpointOracle) {
        return _oracles[idx];
    }

    function oracleCount() external view returns (uint256) {
        return _oracles.length;
    }

    function houseFree() external view returns (uint256) {
        return _houseFree;
    }

    function houseReserved() external view returns (uint256) {
        return _houseReserved;
    }

    function stakesLocked() external view returns (uint256) {
        return _stakesLocked;
    }

    function totalPlayerBalances() external view returns (uint256) {
        return _totalPlayerBalances;
    }

    /// @notice Tokens held beyond the four ledger buckets (direct donations); `skim` moves them to the house.
    function surplus() public view returns (uint256) {
        uint256 held = token.balanceOf(address(this));
        uint256 accounted = uint256(_houseFree) + _houseReserved + _stakesLocked + _totalPlayerBalances;
        return held > accounted ? held - accounted : 0;
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // House & config
    // ═════════════════════════════════════════════════════════════════════════════

    function fundHouse(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _houseFree += amount.toUint128();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit HouseFunded(msg.sender, amount);
    }

    function withdrawHouse(address to, uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 free = _houseFree;
        if (amount > free) revert InsufficientHouseLiquidity(free, amount);
        _houseFree = uint128(free - amount);
        token.safeTransfer(to, amount);
        emit HouseWithdrawn(to, amount);
    }

    function skim() external nonReentrant {
        uint256 amount = surplus();
        if (amount == 0) return;
        _houseFree += amount.toUint128();
        emit Skimmed(amount);
    }

    /// @notice Re-checks the house-edge guard of every enabled lane of the asset against the new gap margin and bumps
    /// the version of every configured lane, so intents signed against the old pair / jump filter cannot open.
    function setAsset(uint8 assetId, AssetConfig calldata c) external onlyRole(CONFIG_ROLE) {
        if (c.maxJumpPpm == 0 || c.maxJumpPpm > LaneMath.PPM || c.gapMarginPpm > LaneMath.MAX_BARRIER_PPM) {
            revert InvalidAsset();
        }
        _assets[assetId] = c;
        emit AssetConfigured(assetId, c);
        for (uint8 t; t < MAX_TIERS; ++t) {
            Lane storage lane = _lanes[assetId][t];
            if (lane.version == 0) continue;
            LaneParams memory p = lane.p;
            if (p.enabled && !LaneMath.laneEdgeGuardOk(p.targetPpm, p.stopPpm, p.multiplierBps, c.gapMarginPpm)) {
                revert HouseEdgeViolated();
            }
            uint32 version = lane.version + 1;
            lane.version = version;
            emit LaneConfigured(assetId, t, version, p);
        }
    }

    /// @notice Validates the lane (F1a §5-6) and bumps its version; open rounds keep their snapshot.
    function setLane(uint8 assetId, uint8 tier, LaneParams calldata p) external onlyRole(CONFIG_ROLE) {
        _writeLane(assetId, tier, p);
    }

    function setLaneTuneBounds(
        uint8 assetId,
        uint8 tier,
        uint32 minTargetPpm,
        uint32 maxTargetPpm,
        uint32 minStopPpm,
        uint32 maxStopPpm
    ) external onlyRole(CONFIG_ROLE) {
        // No range checks needed: every tuned lane still goes through checkLane (ranges + house-edge guard), so a
        // malformed window can only make tuning impossible.
        TuneBounds memory b = TuneBounds(minTargetPpm, maxTargetPpm, minStopPpm, maxStopPpm);
        _tuneBounds[assetId][tier] = b;
        emit LaneTuneBoundsSet(assetId, tier, b);
    }

    /// @notice The adaptive-lanes job: T and S only, within the tune bounds and the house-edge guard. Unset bounds
    /// (all zero) reject every call; `enabled`, M, fee, duration and stakes are never touched.
    function tuneLane(uint8 assetId, uint8 tier, uint32 targetPpm, uint32 stopPpm)
        external
        onlyRole(LANE_TUNER_ROLE)
    {
        TuneBounds memory b = _tuneBounds[assetId][tier];
        if (
            targetPpm < b.minTargetPpm || targetPpm > b.maxTargetPpm || stopPpm < b.minStopPpm
                || stopPpm > b.maxStopPpm
        ) revert TuneOutOfBounds(targetPpm, stopPpm);
        Lane storage lane = _lanes[assetId][tier];
        if (lane.version == 0) revert InvalidLane();
        LaneParams memory p = lane.p;
        p.targetPpm = targetPpm;
        p.stopPpm = stopPpm;
        _writeLane(assetId, tier, p);
    }

    function setLimits(uint16 maxUtilizationBps_, uint128 maxPayoutPerRound_) external onlyRole(CONFIG_ROLE) {
        if (maxUtilizationBps_ > BPS) revert InvalidLimits();
        maxUtilizationBps = maxUtilizationBps_;
        maxPayoutPerRound = maxPayoutPerRound_;
        emit LimitsUpdated(maxUtilizationBps_, maxPayoutPerRound_);
    }

    /// @notice Append-only registry; the new oracle is used only after `setActiveOracle`.
    function addOracle(ICheckpointOracle o) external onlyRole(CONFIG_ROLE) {
        uint256 idx = _oracles.length;
        if (address(o) == address(0) || idx > type(uint8).max) revert InvalidOracle(idx);
        IPriceVerifier v = o.verifier();
        _oracles.push(o);
        emit OracleAdded(uint8(idx), address(o), v.sourceId(), v.isTrusted());
    }

    /// @notice Affects new rounds only.
    function setActiveOracle(uint8 idx) external onlyRole(CONFIG_ROLE) {
        if (idx >= _oracles.length) revert InvalidOracle(idx);
        activeOracleIdx = idx;
        emit ActiveOracleSet(idx);
    }

    /// @notice Blocks new opens only.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Internals — ledger
    // ═════════════════════════════════════════════════════════════════════════════

    function _deposit(address player, address from, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        balanceOf[player] += amount;
        _totalPlayerBalances += amount.toUint128();
        token.safeTransferFrom(from, address(this), amount);
        emit Deposited(player, from, amount);
    }

    function _withdraw(address player, address to, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[player];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        balanceOf[player] = bal - amount;
        _totalPlayerBalances -= uint128(amount);
        token.safeTransfer(to, amount);
        emit Withdrawn(player, to, amount);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Internals — open & cash-out
    // ═════════════════════════════════════════════════════════════════════════════

    function _open(
        address player,
        uint8 assetId,
        uint8 tier,
        Direction direction,
        uint128 stake,
        uint32 laneVersion,
        uint8 oracleIdx
    ) private returns (uint256 roundId) {
        Round memory r;
        r.player = player;
        r.assetId = assetId;
        r.tier = tier;
        r.direction = direction;
        r.status = RoundStatus.Open;
        r.oracleIdx = oracleIdx;
        r.stake = stake;
        {
            (AssetConfig memory asset, LaneParams memory p) =
                _checkTerms(assetId, tier, stake, laneVersion, oracleIdx);
            _debit(player, stake);
            r.maxPayout = _reserve(stake, p.multiplierBps);

            uint40 entrySec = uint40(block.timestamp) + ENTRY_DELAY_SEC;
            uint40 known = _oracles[oracleIdx].latestKnownSec(asset.pairId);
            if (entrySec <= known) revert EntryNotInFuture(entrySec, known);

            r.entrySec = entrySec;
            r.endSec = entrySec + p.durationSec;
            r.targetPpm = p.targetPpm;
            r.stopPpm = p.stopPpm;
            r.multiplierBps = p.multiplierBps;
            r.feeBps = p.feeBps;
            r.maxJumpPpm = asset.maxJumpPpm;
            r.pairId = asset.pairId;
        }
        r.openedAt = uint40(block.timestamp);

        roundId = ++roundCount;
        _rounds[roundId] = r;
        activeRoundOf[player] = roundId;
        emit RoundOpened(roundId, player, assetId, _terms(r, laneVersion));
    }

    function _terms(Round memory r, uint32 laneVersion) private pure returns (RoundTerms memory t) {
        t.tier = r.tier;
        t.direction = r.direction;
        t.stake = r.stake;
        t.maxPayout = r.maxPayout;
        t.entrySec = r.entrySec;
        t.endSec = r.endSec;
        t.laneVersion = laneVersion;
        t.oracleIdx = r.oracleIdx;
        t.pairId = r.pairId;
        t.targetPpm = r.targetPpm;
        t.stopPpm = r.stopPpm;
        t.multiplierBps = r.multiplierBps;
        t.feeBps = r.feeBps;
        t.maxJumpPpm = r.maxJumpPpm;
    }

    function _writeLane(uint8 assetId, uint8 tier, LaneParams memory p) private {
        if (tier >= MAX_TIERS) revert InvalidLane();
        uint8 status = LaneMath.checkLane(p, _assets[assetId].gapMarginPpm);
        if (status == LaneMath.LANE_INVALID) revert InvalidLane();
        if (status == LaneMath.LANE_HOUSE_EDGE) revert HouseEdgeViolated();
        Lane storage lane = _lanes[assetId][tier];
        uint32 version = lane.version + 1;
        lane.p = p;
        lane.version = version;
        emit LaneConfigured(assetId, tier, version, p);
    }

    function _checkTerms(uint8 assetId, uint8 tier, uint128 stake, uint32 laneVersion, uint8 oracleIdx)
        private
        view
        returns (AssetConfig memory asset, LaneParams memory p)
    {
        asset = _assets[assetId];
        if (!asset.enabled) revert AssetDisabled(assetId);
        Lane storage lane = _lanes[assetId][tier];
        p = lane.p;
        if (!p.enabled) revert LaneDisabled(assetId, tier);
        uint32 version = lane.version;
        if (laneVersion != version) revert LaneVersionMismatch(version, laneVersion);
        uint8 active = activeOracleIdx;
        if (oracleIdx != active || oracleIdx >= _oracles.length) revert OracleMismatch(active, oracleIdx);
        if (stake < p.minStake || stake > p.maxStake) revert StakeOutOfRange(stake, p.minStake, p.maxStake);
    }

    function _debit(address player, uint128 stake) private {
        uint256 active = activeRoundOf[player];
        if (active != 0) revert PlayerHasOpenRound(active);
        uint256 bal = balanceOf[player];
        if (bal < stake) revert InsufficientBalance(bal, stake);
        balanceOf[player] = bal - stake;
        _totalPlayerBalances -= stake;
        _stakesLocked += stake;
    }

    /// @dev Moves `maxPayout - stake` from free to reserved under the per-round and utilisation caps.
    function _reserve(uint128 stake, uint32 multiplierBps) private returns (uint128 maxP) {
        uint256 maxPayout = LaneMath.maxPayout(stake, multiplierBps);
        uint256 limit = maxPayoutPerRound;
        if (maxPayout > limit) revert MaxPayoutExceeded(maxPayout, limit);
        maxP = uint128(maxPayout);
        uint128 reserve = maxP - stake;
        uint128 free = _houseFree;
        if (reserve > free) revert InsufficientHouseLiquidity(free, reserve);
        uint128 reserved = _houseReserved;
        uint256 reservedAfter = uint256(reserved) + reserve;
        uint256 house = uint256(free) + reserved;
        if (reservedAfter * BPS > uint256(maxUtilizationBps) * house) {
            revert UtilizationCapExceeded(reservedAfter, (uint256(maxUtilizationBps) * house) / BPS);
        }
        _houseFree = free - reserve;
        _houseReserved = uint128(reservedAfter);
    }

    function _requestCashOut(uint256 roundId, address player) private returns (uint40 exitSec) {
        Round storage r = _rounds[roundId];
        if (r.status != RoundStatus.Open) revert RoundNotOpen(roundId);
        if (r.player != player) revert NotRoundPlayer(roundId, player);
        if (r.cashOutRequested) revert CashOutAlreadyRequested(roundId);
        uint40 nowSec = uint40(block.timestamp);
        uint40 entrySec = r.entrySec;
        uint40 endSec = r.endSec;
        exitSec = nowSec + EXIT_DELAY_SEC;
        if (exitSec <= entrySec) exitSec = entrySec + 1;
        if (exitSec >= endSec) revert CashOutTooLate(roundId, exitSec, endSec);
        uint40 known = _oracles[r.oracleIdx].latestKnownSec(r.pairId);
        if (exitSec <= known) revert ExitNotInFuture(exitSec, known);
        r.endSec = exitSec;
        r.cashOutRequested = true;
        emit CashOutRequested(roundId, player, nowSec, exitSec);
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Internals — settlement (mirror of path.ts `evaluatePath`)
    // ═════════════════════════════════════════════════════════════════════════════

    /// @dev Fault-isolated: each round settles in its own self-call, so one reverting round (e.g. an unreadable
    /// oracle) is skipped instead of reverting the batch or the preceding `record`.
    function _settleMany(uint256[] calldata roundIds) private {
        uint256 n = roundIds.length;
        if (n > MAX_IDS) revert TooManyIds(n, MAX_IDS);
        for (uint256 i; i < n; ++i) {
            uint256 roundId = roundIds[i];
            if (_rounds[roundId].status != RoundStatus.Open) continue;
            try this.settleFromBatch(roundId) {} catch {}
        }
    }

    /// @notice Internal step of settleMany / recordAndSettle; callable only by the Arena itself (inside their
    /// reentrancy lock). Settles `roundId` if it is decidable.
    function settleFromBatch(uint256 roundId) external {
        if (msg.sender != address(this)) revert OnlySelf();
        if (_rounds[roundId].status == RoundStatus.Open) _settleIfDecidable(roundId);
    }

    function _settleIfDecidable(uint256 roundId) private returns (Evaluation memory e) {
        Round storage s = _rounds[roundId];
        Round memory r = s;
        e = _evaluate(r);
        if (e.decidable) _finalize(roundId, s, r, e);
    }

    function _evaluate(Round memory r) internal view returns (Evaluation memory) {
        ICheckpointOracle oracle = _oracles[r.oracleIdx];
        ICheckpointOracle.Checkpoint[] memory cps = oracle.getRange(r.pairId, r.entrySec, r.endSec);

        ICheckpointOracle.Checkpoint memory entry = cps[0];
        if (entry.flags & FLAG_RECORDED == 0) return _onMissing(r, oracle, r.entrySec, 0);
        if (entry.flags & FLAG_DISPUTED != 0) return _voided(VoidReason.EntryInvalid, r.stake, r.entrySec, 0);

        uint256 p0 = entry.price18;
        uint256 prev = p0;
        uint256 last = cps.length - 1;
        for (uint256 k = 1; k <= last; ++k) {
            ICheckpointOracle.Checkpoint memory cp = cps[k];
            uint40 sec = r.entrySec + uint40(k);
            if (cp.flags & FLAG_RECORDED == 0) return _onMissing(r, oracle, sec, p0);

            // A DISPUTED second (two conflicting verified prices) voids the round: which price "happened" is unknowable,
            // so neither side may win on it (G1 L1). The terminal second keeps its original reason.
            if (cp.flags & FLAG_DISPUTED != 0) {
                return _voided(k == last ? VoidReason.TerminalInvalid : VoidReason.PathDisputed, r.stake, sec, p0);
            }
            bool valid = LaneMath.jumpOk(prev, cp.price18, r.maxJumpPpm);
            prev = cp.price18; // always advances, even past an invalid (jump) checkpoint
            if (!valid) {
                if (k == last) return _voided(VoidReason.TerminalInvalid, r.stake, sec, p0);
                continue;
            }

            Evaluation memory e = _step(r, p0, cp.price18, k == last);
            if (e.decidable) {
                e.decisionSec = sec;
                return e;
            }
        }
        // endSec > entrySec always holds (duration >= 5 s, exitSec >= entrySec + 1), so the loop always decides.
        revert NotDecidable(0, r.endSec);
    }

    /// @dev Barrier check at a valid checkpoint; the terminal second pays the interior curve.
    function _step(Round memory r, uint256 p0, uint256 price, bool terminal)
        private
        pure
        returns (Evaluation memory e)
    {
        (bool fav, uint256 mag) = LaneMath.directional(r.direction, p0, price);
        uint8 t = LaneMath.touch(fav, mag, p0, r.targetPpm, r.stopPpm);
        if (t == LaneMath.TOUCH_TARGET) {
            e.outcome = Outcome.TargetHit;
            e.payout = r.maxPayout;
        } else if (t == LaneMath.TOUCH_STOP) {
            e.outcome = Outcome.StopHit;
        } else if (terminal) {
            e.outcome = r.cashOutRequested ? Outcome.CashedOut : Outcome.Timeout;
            e.payout =
                LaneMath.interiorPayout(r.stake, fav, mag, p0, r.targetPpm, r.stopPpm, r.multiplierBps, r.feeBps);
        } else {
            return e;
        }
        e.decidable = true;
        e.entryPrice = p0;
        e.exitPrice = price;
    }

    function _onMissing(Round memory r, ICheckpointOracle oracle, uint40 sec, uint256 entryPrice)
        private
        view
        returns (Evaluation memory e)
    {
        if (oracle.isPermanentlyMissing(r.pairId, sec)) {
            return _voided(VoidReason.CheckpointGap, r.stake, sec, entryPrice);
        }
        if (block.timestamp > uint256(r.endSec) + STALL_AFTER_SEC) {
            return _voided(VoidReason.Stalled, r.stake, sec, entryPrice);
        }
        e.missingSec = sec;
        e.entryPrice = entryPrice;
    }

    function _voided(VoidReason reason, uint256 stake, uint40 sec, uint256 entryPrice)
        private
        pure
        returns (Evaluation memory e)
    {
        e.decidable = true;
        e.outcome = Outcome.Voided;
        e.voidReason = reason;
        e.decisionSec = sec;
        e.payout = stake;
        e.entryPrice = entryPrice;
    }

    function _finalize(uint256 roundId, Round storage s, Round memory r, Evaluation memory e) private {
        uint128 payout = uint128(e.payout);
        s.status = RoundStatus.Settled;
        s.outcome = e.outcome;
        s.payout = payout;
        s.decisionSec = e.decisionSec;
        s.voidReason = e.voidReason;

        _stakesLocked -= r.stake;
        _houseReserved -= r.maxPayout - r.stake;
        _houseFree += r.maxPayout - payout;
        balanceOf[r.player] += payout;
        _totalPlayerBalances += payout;
        delete activeRoundOf[r.player];

        emit RoundSettled(
            roundId,
            r.player,
            e.outcome,
            payout,
            int256(uint256(payout)) - int256(uint256(r.stake)),
            e.entryPrice,
            e.exitPrice,
            e.decisionSec,
            e.voidReason
        );
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // Internals — signatures & nonces
    // ═════════════════════════════════════════════════════════════════════════════

    /// @dev ECDSA first (EOAs and EIP-7702 accounts), then ERC-1271 via staticcall for contract accounts.
    function _isValidSig(address signer, bytes32 digest, bytes calldata sig) private view returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, sig);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        return signer.code.length != 0 && SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, sig);
    }

    /// @dev `keyNonce` is the packed `(key << 64) | sequence` value that `nonces(owner, key)` returns.
    function _useKeyedNonce(address owner, uint192 key, uint256 keyNonce) private {
        if (keyNonce >> 64 != key) revert InvalidAccountNonce(owner, nonces(owner, key));
        _useCheckedNonce(owner, keyNonce);
    }
}
