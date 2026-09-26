// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Vendored subset of Supra's `ISupraSValueFeed` (BSC testnet storage proxy
/// 0x004d42225631F6bec6503a281Ed4c233810CBC29).
interface ISupraSValueFeed {
    struct priceFeed {
        uint256 round;
        uint256 decimals;
        uint256 time;
        uint256 price;
    }

    function getSvalue(uint256 _pairIndex) external view returns (priceFeed memory);
}
