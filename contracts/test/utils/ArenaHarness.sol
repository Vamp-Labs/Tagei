// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BnbPlayArena} from "../../src/BnbPlayArena.sol";
import {Round} from "../../src/types/ArenaTypes.sol";

/// @notice Exposes the production `_evaluate` so the differential suite can feed it arbitrary vector terms
/// (including lanes that `setLane` would reject).
contract ArenaHarness is BnbPlayArena {
    constructor(IERC20 token_, address admin) BnbPlayArena(token_, admin) {}

    function exposedEvaluate(Round memory r) external view returns (Evaluation memory) {
        return _evaluate(r);
    }
}
