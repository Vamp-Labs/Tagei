#!/usr/bin/env node
// Capture a fixture of CONSECUTIVE per-second Supra DORA-2 5-pair proofs (A1 spike, T2).
//
//   node scripts/capture-fixture.mjs [--rounds 23] [--rpc https://bsc-testnet-rpc.publicnode.com]
//
// Steps:
//   1. Read the latest BSC testnet block (number/hash/timestamp) BEFORE polling Supra.
//   2. Poll /get_proof at 5 Hz, keep the first-seen proof of every new round, until
//      `rounds` consecutive rounds (1000 ms apart, all 5 pairs on the same round) exist.
//   3. eth_call verifyOracleProofV2(first proof) on the real chain at blockBefore.number
//      and at the then-latest block; eth_estimateGas at latest (read-only, no tx).
//   4. Write fixtures/supra-97-<unixSec>.json (format documented in the file's "format" key).
//
// The RPC must serve historical state (bsc-testnet-rpc.publicnode.com / bsc-testnet.drpc.org do;
// the bnbchain.org dataseed nodes prune state after ~200 blocks).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, decodeAbiParameters, decodeFunctionResult, encodeFunctionData, keccak256, concat, toHex } from 'viem';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const N = Number(args.rounds ?? 23);
const RPC = String(args.rpc ?? 'https://bsc-testnet-rpc.publicnode.com');
const MAX_S = Number(args['max-seconds'] ?? 120);

const SUPRA_URL = 'https://rpc-testnet-dora-2.supra.com/get_proof';
const PAIRS = [0, 1, 3, 10, 49];
const PULL = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
const ORACLE_PROOF_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, 'abi/oracleProofV2.json'), 'utf8'));
const PULL_ABI = [
  {
    type: 'function', name: 'verifyOracleProofV2', stateMutability: 'nonpayable',
    inputs: [{ name: '_bytesProof', type: 'bytes' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'pairs', type: 'uint256[]' }, { name: 'prices', type: 'uint256[]' }, { name: 'timestamp', type: 'uint256[]' },
      { name: 'decimal', type: 'uint256[]' }, { name: 'round', type: 'uint256[]' },
    ] }],
  },
];

const client = createPublicClient({ transport: http(RPC, { timeout: 15000 }) });

const le = (v, n) => { let x = BigInt(v); const b = new Uint8Array(n); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n; } return toHex(b); };
export const leafOf = (f) => keccak256(concat([le(f.pair, 4), le(f.price, 16), le(f.timestamp, 8), le(f.decimals, 2), le(f.round, 8)]));

function decode(hex) {
  const [p] = decodeAbiParameters(ORACLE_PROOF_ABI, hex);
  return p.data.map((d) => ({
    committeeId: Number(d.committee_id),
    root: d.root,
    feeds: d.committee_data.committee_feed.map((f) => ({ pair: Number(f.pair), price: f.price.toString(), timestamp: Number(f.timestamp), decimals: Number(f.decimals), round: Number(f.round), leaf: leafOf(f) })),
  }));
}

const blockBefore = await client.getBlock({ blockTag: 'latest' });
const blockBeforeInfo = { number: Number(blockBefore.number), hash: blockBefore.hash, timestamp: Number(blockBefore.timestamp), milliTimestamp: blockBefore.milliTimestamp ? Number(blockBefore.milliTimestamp) : undefined, capturedAtMs: Date.now() };
console.log('[fixture] block before first proof:', blockBeforeInfo);

const byRound = new Map();
const t0 = Date.now();
let first = null;
let verifyInfo = null;
let verifyPromise = null;

function consecutiveRun() {
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  let best = [], cur = [];
  for (const r of rounds) {
    if (cur.length && r === cur[cur.length - 1] + 1000) cur.push(r); else cur = [r];
    if (cur.length > best.length) best = cur.slice();
  }
  return best;
}

async function doVerify(hex) {
  const data = encodeFunctionData({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', args: [hex] });
  const out = { to: PULL, selector: data.slice(0, 10) };
  for (const [label, blockNumber] of [['atBlockBefore', blockBefore.number], ['atLatest', null]]) {
    try {
      const bn = blockNumber ?? (await client.getBlockNumber());
      const res = await client.call({ to: PULL, data, blockNumber: bn });
      const dec = decodeFunctionResult({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', data: res.data });
      out[label] = { blockNumber: Number(bn), ok: true, returnData: res.data, decoded: { pairs: dec.pairs.map(Number), prices: dec.prices.map(String), timestamp: dec.timestamp.map(Number), decimal: dec.decimal.map(Number), round: dec.round.map(Number) } };
    } catch (e) {
      out[label] = { blockNumber: blockNumber ? Number(blockNumber) : null, ok: false, error: (e.shortMessage || e.message).slice(0, 400) };
    }
  }
  try { out.estimateGasAtLatest = Number(await client.estimateGas({ to: PULL, data, account: '0x000000000000000000000000000000000000dEaD' })); } catch (e) { out.estimateGasAtLatest = null; out.estimateGasError = (e.shortMessage || e.message).slice(0, 200); }
  return out;
}

while (Date.now() - t0 < MAX_S * 1000) {
  const tick = Date.now();
  try {
    const res = await fetch(SUPRA_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pair_indexes: PAIRS, chain_type: 'evm' }), signal: AbortSignal.timeout(4000) });
    const receivedAtMs = Date.now();
    if (res.status === 200) {
      const j = await res.json();
      const hex = j.proof_bytes.startsWith('0x') ? j.proof_bytes : '0x' + j.proof_bytes;
      const committees = decode(hex);
      const rounds = new Set(committees.flatMap((c) => c.feeds.map((f) => f.round)));
      if (rounds.size === 1) {
        const round = [...rounds][0];
        if (!byRound.has(round)) {
          byRound.set(round, { round, receivedAtMs, proofHash: keccak256(hex), sizeBytes: (hex.length - 2) / 2, proof: hex, committees });
          if (!first) { first = round; verifyPromise = doVerify(hex).then((v) => (verifyInfo = v)); }
        }
      } else {
        console.warn('[fixture] proof with mixed rounds', [...rounds]);
      }
    }
  } catch (e) { console.warn('[fixture] poll error', e?.message); }
  const run = consecutiveRun();
  if (run.length >= N) break;
  const wait = 200 - (Date.now() - tick);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
await verifyPromise;

const run = consecutiveRun().slice(0, N);
if (run.length < N) console.warn(`[fixture] only ${run.length} consecutive rounds captured`);
if (run[0] !== first) console.warn('[fixture] first captured round is not the start of the consecutive run; verifyCall refers to', first);

const unixSec = Math.floor(run[0] / 1000);
const fixture = {
  format: {
    version: 1,
    description: 'Consecutive per-second Supra DORA-2 OracleProofV2 proofs for pairs [0,1,3,10,49] on BSC testnet (chainId 97). Fork chain 97 at blockBeforeFirstProof.number (needs an archive-capable RPC, e.g. https://bsc-testnet-rpc.publicnode.com) and record proofs[] in order (one per second).',
    proofs: 'proofs[i].proof = raw bytes (0x hex) to pass to verifyOracleProofV2(bytes) / a CheckpointOracle. proofs[i].round = round start in ms (all 5 feeds share it); consecutive entries are exactly 1000 ms apart.',
    feed: 'committees[].feeds[] = {pair, price (decimal string, 10^decimals scaled), timestamp (ms), decimals, round (ms), leaf}. leaf = keccak256(LE32(pair) ++ LE128(price) ++ LE64(timestamp) ++ LE16(decimals) ++ LE64(round)) (38 bytes, little-endian), Merkle multiproof = OpenZeppelin MerkleProof.multiProofVerify (sorted-pair keccak256) over leaves in feed order.',
    verifyCall: 'eth_call of verifyOracleProofV2(proofs[0].proof) against the REAL chain at blockBeforeFirstProof.number and at the latest block when captured (read-only; nothing was sent).',
    receivedAtMs: 'local wall clock (NTP-synced, ~±30 ms) when the first response containing that round arrived (5 Hz polling => up to +200 ms quantisation).',
  },
  chainId: 97,
  supraRest: SUPRA_URL,
  pullContract: PULL,
  storageContract: '0x004d42225631F6bec6503a281Ed4c233810CBC29',
  verifierContract: '0x8694E798112a9Df06d9Ccc772967A5AeCfb24320',
  pairs: { BTC_USDT: 0, ETH_USDT: 1, DOGE_USDT: 3, SOL_USDT: 10, BNB_USDT: 49 },
  capturedAt: new Date(t0).toISOString(),
  rpcUsed: RPC,
  blockBeforeFirstProof: blockBeforeInfo,
  verifyCall: { proofIndex: 0, round: first, ...verifyInfo },
  proofs: run.map((r) => byRound.get(r)),
};
fs.mkdirSync(path.join(ROOT, 'fixtures'), { recursive: true });
const out = path.join(ROOT, 'fixtures', `supra-97-${unixSec}.json`);
fs.writeFileSync(out, JSON.stringify(fixture, null, 1));
console.log(`[fixture] wrote ${out}: ${run.length} rounds ${run[0]}..${run[run.length - 1]}, verify atBlockBefore ok=${verifyInfo?.atBlockBefore?.ok} atLatest ok=${verifyInfo?.atLatest?.ok} gas=${verifyInfo?.estimateGasAtLatest}, size=${fs.statSync(out).size} B`);

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}
