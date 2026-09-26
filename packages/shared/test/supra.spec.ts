import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { decodeSupraProof, isCanonicalRound, supraLeaf, toPrice18 } from '../src/supra.ts';

interface FixtureFeed { pair: number; price: string; timestamp: number; decimals: number; round: number; leaf: Hex }
interface Fixture { proofs: { round: number; proof: Hex; committees: { feeds: FixtureFeed[] }[] }[] }

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../research/fixtures/supra-97-1790414769.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

describe('Supra OracleProofV2 (real chain-97 fixture)', () => {
  it('decodes every proof to the fixture feeds', () => {
    for (const p of fixture.proofs) {
      const feeds = decodeSupraProof(p.proof);
      const expected = p.committees.flatMap((c) => c.feeds);
      expect(feeds.map((f) => [f.pairId, f.price.toString(), Number(f.tsMs), f.decimals, Number(f.roundMs)])).toEqual(
        expected.map((f) => [f.pair, f.price, f.timestamp, f.decimals, f.round]),
      );
    }
  });

  it('reproduces Supra little-endian leaves exactly', () => {
    for (const p of fixture.proofs) {
      for (const f of p.committees.flatMap((c) => c.feeds)) {
        const leaf = supraLeaf({ pairId: f.pair, price: BigInt(f.price), tsMs: BigInt(f.timestamp), decimals: f.decimals, roundMs: BigInt(f.round) });
        expect(leaf).toBe(f.leaf);
      }
    }
  });

  it('only sees canonical, consecutive rounds', () => {
    const rounds = fixture.proofs.map((p) => p.round);
    rounds.forEach((r, i) => i > 0 && expect(r - rounds[i - 1]).toBe(1000));
    for (const f of decodeSupraProof(fixture.proofs[0].proof)) expect(isCanonicalRound(f)).toBe(true);
  });

  it('scales prices to 18 decimals', () => {
    expect(toPrice18(5n, 16)).toBe(500n);
    expect(toPrice18(5_000n, 21)).toBe(5n);
    expect(toPrice18(7n, 18)).toBe(7n);
  });
});
