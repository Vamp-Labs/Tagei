// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IBnbPlayArena} from "../interfaces/IBnbPlayArena.sol";
import {TestUSD} from "./TestUSD.sol";

/// @title TestUSDFaucet
/// @notice Mints tUSD and credits it straight into a player's Arena ledger (`arena.depositFor`). Only the backend ops
/// key (`OPERATOR_ROLE`) drips; each address has a cooldown and a lifetime cap. The backend applies its own (stricter)
/// 24 h cooldown and IP limits (F1b); the on-chain values are a safety net.
contract TestUSDFaucet is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    struct Account {
        uint64 lastDripAt;
        uint192 total;
    }

    TestUSD public immutable token;
    IBnbPlayArena public immutable arena;

    uint128 public dripAmount;
    uint64 public cooldownSec;
    uint256 public maxPerAddress;

    mapping(address player => Account) public accounts;

    event Dripped(address indexed player, uint256 amount, uint256 totalDripped);
    event ParamsUpdated(uint128 dripAmount, uint64 cooldownSec, uint256 maxPerAddress);

    error CooldownActive(address player, uint256 availableAt);
    error CapReached(address player, uint256 dripped, uint256 cap);
    error InvalidParams();
    error ZeroAddress();

    constructor(
        TestUSD token_,
        IBnbPlayArena arena_,
        address admin,
        uint128 dripAmount_,
        uint64 cooldownSec_,
        uint256 maxPerAddress_
    ) {
        if (address(token_) == address(0) || address(arena_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        arena = arena_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setParams(dripAmount_, cooldownSec_, maxPerAddress_);
        token_.approve(address(arena_), type(uint256).max);
    }

    /// @notice Drips `dripAmount` into `player`'s Arena balance.
    function drip(address player) external onlyRole(OPERATOR_ROLE) returns (uint256 amount) {
        if (player == address(0)) revert ZeroAddress();
        Account memory a = accounts[player];
        if (a.lastDripAt != 0) {
            uint256 availableAt = uint256(a.lastDripAt) + cooldownSec;
            if (block.timestamp < availableAt) revert CooldownActive(player, availableAt);
        }
        amount = dripAmount;
        uint256 total = uint256(a.total) + amount;
        if (total > maxPerAddress) revert CapReached(player, a.total, maxPerAddress);
        accounts[player] = Account({lastDripAt: uint64(block.timestamp), total: uint192(total)});
        token.mint(address(this), amount);
        arena.depositFor(player, amount);
        emit Dripped(player, amount, total);
    }

    /// @notice Earliest timestamp at which `player` can receive the next drip (0 = now).
    function nextDripAt(address player) external view returns (uint256) {
        Account memory a = accounts[player];
        return a.lastDripAt == 0 ? 0 : uint256(a.lastDripAt) + cooldownSec;
    }

    function setParams(uint128 dripAmount_, uint64 cooldownSec_, uint256 maxPerAddress_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setParams(dripAmount_, cooldownSec_, maxPerAddress_);
    }

    function _setParams(uint128 dripAmount_, uint64 cooldownSec_, uint256 maxPerAddress_) private {
        if (dripAmount_ == 0 || maxPerAddress_ < dripAmount_ || maxPerAddress_ > type(uint192).max) {
            revert InvalidParams();
        }
        dripAmount = dripAmount_;
        cooldownSec = cooldownSec_;
        maxPerAddress = maxPerAddress_;
        emit ParamsUpdated(dripAmount_, cooldownSec_, maxPerAddress_);
    }
}
