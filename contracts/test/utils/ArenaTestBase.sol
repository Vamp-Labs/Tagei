// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {CheckpointOracle} from "../../src/oracle/CheckpointOracle.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";
import {TestUSD} from "../../src/token/TestUSD.sol";
import {TestUSDFaucet} from "../../src/token/TestUSDFaucet.sol";
import {
    CashOutIntent,
    Direction,
    Lane,
    LaneParams,
    OpenRoundIntent,
    Round,
    WithdrawIntent
} from "../../src/types/ArenaTypes.sol";
import {ArenaSetup} from "../../script/lib/ArenaSetup.sol";
import {DeployConfig} from "../../script/lib/DeployConfig.sol";
import {MockCheckpointOracle} from "../mocks/MockCheckpointOracle.sol";
import {MockSupraCommitteeVerifier} from "../mocks/MockSupraCommitteeVerifier.sol";
import {SupraProofBuilder} from "./SupraProofBuilder.sol";

/// @notice Deploys the production wiring (ArenaSetup + config/97.json) against a mock Supra committee verifier, funds
/// the house with the configured seed and gives three players a ledger balance.
abstract contract ArenaTestBase is Test {
    uint40 internal constant T0 = 1_790_000_000;

    uint8 internal constant BNB = 0;
    uint8 internal constant BTC = 1;
    uint8 internal constant ETH = 2;
    uint8 internal constant SOL = 3;
    uint8 internal constant DOGE = 4;
    uint32 internal constant PAIR_BNB = 49;
    uint32 internal constant PAIR_BTC = 0;
    uint32 internal constant PAIR_ETH = 1;
    uint8 internal constant CRUISE = 0;
    uint8 internal constant BOOST = 1;
    uint8 internal constant HYPER = 2;
    uint8 internal constant WARP = 3;

    uint256 internal constant P0_BNB = 612e18;

    MockSupraCommitteeVerifier internal committee;
    BnbPlayArena internal arena;
    TestUSD internal token;
    CheckpointOracle internal oracle;
    CheckpointOracle internal signedOracle;
    TestUSDFaucet internal faucet;

    address internal deployer;
    address internal ops;
    address internal recorder;
    uint256 internal houseSeed;

    address internal alice;
    uint256 internal aliceKey;
    address internal bob;
    uint256 internal bobKey;
    address internal carol;
    uint256 internal carolKey;

    function setUp() public virtual {
        vm.warp(T0);
        DeployConfig.Config memory c = DeployConfig.load(DeployConfig.path(97));
        deployer = c.deployer;
        ops = c.ops;
        recorder = c.recorder;
        houseSeed = c.houseSeed;

        committee = new MockSupraCommitteeVerifier();
        vm.startPrank(deployer);
        ArenaSetup.Deployed memory d = ArenaSetup.deploy(c, deployer, committee);
        ArenaSetup.configure(d, c, deployer);
        d.token.mint(deployer, c.houseSeed);
        d.token.approve(address(d.arena), c.houseSeed);
        d.arena.fundHouse(c.houseSeed);
        vm.stopPrank();

        arena = d.arena;
        token = d.token;
        oracle = d.oracle;
        signedOracle = d.signedOracle;
        faucet = d.faucet;

        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (carol, carolKey) = makeAddrAndKey("carol");
        _fund(alice, 1_000e18);
        _fund(bob, 1_000e18);
        _fund(carol, 1_000e18);
    }

    // ── ledger ──────────────────────────────────────────────────────────────────

    function _mint(address to, uint256 amount) internal {
        vm.prank(deployer);
        token.mint(to, amount);
    }

    function _fund(address player, uint256 amount) internal {
        _mint(player, amount);
        vm.startPrank(player);
        token.approve(address(arena), amount);
        arena.deposit(amount);
        vm.stopPrank();
    }

    // ── rounds ──────────────────────────────────────────────────────────────────

    function _version(uint8 assetId, uint8 tier) internal view returns (uint32) {
        return arena.getLane(assetId, tier).version;
    }

    function _open(address player, uint8 assetId, uint8 tier, Direction dir, uint128 stake)
        internal
        returns (uint256 roundId)
    {
        uint32 v = _version(assetId, tier);
        uint8 idx = arena.activeOracleIdx();
        vm.prank(player);
        roundId = arena.openRound(assetId, tier, dir, stake, v, idx);
    }

    function _openIntent(address player, uint8 assetId, uint8 tier, Direction dir, uint128 stake)
        internal
        view
        returns (OpenRoundIntent memory i)
    {
        i = OpenRoundIntent({
            player: player,
            assetId: assetId,
            tier: tier,
            direction: dir,
            stake: stake,
            laneVersion: _version(assetId, tier),
            oracleIdx: arena.activeOracleIdx(),
            nonce: arena.nonces(player, 0),
            deadline: uint48(vm.getBlockTimestamp() + 5)
        });
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signOpen(uint256 key, OpenRoundIntent memory i) internal view returns (bytes memory) {
        return _sign(key, arena.hashOpenRound(i));
    }

    function _signCashOut(uint256 key, CashOutIntent memory c) internal view returns (bytes memory) {
        return _sign(key, arena.hashCashOut(c));
    }

    function _signWithdraw(uint256 key, WithdrawIntent memory w) internal view returns (bytes memory) {
        return _sign(key, arena.hashWithdraw(w));
    }

    function _setLane(uint8 assetId, uint8 tier, LaneParams memory p) internal {
        vm.prank(deployer);
        arena.setLane(assetId, tier, p);
    }

    function _lane(uint8 assetId, uint8 tier) internal view returns (LaneParams memory) {
        Lane memory l = arena.getLane(assetId, tier);
        return l.p;
    }

    // ── oracle ──────────────────────────────────────────────────────────────────

    /// @dev Registers a scriptable oracle and makes it active for new rounds.
    function _useMock(bool late) internal returns (MockCheckpointOracle m) {
        m = new MockCheckpointOracle(late);
        vm.startPrank(deployer);
        arena.addOracle(m);
        arena.setActiveOracle(uint8(arena.oracleCount() - 1));
        vm.stopPrank();
    }

    function _proof(uint32 pair, uint40 sec, uint256 price) internal returns (bytes memory) {
        return SupraProofBuilder.single(committee, pair, uint128(price), sec);
    }

    /// @dev Records one checkpoint through the real StatelessSupraVerifier (respects the 3 s future bound).
    function _record(uint32 pair, uint40 sec, uint256 price) internal {
        oracle.record(_proof(pair, sec, price));
    }

    /// @dev Records prices[k] at second fromSec + k (null entries = 0 are skipped). Warps forward if needed.
    function _recordPath(uint32 pair, uint40 fromSec, uint256[] memory prices) internal {
        uint256 lastSec = uint256(fromSec) + prices.length - 1;
        if (vm.getBlockTimestamp() + 3 < lastSec) vm.warp(lastSec - 3);
        for (uint256 k; k < prices.length; ++k) {
            if (prices[k] != 0) _record(pair, fromSec + uint40(k), prices[k]);
        }
    }

    /// @dev p0 moved by `ppm` (signed), floored.
    function _px(uint256 p0, int256 ppm) internal pure returns (uint256) {
        if (ppm >= 0) return p0 + (p0 * uint256(ppm)) / 1e6;
        return p0 - (p0 * uint256(-ppm)) / 1e6;
    }

    /// @dev Smallest move that satisfies an inclusive `ppm` barrier (lane.ts barrierMove).
    function _barrierMove(uint256 p0, uint256 ppm) internal pure returns (uint256) {
        return (ppm * p0 + 1e6 - 1) / 1e6;
    }

    function _flat(uint256 p0, uint256 n) internal pure returns (uint256[] memory prices) {
        prices = new uint256[](n);
        for (uint256 k; k < n; ++k) {
            prices[k] = p0;
        }
    }

    function _round(uint256 id) internal view returns (Round memory) {
        return arena.getRound(id);
    }

    /// @dev Sum of the four ledger buckets plus surplus equals the token balance (invariant 1).
    function _assertLedger() internal view {
        assertEq(
            token.balanceOf(address(arena)),
            arena.totalPlayerBalances() + arena.houseFree() + arena.houseReserved() + arena.stakesLocked()
                + arena.surplus(),
            "ledger conservation"
        );
    }

    function _feeds5(uint64 roundMs, uint128[5] memory prices)
        internal
        pure
        returns (SupraProofV2.CommitteeFeed[] memory feeds)
    {
        uint32[] memory ps = SupraProofBuilder.pairs();
        feeds = new SupraProofV2.CommitteeFeed[](5);
        for (uint256 i; i < 5; ++i) {
            feeds[i] = SupraProofBuilder.feed(ps[i], prices[i], roundMs);
        }
    }
}
