// Supra DORA-2 pull proofs (verified by the A1 spike, research/spike-report.md §3).
// A proof is `abi.encode(OracleProofV2)`; each committee signs a Merkle root whose leaves are
// keccak256(LE32(pair) ‖ LE128(price) ‖ LE64(timestamp) ‖ LE16(decimals) ‖ LE64(round)) — little-endian.

import { bytesToHex, concat, decodeAbiParameters, keccak256, type Hex } from 'viem';

export const supraOracleProofV2Abi = [
  {
    type: 'tuple',
    name: 'OracleProofV2',
    components: [
      {
        type: 'tuple[]',
        name: 'data',
        components: [
          { type: 'uint64', name: 'committee_id' },
          { type: 'bytes32', name: 'root' },
          { type: 'uint256[2]', name: 'sigs' },
          {
            type: 'tuple',
            name: 'committee_data',
            components: [
              {
                type: 'tuple[]',
                name: 'committee_feed',
                components: [
                  { type: 'uint32', name: 'pair' },
                  { type: 'uint128', name: 'price' },
                  { type: 'uint64', name: 'timestamp' },
                  { type: 'uint16', name: 'decimals' },
                  { type: 'uint64', name: 'round' },
                ],
              },
              { type: 'bytes32[]', name: 'proof' },
              { type: 'bool[]', name: 'flags' },
            ],
          },
        ],
      },
    ],
  },
] as const;

export interface SupraFeed {
  committeeId: bigint;
  pairId: number;
  price: bigint;
  tsMs: bigint;
  decimals: number;
  roundMs: bigint;
}

/** Decodes every committee feed in a proof (does not verify signatures). */
export function decodeSupraProof(proof: Hex): SupraFeed[] {
  const [decoded] = decodeAbiParameters(supraOracleProofV2Abi, proof);
  return decoded.data.flatMap((committee) =>
    committee.committee_data.committee_feed.map((f) => ({
      committeeId: committee.committee_id,
      pairId: f.pair,
      price: f.price,
      tsMs: f.timestamp,
      decimals: f.decimals,
      roundMs: f.round,
    })),
  );
}

/** Canonical-round invariant observed on 100 % of rounds: round is second-aligned and ts ∈ [round, round + 1000). */
export const isCanonicalRound = (f: Pick<SupraFeed, 'roundMs' | 'tsMs'>): boolean =>
  f.roundMs % 1000n === 0n && f.tsMs >= f.roundMs && f.tsMs < f.roundMs + 1000n;

/** Scales a Supra price to 18 decimals. */
export function toPrice18(price: bigint, decimals: number): bigint {
  if (decimals === 18) return price;
  return decimals < 18 ? price * 10n ** BigInt(18 - decimals) : price / 10n ** BigInt(decimals - 18);
}

function le(value: bigint, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Merkle leaf exactly as Supra's pull contract computes it. */
export function supraLeaf(f: Pick<SupraFeed, 'pairId' | 'price' | 'tsMs' | 'decimals' | 'roundMs'>): Hex {
  return keccak256(
    concat([
      bytesToHex(le(BigInt(f.pairId), 4)),
      bytesToHex(le(f.price, 16)),
      bytesToHex(le(f.tsMs, 8)),
      bytesToHex(le(BigInt(f.decimals), 2)),
      bytesToHex(le(f.roundMs, 8)),
    ]),
  );
}
