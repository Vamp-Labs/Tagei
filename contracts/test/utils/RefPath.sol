// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Independent test-side port of packages/shared/src/path.ts `evaluatePath` (and the lane.ts arithmetic it
/// needs). Deliberately written without the production libraries so the invariant and fuzz suites compare two
/// implementations. `path[k]` is the checkpoint of second `entrySec + k`.
library RefPath {
    uint256 internal constant PPM = 1e6;
    uint256 internal constant BPS = 1e4;
    uint256 internal constant STALL_AFTER_SEC = 60;

    // Outcome / VoidReason numbering from enums.ts
    uint8 internal constant TARGET_HIT = 1;
    uint8 internal constant STOP_HIT = 2;
    uint8 internal constant TIMEOUT = 3;
    uint8 internal constant CASHED_OUT = 4;
    uint8 internal constant VOIDED = 5;
    uint8 internal constant ENTRY_INVALID = 1;
    uint8 internal constant TERMINAL_INVALID = 2;
    uint8 internal constant CHECKPOINT_GAP = 3;
    uint8 internal constant STALLED = 4;

    struct Terms {
        uint8 direction; // 0 long, 1 short
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

    struct Point {
        bool recorded;
        uint256 price18;
        bool disputed;
        bool permanentlyMissing;
    }

    struct Result {
        bool decidable;
        uint8 outcome;
        uint256 payout;
        uint256 decisionSec;
        uint8 voidReason;
        uint256 missingSec;
        uint256 entryPrice;
        uint256 exitPrice;
    }

    function evaluate(Terms memory t, Point[] memory path, uint256 nowSec) internal pure returns (Result memory) {
        Point memory entry = path[0];
        if (!entry.recorded) return _missing(t, entry, t.entrySec, nowSec, 0);
        if (entry.disputed) return _void(ENTRY_INVALID, t.stake, t.entrySec, 0);

        uint256 p0 = entry.price18;
        uint256 prev = p0;
        for (uint256 sec = t.entrySec + 1; sec <= t.endSec; ++sec) {
            Point memory cp = path[sec - t.entrySec];
            if (!cp.recorded) return _missing(t, cp, sec, nowSec, p0);
            uint256 jump = cp.price18 >= prev ? cp.price18 - prev : prev - cp.price18;
            bool valid = !cp.disputed && jump * PPM <= t.maxJumpPpm * prev;
            prev = cp.price18;
            bool terminal = sec == t.endSec;
            if (!valid) {
                if (terminal) return _void(TERMINAL_INVALID, t.stake, sec, p0);
                continue;
            }
            bool up = cp.price18 >= p0;
            uint256 mag = up ? cp.price18 - p0 : p0 - cp.price18;
            bool fav = up ? (t.direction == 0 || mag == 0) : t.direction == 1;
            if (fav && mag * PPM >= t.targetPpm * p0) {
                return Result(true, TARGET_HIT, t.maxPayout, sec, 0, 0, p0, cp.price18);
            }
            if (!fav && mag * PPM >= t.stopPpm * p0) return Result(true, STOP_HIT, 0, sec, 0, 0, p0, cp.price18);
            if (terminal) {
                uint256 keep = BPS - t.feeBps;
                uint256 payout;
                if (fav) {
                    uint256 den = p0 * t.targetPpm;
                    payout = Math.mulDiv(
                        t.stake, (BPS * den + (t.multiplierBps - BPS) * mag * PPM) * keep, den * BPS * BPS
                    );
                } else {
                    uint256 d = p0 * t.stopPpm;
                    payout = Math.mulDiv(t.stake, (d - mag * PPM) * keep, d * BPS);
                }
                return Result(true, t.cashOutRequested ? CASHED_OUT : TIMEOUT, payout, sec, 0, 0, p0, cp.price18);
            }
        }
        revert("RefPath: endSec <= entrySec");
    }

    function _missing(Terms memory t, Point memory cp, uint256 sec, uint256 nowSec, uint256 p0)
        private
        pure
        returns (Result memory r)
    {
        if (cp.permanentlyMissing) return _void(CHECKPOINT_GAP, t.stake, sec, p0);
        if (nowSec > t.endSec + STALL_AFTER_SEC) return _void(STALLED, t.stake, sec, p0);
        r.missingSec = sec;
        r.entryPrice = p0;
    }

    function _void(uint8 reason, uint256 stake, uint256 sec, uint256 p0) private pure returns (Result memory r) {
        r.decidable = true;
        r.outcome = VOIDED;
        r.payout = stake;
        r.decisionSec = sec;
        r.voidReason = reason;
        r.entryPrice = p0;
    }
}
