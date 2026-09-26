#!/usr/bin/env node
// T3: on-chain behaviour of Supra DORA-2 pull contracts on BSC testnet (A1 spike).
// Real chain: eth_call ONLY (read-only; nothing is ever sent to chain 97).
// State-changing tests: a local anvil fork (anvil's funded default account).
//
//   anvil --fork-url https://bsc-testnet-rpc.publicnode.com --port 18545 --chain-id 97 &
//   node scripts/onchain-tests.mjs [--fixture fixtures/supra-97-XXXX.json] [--anvil http://127.0.0.1:18545]
//
// Writes results/t3-onchain.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createTestClient, createWalletClient, http, encodeFunctionData, decodeFunctionResult,
  decodeAbiParameters, encodeAbiParameters, encodeDeployData, parseAbi, decodeEventLog, keccak256, toHex,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const FIXTURE = path.resolve(ROOT, String(args.fixture ?? latestFixture()));
const ANVIL = String(args.anvil ?? 'http://127.0.0.1:18545');
const ARCHIVE_RPC = 'https://bsc-testnet-rpc.publicnode.com';

const PULL = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
const STORAGE = '0x004d42225631F6bec6503a281Ed4c233810CBC29';
const VERIFIER = '0x8694E798112a9Df06d9Ccc772967A5AeCfb24320';
const PAIRS = [0, 1, 3, 10, 49];
// anvil default account #0 (local fork only; anvil's public dev mnemonic)
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const P = fx.proofs.map((p) => p.proof);
const ROUNDS = fx.proofs.map((p) => p.round);
const ORACLE_PROOF_ABI = JSON.parse(fs.readFileSync(path.join(ROOT, 'abi/oracleProofV2.json'), 'utf8'));
const poc = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, `poc/out/StatelessSupraVerifier.sol/${name}.json`), 'utf8'));

const PULL_ABI = [
  ...parseAbi([
    'event PriceUpdate(uint256[] pairs, uint256[] prices, uint256[] updateMask)',
    'error IncorrectFutureUpdate(uint256)',
    'function TIME_DELTA_ALLOWANCE() view returns (uint256)',
  ]),
  {
    type: 'function', name: 'verifyOracleProofV2', stateMutability: 'nonpayable',
    inputs: [{ name: '_bytesProof', type: 'bytes' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'pairs', type: 'uint256[]' }, { name: 'prices', type: 'uint256[]' }, { name: 'timestamp', type: 'uint256[]' },
      { name: 'decimal', type: 'uint256[]' }, { name: 'round', type: 'uint256[]' },
    ] }],
  },
];
const STORAGE_ABI = parseAbi(['function getSvalue(uint256) view returns (uint256 round, uint256 decimals, uint256 time, uint256 price)']);
const VERIFIER_ABI = parseAbi(['function requireHashVerified_V2(bytes32,uint256[2],uint256) view', 'error BLSIncorrectInputMessaage()', 'error BLSInvalidPublicKeyorSignaturePoints()']);

const real = createPublicClient({ transport: http(ARCHIVE_RPC, { timeout: 20000 }) });
const fork = createPublicClient({ transport: http(ANVIL, { timeout: 60000 }) });
const test = createTestClient({ mode: 'anvil', transport: http(ANVIL, { timeout: 60000 }) });
const account = mnemonicToAccount(ANVIL_MNEMONIC);
const wallet = createWalletClient({ account, transport: http(ANVIL, { timeout: 60000 }) });

const results = { fixture: path.relative(ROOT, FIXTURE), generatedAt: new Date().toISOString(), realChain: {}, fork: {} };
const log = (...a) => console.log('[t3]', ...a);
const priceInfo = (d) => ({ pairs: d.pairs.map(Number), prices: d.prices.map(String), timestamp: d.timestamp.map(Number), decimal: d.decimal.map(Number), round: d.round.map(Number) });
const decodeProof = (hex) => decodeAbiParameters(ORACLE_PROOF_ABI, hex)[0];

async function rawCall(url, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params }) });
  return res.json();
}

// ---------------------------------------------------------------------------------------------
// REAL CHAIN (eth_call only)
// ---------------------------------------------------------------------------------------------
async function realChainTests() {
  const R = results.realChain;
  const latest = await real.getBlock({ blockTag: 'latest' });
  R.atBlock = Number(latest.number);

  // (f) EIP-1153 + friends via eth_call "create" with tiny init code.
  const probes = {
    // PUSH1 2a PUSH1 01 TSTORE PUSH1 01 TLOAD PUSH1 00 MSTORE PUSH1 20 PUSH1 00 RETURN  -> 0x..2a
    'EIP-1153 TSTORE/TLOAD': '0x602a60015d60015c60005260206000f3',
    // PUSH1 2a PUSH1 00 MSTORE ; PUSH1 20 PUSH1 00 PUSH1 20 MCOPY (dst=0x20? see below) ; return 64 bytes
    // MCOPY(dst=0x20, src=0x00, len=0x20): push len, src, dst => 6020 6000 6020 5e
    'EIP-5656 MCOPY': '0x602a6000526020600060205e60406000f3',
    // PUSH0 PUSH1 2a ADD PUSH0 MSTORE PUSH1 20 PUSH0 RETURN
    'EIP-3855 PUSH0': '0x5f602a015f5260205ff3',
    // BLOBBASEFEE (0x4a) PUSH0 MSTORE PUSH1 20 PUSH0 RETURN  (Cancun EIP-7516)
    'EIP-7516 BLOBBASEFEE': '0x4a5f5260205ff3',
  };
  R.opcodes = {};
  for (const [name, code] of Object.entries(probes)) {
    const j = await rawCall(ARCHIVE_RPC, [{ data: code }, 'latest']);
    R.opcodes[name] = j.result !== undefined ? { ok: true, result: j.result } : { ok: false, error: j.error };
    log(name, JSON.stringify(R.opcodes[name]));
  }

  // (d) Future / staleness semantics using eth_call block-time overrides (4th param) on the real chain.
  const data0 = encodeFunctionData({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', args: [P[0]] });
  const r0s = ROUNDS[0] / 1000;
  R.timeChecks = [];
  for (const d of [-60, -5, -4, -3, -2, -1, 0, 1, 60, 3600, 86400, 30 * 86400, 365 * 86400]) {
    const j = await rawCall(ARCHIVE_RPC, [{ to: PULL, data: data0 }, 'latest', {}, { time: toHex(r0s + d) }]);
    const entry = { blockTimeMinusRoundSec: d, ok: j.result !== undefined };
    if (!entry.ok) {
      entry.revertData = j.error?.data;
      try { const e = decodeErr(j.error?.data); entry.revert = e; } catch {}
    }
    R.timeChecks.push(entry);
  }
  log('timeChecks', JSON.stringify(R.timeChecks.map((t) => [t.blockTimeMinusRoundSec, t.ok, t.revert])));

  // (e) Stateless verification on the REAL chain via a constructor-only eth_call (nothing deployed).
  const once = poc('StatelessSupraVerifyOnce');
  const onceAbi = once.abi;
  const feedTuple = [{ type: 'tuple[]', components: [{ name: 'pair', type: 'uint32' }, { name: 'price', type: 'uint128' }, { name: 'timestamp', type: 'uint64' }, { name: 'decimals', type: 'uint16' }, { name: 'round', type: 'uint64' }] }];
  async function statelessReal(hex, label) {
    const dd = encodeDeployData({ abi: onceAbi, bytecode: once.bytecode.object, args: [VERIFIER, hex] });
    const j = await rawCall(ARCHIVE_RPC, [{ data: dd }, 'latest']);
    if (j.result === undefined) return { label, ok: false, revertData: j.error?.data, message: j.error?.message };
    const [feeds] = decodeAbiParameters(feedTuple, j.result);
    let gas = null;
    try { gas = Number(await real.estimateGas({ data: dd, account: '0x000000000000000000000000000000000000dEaD' })); } catch {}
    return { label, ok: true, estimateGasIncludingCreate: gas, feeds: feeds.map((f) => ({ pair: f.pair, price: f.price.toString(), timestamp: Number(f.timestamp), round: Number(f.round) })) };
  }
  R.stateless = [];
  R.stateless.push(await statelessReal(P[0], 'fixture proof[0] (untampered)'));
  // tamper: flip the low bit of pair 0's price inside the ABI blob (find by re-encoding)
  R.stateless.push(await statelessReal(tamperPrice(P[0]), 'fixture proof[0] with price+1 on first feed'));
  R.stateless.push(await statelessReal(tamperSig(P[0]), 'fixture proof[0] with sig[1] modified'));
  log('stateless(real)', JSON.stringify(R.stateless.map((s) => [s.label, s.ok, s.revertData, s.estimateGasIncludingCreate])));

  // Supra storage staleness on the real chain (nobody else pushing?)
  R.supraStorageNow = {};
  const nowMs = Date.now();
  for (const p of PAIRS) {
    const v = await real.readContract({ address: STORAGE, abi: STORAGE_ABI, functionName: 'getSvalue', args: [BigInt(p)] });
    R.supraStorageNow[p] = { round: Number(v[0]), ageSec: Math.round((nowMs - Number(v[0])) / 1000) };
  }
  log('supra storage age (s)', JSON.stringify(R.supraStorageNow));
}

function findRevertData(e) {
  for (let c = e, i = 0; c && i < 8; c = c.cause, i++) { if (typeof c.data === 'string' && c.data.startsWith('0x')) return c.data; if (typeof c.data?.data === 'string') return c.data.data; }
  return null;
}

function decodeErr(data) {
  if (!data || data === '0x') return null;
  const sel = data.slice(0, 10);
  if (sel === '0xc5184216') return { name: 'IncorrectFutureUpdate', arg: Number(BigInt('0x' + data.slice(10, 74))) };
  if (sel === '0x22460675') return { name: 'BLSIncorrectInputMessaage' };
  if (sel === '0x7edd58eb') return { name: 'BLSInvalidPublicKeyorSignaturePoints' };
  return { selector: sel };
}

function reencode(p) {
  return encodeAbiParameters(ORACLE_PROOF_ABI, [p]);
}
function tamperPrice(hex) {
  const p = decodeProof(hex);
  p.data[0].committee_data.committee_feed[0].price += 1n;
  return reencode(p);
}
function tamperSig(hex) {
  const p = decodeProof(hex);
  p.data[0].sigs = [p.data[0].sigs[0], p.data[0].sigs[1] ^ 1n];
  return reencode(p);
}

// ---------------------------------------------------------------------------------------------
// ANVIL FORK (state-changing, local only)
// ---------------------------------------------------------------------------------------------
async function resetFork(blockNumber) {
  await test.reset({ jsonRpcUrl: ARCHIVE_RPC, blockNumber: BigInt(blockNumber) });
  await test.setBalance({ address: account.address, value: 10n ** 21n });
}

async function simulateVerify(hex) {
  const data = encodeFunctionData({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', args: [hex] });
  try {
    const r = await fork.call({ to: PULL, data, account: account.address });
    return { ok: true, result: priceInfo(decodeFunctionResult({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', data: r.data })) };
  } catch (e) {
    return { ok: false, error: (e.shortMessage || e.message).slice(0, 300), revert: decodeErr(findRevertData(e)) };
  }
}

async function sendVerify(hex, atSec) {
  if (atSec) await test.setNextBlockTimestamp({ timestamp: BigInt(atSec) });
  const data = encodeFunctionData({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', args: [hex] });
  const hash = await wallet.sendTransaction({ to: PULL, data, gas: 2_000_000n, chain: null });
  const rc = await fork.waitForTransactionReceipt({ hash });
  const blk = await fork.getBlock({ blockNumber: rc.blockNumber });
  // exact return / revert data of the mined tx via callTracer
  const tr = await fork.request({ method: 'debug_traceTransaction', params: [hash, { tracer: 'callTracer' }] });
  let returned = null;
  if (rc.status === 'success' && tr?.output) returned = priceInfo(decodeFunctionResult({ abi: PULL_ABI, functionName: 'verifyOracleProofV2', data: tr.output }));
  const events = rc.logs.filter((l) => l.address.toLowerCase() === PULL.toLowerCase()).map((l) => {
    try { const ev = decodeEventLog({ abi: PULL_ABI, data: l.data, topics: l.topics }); return { name: ev.eventName, pairs: ev.args.pairs.map(Number), prices: ev.args.prices.map(String), updateMask: ev.args.updateMask.map(Number) }; } catch { return { raw: l.topics[0] }; }
  });
  return { status: rc.status, gasUsed: Number(rc.gasUsed), blockTimestamp: Number(blk.timestamp), returned, revert: rc.status === 'success' ? null : decodeErr(tr?.output), events };
}

async function storageSnapshot() {
  const out = {};
  for (const p of PAIRS) {
    const v = await fork.readContract({ address: STORAGE, abi: STORAGE_ABI, functionName: 'getSvalue', args: [BigInt(p)] });
    out[p] = { round: Number(v[0]), decimals: Number(v[1]), time: Number(v[2]), price: v[3].toString() };
  }
  return out;
}

async function forkTests() {
  const F = results.fork;
  const B = fx.blockBeforeFirstProof.number;
  await resetFork(B);
  F.forkBlock = B;
  const sec = (i) => ROUNDS[i] / 1000 + 1; // realistic: record ~1 s after round start

  // (a) fresh proof verifies
  F.a_fresh = await sendVerify(P[0], sec(0));
  F.a_storageAfter = await storageSnapshot();
  log('(a) fresh', F.a_fresh.status, 'gas', F.a_fresh.gasUsed, 'mask', JSON.stringify(F.a_fresh.events.map((e) => e.updateMask)));

  // (b) newer then older
  F.b_newer = await sendVerify(P[5], sec(5));
  F.b_older = await sendVerify(P[2], sec(5) + 1);
  F.b_storageAfter = await storageSnapshot();
  const p2 = decodeProof(P[2]).data[0].committee_data.committee_feed;
  const p5 = decodeProof(P[5]).data[0].committee_data.committee_feed;
  F.b_summary = {
    olderProofRound: ROUNDS[2], newerProofRound: ROUNDS[5],
    returnedRoundsForOlderProof: F.b_older.returned?.round,
    returnedEqualsNewer: JSON.stringify(F.b_older.returned?.prices) === JSON.stringify(p5.map((f) => f.price.toString())),
    returnedEqualsOlder: JSON.stringify(F.b_older.returned?.prices) === JSON.stringify(p2.map((f) => f.price.toString())),
    olderTxStatus: F.b_older.status, olderUpdateMask: F.b_older.events.map((e) => e.updateMask),
  };
  log('(b) newer->older', JSON.stringify(F.b_summary), 'gas newer', F.b_newer.gasUsed, 'older', F.b_older.gasUsed);

  // (c) the same proof twice
  F.c_repeat = await sendVerify(P[5], sec(5) + 2);
  F.c_summary = { status: F.c_repeat.status, gasUsed: F.c_repeat.gasUsed, updateMask: F.c_repeat.events.map((e) => e.updateMask), returnedRound: F.c_repeat.returned?.round };
  log('(c) repeat', JSON.stringify(F.c_summary));

  // (d) time travel: old-but-still-newest proof after +1 h / +1 d / +30 d  (snapshot per case)
  F.d_timeTravel = [];
  for (const dt of [3600, 86400, 30 * 86400]) {
    const snap = await test.snapshot();
    await test.increaseTime({ seconds: dt });
    await test.mine({ blocks: 1 });
    const r = await sendVerify(P[6]);
    F.d_timeTravel.push({ increaseSec: dt, status: r.status, blockTimestamp: r.blockTimestamp, proofRound: ROUNDS[6], ageSec: r.blockTimestamp - ROUNDS[6] / 1000, updateMask: r.events.map((e) => e.updateMask), gasUsed: r.gasUsed });
    await test.revert({ id: snap });
  }
  log('(d) time travel', JSON.stringify(F.d_timeTravel.map((x) => [x.increaseSec, x.status, x.updateMask])));

  // (d') future proof on the fork: next block timestamp far BEFORE a proof's round
  {
    const snap = await test.snapshot();
    const r = await (async () => { try { return await sendVerify(P[22], sec(6) + 3); } catch (e) { return { error: (e.shortMessage || e.message).slice(0, 200) }; } })();
    F.d_future = { proofRound: ROUNDS[22], blockTimestamp: r.blockTimestamp, deltaMs: ROUNDS[22] - r.blockTimestamp * 1000, status: r.status, revert: r.revert, error: r.error };
    await test.revert({ id: snap });
    log('(d) future', JSON.stringify(F.d_future));
  }

  // (e) stateless verification contract on the fork
  const sv = poc('StatelessSupraVerifier');
  await test.setNextBlockTimestamp({ timestamp: BigInt(ROUNDS[0] / 1000 + 21) });
  const dh = await wallet.deployContract({ abi: sv.abi, bytecode: sv.bytecode.object, args: [VERIFIER], chain: null });
  const drc = await fork.waitForTransactionReceipt({ hash: dh });
  const SV = drc.contractAddress;
  // push the newest fixture proof into Supra storage first, so P[0..21] are all "historical"
  await sendVerify(P[22], sec(22));
  F.e_supraStorageAfterNewest = await storageSnapshot();
  F.e_supraVerifyOldProof = await simulateVerify(P[0]);
  F.e_stateless = [];
  for (const i of [0, 1, 10, 21]) {
    const data = encodeFunctionData({ abi: sv.abi, functionName: 'verify', args: [P[i]] });
    try {
      const r = await fork.call({ to: SV, data });
      const feeds = decodeFunctionResult({ abi: sv.abi, functionName: 'verify', data: r.data });
      const gas = Number(await fork.estimateGas({ to: SV, data, account: account.address }));
      F.e_stateless.push({ proofIndex: i, round: ROUNDS[i], ok: true, estimateGas: gas, returnedRounds: [...new Set(feeds.map((f) => Number(f.round)))], matchesFixture: feeds.every((f, k) => f.price.toString() === fx.proofs[i].committees[0].feeds[k].price) });
    } catch (e) {
      F.e_stateless.push({ proofIndex: i, ok: false, error: (e.shortMessage || e.message).slice(0, 200) });
    }
  }
  for (const [label, hex] of [['tamperedPrice', tamperPrice(P[3])], ['tamperedSig', tamperSig(P[3])]]) {
    const data = encodeFunctionData({ abi: sv.abi, functionName: 'verify', args: [hex] });
    try { await fork.call({ to: SV, data }); F.e_stateless.push({ label, ok: true, UNEXPECTED: true }); } catch (e) { F.e_stateless.push({ label, ok: false, revertData: findRevertData(e), message: (e.shortMessage || '').slice(0, 160) }); }
  }
  log('(e) supra verify(old) returns rounds', JSON.stringify(F.e_supraVerifyOldProof.result?.round), '; stateless', JSON.stringify(F.e_stateless.map((s) => [s.proofIndex ?? s.label, s.ok, s.returnedRounds?.[0], s.estimateGas])));

  // (f) EIP-1153 on the fork (anvil's EVM) for completeness
  const j = await rawCall(ANVIL, [{ data: '0x602a60015d60015c60005260206000f3' }, 'latest']);
  F.f_tstoreOnFork = j.result ?? j.error;
}

try {
  await realChainTests();
} catch (e) {
  results.realChain.error = String(e?.stack || e);
  console.error(e);
}
try {
  await forkTests();
} catch (e) {
  results.fork.error = String(e?.stack || e);
  console.error(e);
}
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results/t3-onchain.json'), JSON.stringify(results, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1));
log('wrote results/t3-onchain.json');

function latestFixture() {
  const dir = path.join(ROOT, 'fixtures');
  const f = fs.readdirSync(dir).filter((x) => x.startsWith('supra-97-') && x.endsWith('.json')).sort().pop();
  return path.join('fixtures', f);
}
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
