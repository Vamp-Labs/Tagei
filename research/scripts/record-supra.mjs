#!/usr/bin/env node
// Supra DORA-2 REST recorder (A1 spike, T1).
//
// Polls POST /get_proof on a FIXED schedule (default 5 Hz; requests are fired on
// the schedule even when earlier ones are still in flight, so the sampling rate
// does not depend on RTT), decodes the OracleProofV2 bytes off-chain and writes
// one NDJSON line per response. Every ~10 s it also logs the BSC testnet latest
// block (number + timestamp). Unique raw proofs are written once to a sidecar
// file so fixtures / fork tests can reuse historical proofs.
//
// Usage:
//   node scripts/record-supra.mjs [--hz 5] [--duration 3600] [--tag main]
//                                 [--max-inflight 8] [--block-every 10]
//                                 [--no-proofs] [--out-dir data]
//
// Output (research/data/, gitignored):
//   rec-<tag>-<startUnixSec>.ndjson     one line per event (see TYPES below)
//   proofs-<tag>-<startUnixSec>.ndjson  {hash, firstSeenAtMs, proof} per unique proof
//
// TYPES (field "t"):
//   meta   run parameters, clock info
//   proof  {seq, sentAtMs, receivedAtMs, rttMs, status, hash, size, feeds:[[pair, round, ts, price, decimals], ...]}
//   err    {seq, sentAtMs, receivedAtMs, rttMs, status|null, error, body?}
//   skip   {seq, atMs, inflight}  (request not sent because max-inflight reached)
//   block  {atMs, rttMs, number, timestamp, rpc}
//   blockerr {atMs, rpc, error}
//   end    summary counters

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAbiParameters, keccak256 } from 'viem';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = parseArgs(process.argv.slice(2));
const HZ = Number(args.hz ?? 5);
const DURATION_S = Number(args.duration ?? 3600);
const TAG = String(args.tag ?? 'main');
const MAX_INFLIGHT = Number(args['max-inflight'] ?? 8);
const BLOCK_EVERY_S = Number(args['block-every'] ?? 10);
const STORE_PROOFS = !args['no-proofs'];
const OUT_DIR = path.resolve(ROOT, String(args['out-dir'] ?? 'data'));
const TIMEOUT_MS = Number(args.timeout ?? 5000);

const SUPRA_URL = 'https://rpc-testnet-dora-2.supra.com/get_proof';
const PAIRS = [0, 1, 3, 10, 49];
const BSC_RPCS = ['https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet.bnbchain.org'];

const ORACLE_PROOF_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, 'abi/oracleProofV2.json'), 'utf8'));

fs.mkdirSync(OUT_DIR, { recursive: true });
const startMs = Date.now();
const runId = `${TAG}-${Math.floor(startMs / 1000)}`;
const recPath = path.join(OUT_DIR, `rec-${runId}.ndjson`);
const proofsPath = path.join(OUT_DIR, `proofs-${runId}.ndjson`);
const rec = fs.createWriteStream(recPath, { flags: 'a' });
const proofsOut = STORE_PROOFS ? fs.createWriteStream(proofsPath, { flags: 'a' }) : null;

const seenHashes = new Set();
const counters = { sent: 0, ok: 0, http4xx: 0, http429: 0, http5xx: 0, netErr: 0, skipped: 0, uniqueProofs: 0, blocks: 0, blockErr: 0 };
let inflight = 0;
let seq = 0;
let stopping = false;

function write(obj) {
  rec.write(JSON.stringify(obj) + '\n');
}

function decodeFeeds(hex) {
  const [p] = decodeAbiParameters(ORACLE_PROOF_ABI, hex);
  const feeds = [];
  for (const d of p.data) {
    for (const f of d.committee_data.committee_feed) {
      feeds.push([Number(f.pair), Number(f.round), Number(f.timestamp), f.price.toString(), Number(f.decimals)]);
    }
  }
  return { feeds, committees: p.data.map((d) => Number(d.committee_id)) };
}

async function pollOnce(mySeq) {
  const sentAtMs = Date.now();
  counters.sent++;
  inflight++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status = null;
  try {
    const res = await fetch(SUPRA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pair_indexes: PAIRS, chain_type: 'evm' }),
      signal: ctrl.signal,
    });
    status = res.status;
    const text = await res.text();
    const receivedAtMs = Date.now();
    if (status !== 200) {
      if (status === 429) counters.http429++;
      if (status >= 400 && status < 500) counters.http4xx++;
      if (status >= 500) counters.http5xx++;
      write({ t: 'err', seq: mySeq, sentAtMs, receivedAtMs, rttMs: receivedAtMs - sentAtMs, status, error: 'http', body: text.slice(0, 300), retryAfter: res.headers.get('retry-after') });
      return;
    }
    const j = JSON.parse(text);
    const hex = j.proof_bytes.startsWith('0x') ? j.proof_bytes : '0x' + j.proof_bytes;
    const hash = keccak256(hex);
    const size = (hex.length - 2) / 2;
    const { feeds, committees } = decodeFeeds(hex);
    counters.ok++;
    const line = { t: 'proof', seq: mySeq, sentAtMs, receivedAtMs, rttMs: receivedAtMs - sentAtMs, status, hash, size, feeds };
    if (committees.length !== 1 || committees[0] !== 0) line.committees = committees;
    write(line);
    if (!seenHashes.has(hash)) {
      seenHashes.add(hash);
      counters.uniqueProofs++;
      if (proofsOut) proofsOut.write(JSON.stringify({ hash, firstSeenAtMs: receivedAtMs, proof: hex }) + '\n');
    }
  } catch (e) {
    const receivedAtMs = Date.now();
    counters.netErr++;
    write({ t: 'err', seq: mySeq, sentAtMs, receivedAtMs, rttMs: receivedAtMs - sentAtMs, status, error: String(e?.name === 'AbortError' ? 'timeout' : e?.cause?.code || e?.message || e) });
  } finally {
    clearTimeout(timer);
    inflight--;
  }
}

let rpcIdx = 0;
async function logBlock() {
  const rpc = BSC_RPCS[rpcIdx++ % BSC_RPCS.length];
  const t0 = Date.now();
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    const atMs = Date.now();
    const b = j.result;
    counters.blocks++;
    write({ t: 'block', atMs, rttMs: atMs - t0, number: Number(b.number), timestamp: Number(b.timestamp), milliTimestamp: b.milliTimestamp ? Number(b.milliTimestamp) : undefined, rpc });
  } catch (e) {
    counters.blockErr++;
    write({ t: 'blockerr', atMs: Date.now(), rpc, error: String(e?.cause?.code || e?.message || e) });
  }
}

write({ t: 'meta', runId, startMs, hz: HZ, durationS: DURATION_S, maxInflight: MAX_INFLIGHT, blockEveryS: BLOCK_EVERY_S, supraUrl: SUPRA_URL, pairs: PAIRS, node: process.version, pid: process.pid });
console.log(`[record-supra] ${runId}: ${HZ} Hz for ${DURATION_S}s -> ${recPath}`);

const periodMs = 1000 / HZ;
const endMs = startMs + DURATION_S * 1000;
let tick = 0;
let lastBlockMs = 0;
let lastStatusMs = startMs;

function schedule() {
  if (stopping) return;
  const now = Date.now();
  if (now >= endMs) return finish();
  // Fire every due tick (drift-free schedule anchored at startMs).
  while (startMs + tick * periodMs <= now) {
    tick++;
    const mySeq = ++seq;
    if (inflight >= MAX_INFLIGHT) {
      counters.skipped++;
      write({ t: 'skip', seq: mySeq, atMs: now, inflight });
    } else {
      pollOnce(mySeq);
    }
  }
  if (BLOCK_EVERY_S > 0 && now - lastBlockMs >= BLOCK_EVERY_S * 1000) {
    lastBlockMs = now;
    logBlock();
  }
  if (now - lastStatusMs >= 60000) {
    lastStatusMs = now;
    console.log(`[record-supra] t+${Math.round((now - startMs) / 1000)}s ${JSON.stringify(counters)}`);
  }
  const next = startMs + tick * periodMs;
  setTimeout(schedule, Math.max(0, next - Date.now()));
}

async function finish() {
  if (stopping) return;
  stopping = true;
  const deadline = Date.now() + TIMEOUT_MS + 500;
  while (inflight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  write({ t: 'end', endMs: Date.now(), counters });
  console.log(`[record-supra] done ${JSON.stringify(counters)}`);
  await Promise.all([new Promise((r) => rec.end(r)), proofsOut ? new Promise((r) => proofsOut.end(r)) : null]);
  process.exit(0);
}

process.on('SIGTERM', finish);
process.on('SIGINT', finish);
schedule();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) out[k] = true;
    else { out[k] = v; i++; }
  }
  return out;
}
