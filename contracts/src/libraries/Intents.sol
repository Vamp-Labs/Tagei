// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CashOutIntent, OpenRoundIntent, WithdrawIntent} from "../types/ArenaTypes.sol";

/// @notice EIP-712 struct hashes. The type strings equal `TYPE_STRINGS` in packages/shared/src/eip712.ts.
library Intents {
    bytes32 internal constant OPEN_ROUND_TYPEHASH = keccak256(
        "OpenRound(address player,uint8 assetId,uint8 tier,uint8 direction,uint128 stake,uint32 laneVersion,uint8 oracleIdx,uint256 nonce,uint48 deadline)"
    );
    bytes32 internal constant CASH_OUT_TYPEHASH = keccak256("CashOut(address player,uint256 roundId,uint48 deadline)");
    bytes32 internal constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address player,address to,uint256 amount,uint256 nonce,uint48 deadline)");
    /// @dev P1 (on-chain session keys); not used by the P0 Arena.
    bytes32 internal constant SESSION_GRANT_TYPEHASH = keccak256(
        "SessionGrant(address player,address sessionKey,uint128 maxStakePerRound,uint128 stakeAllowance,uint48 expiry,uint256 nonce)"
    );

    function hash(OpenRoundIntent calldata i) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OPEN_ROUND_TYPEHASH,
                i.player,
                i.assetId,
                i.tier,
                uint8(i.direction),
                i.stake,
                i.laneVersion,
                i.oracleIdx,
                i.nonce,
                i.deadline
            )
        );
    }

    function hash(CashOutIntent calldata c) internal pure returns (bytes32) {
        return keccak256(abi.encode(CASH_OUT_TYPEHASH, c.player, c.roundId, c.deadline));
    }

    function hash(WithdrawIntent calldata w) internal pure returns (bytes32) {
        return keccak256(abi.encode(WITHDRAW_TYPEHASH, w.player, w.to, w.amount, w.nonce, w.deadline));
    }
}
