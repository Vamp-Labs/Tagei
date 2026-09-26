// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {PriceVerifierBase} from "./PriceVerifierBase.sol";

/// @title SignedPriceVerifier (backup)
/// @notice Prices signed by a backend key as an EIP-712 `PriceBatch`. Anyone may submit a signed batch; the signature
/// is the authority, so rounds settled from it are labelled trusted (`isTrusted() == true`). The same per-feed checks
/// as Supra apply. Any second can be signed later, so gaps are never permanent.
/// @dev proof = abi.encode(VerifiedPrice[] points, bytes signature), signed over
/// PriceBatch(PricePoint[] points)PricePoint(uint32 pairId,uint64 roundMs,uint64 tsMs,uint256 price18)
/// with domain ("BnbPlaySignedPrice", "1", chainId, this).
contract SignedPriceVerifier is PriceVerifierBase, AccessControl, EIP712 {
    bytes32 public constant SOURCE_ID = "SIGNED_BACKEND_V1";
    bytes32 public constant SIGNER_ADMIN_ROLE = keccak256("SIGNER_ADMIN_ROLE");
    bytes32 public constant PRICE_POINT_TYPEHASH =
        keccak256("PricePoint(uint32 pairId,uint64 roundMs,uint64 tsMs,uint256 price18)");
    bytes32 public constant PRICE_BATCH_TYPEHASH = keccak256(
        "PriceBatch(PricePoint[] points)PricePoint(uint32 pairId,uint64 roundMs,uint64 tsMs,uint256 price18)"
    );

    mapping(address signer => bool) public isSigner;

    event SignerSet(address indexed signer, bool allowed);

    error InvalidBatchSignature();

    constructor(address admin, address[] memory signers, uint32[] memory pairs)
        PriceVerifierBase(pairs)
        EIP712("BnbPlaySignedPrice", "1")
    {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SIGNER_ADMIN_ROLE, admin);
        for (uint256 i; i < signers.length; ++i) {
            _setSigner(signers[i], true);
        }
    }

    function setSigner(address signer, bool allowed) external onlyRole(SIGNER_ADMIN_ROLE) {
        _setSigner(signer, allowed);
    }

    function verify(bytes calldata proof) external view returns (VerifiedPrice[] memory points) {
        bytes memory signature;
        (points, signature) = abi.decode(proof, (VerifiedPrice[], bytes));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashBatch(points), signature);
        if (err != ECDSA.RecoverError.NoError || !isSigner[signer]) revert InvalidBatchSignature();
        for (uint256 i; i < points.length; ++i) {
            VerifiedPrice memory v = points[i];
            if (!isTracked(v.pairId)) revert UntrackedPair(v.pairId);
            _checkFeed(v.pairId, v.roundMs, v.tsMs, v.price18);
        }
    }

    /// @notice EIP-712 digest a signer signs for `points`.
    function hashBatch(VerifiedPrice[] memory points) public view returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](points.length);
        for (uint256 i; i < points.length; ++i) {
            VerifiedPrice memory v = points[i];
            hashes[i] = keccak256(abi.encode(PRICE_POINT_TYPEHASH, v.pairId, v.roundMs, v.tsMs, v.price18));
        }
        return _hashTypedDataV4(keccak256(abi.encode(PRICE_BATCH_TYPEHASH, keccak256(abi.encodePacked(hashes)))));
    }

    function latestRoundMs(uint32) external pure returns (uint64) {
        return 0;
    }

    function supportsLateVerification() external pure returns (bool) {
        return true;
    }

    function sourceId() external pure returns (bytes32) {
        return SOURCE_ID;
    }

    function isTrusted() external pure returns (bool) {
        return true;
    }

    function _setSigner(address signer, bool allowed) private {
        if (signer == address(0)) revert ZeroAddress();
        isSigner[signer] = allowed;
        emit SignerSet(signer, allowed);
    }
}
