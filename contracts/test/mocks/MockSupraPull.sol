// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ISupraOraclePull} from "../../src/oracle/interfaces/ISupraOraclePull.sol";
import {ISupraSValueFeed} from "../../src/oracle/interfaces/ISupraSValueFeed.sol";
import {SupraProofV2} from "../../src/oracle/libraries/SupraProofV2.sol";

/// @notice Reproduces Supra's stateful pull contract (spike report §3), including F1: a proof whose round is not
/// newer than the stored one does not update storage, and an OLDER proof returns the STORED newer values. It trusts
/// the proof content (the real contract checks BLS + Merkle first). Anyone can push, like the real one.
contract MockSupraPull is ISupraOraclePull, ISupraSValueFeed {
    mapping(uint256 pair => priceFeed) private _feeds;

    function verifyOracleProofV2(bytes calldata proofBytes) external returns (PriceInfo memory info) {
        SupraProofV2.OracleProofV2 memory p = abi.decode(proofBytes, (SupraProofV2.OracleProofV2));
        uint256 n;
        for (uint256 i; i < p.data.length; ++i) {
            n += p.data[i].committee_data.committee_feed.length;
        }
        info.pairs = new uint256[](n);
        info.prices = new uint256[](n);
        info.timestamp = new uint256[](n);
        info.decimal = new uint256[](n);
        info.round = new uint256[](n);

        uint256 k;
        uint256 nowMs = block.timestamp * 1000;
        for (uint256 i; i < p.data.length; ++i) {
            SupraProofV2.CommitteeFeed[] memory feeds = p.data[i].committee_data.committee_feed;
            for (uint256 j; j < feeds.length; ++j) {
                SupraProofV2.CommitteeFeed memory f = feeds[j];
                priceFeed storage s = _feeds[f.pair];
                info.pairs[k] = f.pair;
                if (f.round < s.round) {
                    info.prices[k] = s.price;
                    info.timestamp[k] = s.time;
                    info.decimal[k] = s.decimals;
                    info.round[k] = s.round;
                } else {
                    if (f.round > s.round) {
                        if (f.round > nowMs + 3000) revert IncorrectFutureUpdate(f.round - nowMs);
                        s.round = f.round;
                        s.decimals = f.decimals;
                        s.time = f.timestamp;
                        s.price = f.price;
                    }
                    info.prices[k] = f.price;
                    info.timestamp[k] = f.timestamp;
                    info.decimal[k] = f.decimals;
                    info.round[k] = f.round;
                }
                ++k;
            }
        }
    }

    function getSvalue(uint256 pair) external view returns (priceFeed memory) {
        return _feeds[pair];
    }
}
