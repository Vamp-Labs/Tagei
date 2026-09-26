#!/usr/bin/env node
// Metrics for a record-supra.mjs NDJSON recording (A1 spike, T1).
//
//   node scripts/analyze-recording.mjs [data/rec-main-XXXX.ndjson] [--burst data/rec-burst10-XXXX.ndjson]
//
// Writes results/t1-metrics.json and data/supra-series-<runId>.json (per-pair per-second prices,
// used by calibrate-lanes.mjs for the Binance proxy check).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const burstIdx = argv.indexOf('--burst');
const burstFile = burstIdx >= 0 ? argv[burstIdx + 1] : latest('rec-burst10-');
const recFile = argv.find((a, i) => !a.startsWith('--') && i !== burstIdx + 1) ?? latest('rec-main-');

function latest(prefix) {
  const d = path.join(ROOT, 'data');
  const f = fs.readdirSync(d).filter((x) => x.startsWith(prefix) && x.endsWith('.ndjson')).sort().pop();
  return f ? path.join(d, f) : null;
}

const q = (arr, p) => {
  if (!arr.length) return null;
  const a = Float64Array.from(arr).sort();
  const idx = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[idx];
};
const stats = (arr) => ({ n: arr.length, min: arr.length ? Math.min(...arr) : null, p50: q(arr, 50), p90: q(arr, 90), p95: q(arr, 95), p99: q(arr, 99), p999: q(arr, 99.9), max: arr.length ? arr.reduce((m, x) => (x > m ? x : m), -Infinity) : null, mean: arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null });

async function readLines(file, fn) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) fn(JSON.parse(line));
}

async function analyze(file, { series = false } = {}) {
  const status = {};
  const rtt = [];
  const sizes = {};
  let meta = null, end = null;
  const byPairRound = new Map(); // key pair:round -> {firstRecv, firstSent, lastRecv, values:Set, hashes:Set, ts}
  const blocks = [];
  let mixedRoundProofs = 0, proofs = 0, regressions = 0, lastMaxRound = 0, errors = [];
  let responses = [];
  await readLines(file, (o) => {
    if (o.t === 'meta') meta = o;
    else if (o.t === 'end') end = o;
    else if (o.t === 'block') blocks.push(o);
    else if (o.t === 'err') { status[o.status ?? o.error] = (status[o.status ?? o.error] ?? 0) + 1; errors.push(o); }
    else if (o.t === 'proof') {
      proofs++;
      status[o.status] = (status[o.status] ?? 0) + 1;
      rtt.push(o.rttMs);
      sizes[o.size] = (sizes[o.size] ?? 0) + 1;
      const rounds = new Set(o.feeds.map((f) => f[1]));
      if (rounds.size > 1) mixedRoundProofs++;
      const maxRound = Math.max(...rounds);
      responses.push({ recv: o.receivedAtMs, sent: o.sentAtMs, maxRound });
      for (const [pair, round, ts, price, dec] of o.feeds) {
        const k = pair + ':' + round;
        let e = byPairRound.get(k);
        if (!e) { e = { pair, round, firstRecv: o.receivedAtMs, firstSent: o.sentAtMs, lastRecv: o.receivedAtMs, values: new Set(), hashes: new Set(), ts, price, dec }; byPairRound.set(k, e); }
        if (o.receivedAtMs < e.firstRecv) { e.firstRecv = o.receivedAtMs; e.firstSent = o.sentAtMs; }
        if (o.receivedAtMs > e.lastRecv) e.lastRecv = o.receivedAtMs;
        e.values.add(price + '@' + ts + '@' + dec);
        e.hashes.add(o.hash);
      }
    } else if (o.t === 'skip') { status.skipped = (status.skipped ?? 0) + 1; }
  });
  responses.sort((a, b) => a.recv - b.recv);
  for (const r of responses) { if (r.maxRound < lastMaxRound) regressions++; lastMaxRound = Math.max(lastMaxRound, r.maxRound); }

  const pairs = [...new Set([...byPairRound.values()].map((e) => e.pair))].sort((a, b) => a - b);
  const perPair = {};
  const latRecvAll = [], latSentAll = [], tsMinusRound = [], liveMs = [], recvMinusTs = [];
  let inconsistentValue = 0, multiHash = 0, roundNotFloorTs = 0;
  const seriesOut = {};
  for (const pair of pairs) {
    const es = [...byPairRound.values()].filter((e) => e.pair === pair).sort((a, b) => a.round - b.round);
    const first = es[0].round, last = es[es.length - 1].round;
    const expected = (last - first) / 1000 + 1;
    let longestGapSec = 0, gaps = 0, gapHist = {};
    for (let i = 1; i < es.length; i++) {
      const missing = (es[i].round - es[i - 1].round) / 1000 - 1;
      if (missing > 0) { gaps++; gapHist[missing] = (gapHist[missing] ?? 0) + 1; }
      if (missing > longestGapSec) longestGapSec = missing;
    }
    const latR = es.map((e) => e.firstRecv - e.round);
    const latS = es.map((e) => e.firstSent - e.round);
    latRecvAll.push(...latR); latSentAll.push(...latS);
    for (const e of es) {
      tsMinusRound.push(e.ts - e.round);
      recvMinusTs.push(e.firstRecv - e.ts);
      liveMs.push(e.lastRecv - e.firstRecv);
      if (e.values.size > 1) inconsistentValue++;
      if (e.hashes.size > 1) multiHash++;
      if (Math.floor(e.ts / 1000) * 1000 !== e.round) roundNotFloorTs++;
    }
    perPair[pair] = {
      roundsSeen: es.length, secondsSpanned: expected, missingSeconds: expected - es.length,
      pctSecondsWithRound: +(100 * es.length / expected).toFixed(4), gaps, gapHistogram: gapHist, longestGapSec,
      firstSeenMinusRoundStartMs: stats(latR),
    };
    if (series) {
      const prices = new Array(expected).fill(null);
      const dec = es[0].dec;
      for (const e of es) prices[(e.round - first) / 1000] = Number(BigInt(e.price) / 10n ** BigInt(Math.max(0, dec - 12))) / 1e12;
      seriesOut[pair] = { startRoundMs: first, decimals: dec, prices };
    }
  }
  // BSC blocks
  const bl = blocks.sort((a, b) => a.atMs - b.atMs);
  const blockAgeMs = bl.filter((b) => b.milliTimestamp).map((b) => b.atMs - b.milliTimestamp);
  let blockRate = null;
  if (bl.length > 1) {
    const a = bl[0], b = bl[bl.length - 1];
    blockRate = { blocks: b.number - a.number, seconds: (b.milliTimestamp ?? b.timestamp * 1000) / 1000 - (a.milliTimestamp ?? a.timestamp * 1000) / 1000 };
    blockRate.avgBlockTimeMs = +(1000 * blockRate.seconds / blockRate.blocks).toFixed(1);
  }
  const blockRtt = bl.map((b) => b.rttMs);
  const durationS = meta && end ? (end.endMs - meta.startMs) / 1000 : null;
  const sent = end?.counters?.sent ?? proofs + errors.length;
  const out = {
    file: path.relative(ROOT, file), runId: meta?.runId, startMs: meta?.startMs, durationS, hz: meta?.hz,
    requests: { sent, ok: proofs, statusCounts: status, errorRatePct: +(100 * (sent - proofs) / Math.max(1, sent)).toFixed(4), http429: status[429] ?? 0, rttMs: stats(rtt), errorsSample: errors.slice(0, 5) },
    proofSizeBytes: sizes,
    perPair,
    allPairs: {
      firstSeenMinusRoundStartMs_recv: stats(latRecvAll),
      firstSeenMinusRoundStartMs_sent: stats(latSentAll),
      firstSeenMinusFeedTsMs: stats(recvMinusTs),
      tsMinusRoundMs: stats(tsMinusRound),
      roundServedDurationMs: stats(liveMs),
    },
    consistency: {
      pairRounds: byPairRound.size,
      pairRoundsWithMoreThanOneValue: inconsistentValue,
      pairRoundsWithMoreThanOneProofHash: multiHash,
      roundNotEqualFloorTs: roundNotFloorTs,
      proofsWithMixedRounds: mixedRoundProofs,
      servedRoundRegressions: regressions,
    },
    bsc: { samples: bl.length, blockRate, latestBlockAgeAtObservationMs: stats(blockAgeMs), rpcRttMs: stats(blockRtt), blockErrors: end?.counters?.blockErr ?? null },
  };
  return { out, seriesOut };
}

const main = await analyze(recFile, { series: true });
const result = { generatedAt: new Date().toISOString(), main: main.out };
if (burstFile) result.burst10Hz = (await analyze(burstFile)).out;
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results/t1-metrics.json'), JSON.stringify(result, null, 1));
fs.writeFileSync(path.join(ROOT, `data/supra-series-${main.out.runId}.json`), JSON.stringify(main.seriesOut));
const m = main.out;
console.log(JSON.stringify({ durationS: m.durationS, requests: { sent: m.requests.sent, ok: m.requests.ok, errPct: m.requests.errorRatePct, rtt: m.requests.rttMs }, perPair: Object.fromEntries(Object.entries(m.perPair).map(([k, v]) => [k, { seen: v.roundsSeen, missing: v.missingSeconds, pct: v.pctSecondsWithRound, longestGap: v.longestGapSec }])), lat: m.allPairs.firstSeenMinusRoundStartMs_recv, latSent: m.allPairs.firstSeenMinusRoundStartMs_sent, tsMinusRound: m.allPairs.tsMinusRoundMs, served: m.allPairs.roundServedDurationMs, consistency: m.consistency, sizes: m.proofSizeBytes, bsc: m.bsc }, null, 1));
