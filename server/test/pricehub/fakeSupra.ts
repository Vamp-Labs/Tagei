// Fake Supra DORA-2 REST server for tests: POST /get_proof returns a real OracleProofV2
// encoding (one committee, 5 feeds, dummy signatures) for the current second, from a scripted
// price path. Nothing here verifies on chain; the anvil stub oracle only decodes proofs.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodeAbiParameters, type Hex } from 'viem';
import { SUPRA_PAIR_IDS } from '@bnbplay/shared/assets';
import { supraOracleProofV2Abi } from '@bnbplay/shared/supra';

export const E18 = 10n ** 18n;
export const BASE_PRICES: Record<number, bigint> = { 0: 95_400n * E18, 1: 2_850n * E18, 3: 245n * 10n ** 15n, 10: 182n * E18, 49: 612n * E18 };

export function encodeProof(sec: number, prices: Record<number, bigint>, tsOffsetMs = 160): Hex {
  const roundMs = BigInt(sec) * 1000n;
  const feeds = SUPRA_PAIR_IDS.map((pair) => ({ pair, price: prices[pair], timestamp: roundMs + BigInt(tsOffsetMs), decimals: 18, round: roundMs }));
  return encodeAbiParameters(supraOracleProofV2Abi, [
    { data: [{ committee_id: 0n, root: `0x${sec.toString(16).padStart(64, '0')}` as Hex, sigs: [1n, 2n], committee_data: { committee_feed: feeds, proof: [], flags: [] } }] },
  ]);
}

export interface FakeSupra {
  url: string;
  requests: number;
  /** Per (pair, sec) overrides of the default flat path. */
  set(pairId: number, sec: number, price18: bigint): void;
  priceAt(pairId: number, sec: number): bigint;
  /** Answer 503 until this wall-clock time. */
  outageUntilMs: number;
  close(): Promise<void>;
}

export async function startFakeSupra(opts: { lagMs?: number; base?: Record<number, bigint> } = {}): Promise<FakeSupra> {
  const lag = opts.lagMs ?? 300;
  const base = opts.base ?? BASE_PRICES;
  const overrides = new Map<string, bigint>();
  const priceAt = (pairId: number, sec: number) => overrides.get(`${pairId}:${sec}`) ?? base[pairId];
  const state = { requests: 0, outageUntilMs: 0 };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests++;
      if (req.method !== 'POST' || req.url !== '/get_proof') {
        res.writeHead(404).end();
        return;
      }
      if (Date.now() < state.outageUntilMs) {
        res.writeHead(503).end('down');
        return;
      }
      const sec = Math.floor((Date.now() - lag) / 1000);
      const prices = Object.fromEntries(SUPRA_PAIR_IDS.map((p) => [p, priceAt(p, sec)]));
      const proof = encodeProof(sec, prices);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pair_indexes: JSON.parse(body).pair_indexes, proof_bytes: proof.slice(2) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const fake: FakeSupra = {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    set: (pairId, sec, price) => overrides.set(`${pairId}:${sec}`, price),
    priceAt,
    get outageUntilMs() {
      return state.outageUntilMs;
    },
    set outageUntilMs(v: number) {
      state.outageUntilMs = v;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  return fake;
}
