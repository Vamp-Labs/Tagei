#!/usr/bin/env node
// Download Binance spot 1-second klines (public data API, no key) for lane calibration (A1 spike, T4).
//
// Usage:
//   node scripts/fetch-binance-1s.mjs [--days 7] [--symbols BNB,BTC,ETH,SOL,DOGE]
//                                     [--end <unixMs>] [--start <unixMs>] [--rps 8] [--tag cal]
//
// Output (research/data/, gitignored), per symbol:
//   binance-1s-<tag>-<SYM>.bin   Float64Array of close prices, one per second from startMs
//                                (NaN = no kline returned for that second)
//   binance-1s-<tag>.meta.json   {startMs, endMs, seconds, symbols:{SYM:{rows, missing, first, last}}}
//
// Pacing: requests are serialised through a token bucket (default 8 req/s, weight 2 each =
// 960/min vs the 6000/min IP budget) with retry + backoff on 418/429/5xx.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const DAYS = Number(args.days ?? 7);
const SYMBOLS = String(args.symbols ?? 'BNB,BTC,ETH,SOL,DOGE').split(',');
const RPS = Number(args.rps ?? 8);
const TAG = String(args.tag ?? 'cal');
const CONCURRENCY = 4;
const OUT_DIR = path.join(ROOT, 'data');
fs.mkdirSync(OUT_DIR, { recursive: true });

const endMs = args.end ? Number(args.end) : Math.floor(Date.now() / 60000) * 60000 - 60000;
const startMs = args.start ? Number(args.start) : endMs - DAYS * 86400000;
const seconds = Math.round((endMs - startMs) / 1000);

let nextSlot = Date.now();
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + 1000 / RPS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

let usedWeight = 0;
async function fetchChunk(sym, fromMs) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1s&limit=1000&startTime=${fromMs}&endTime=${Math.min(fromMs + 999999, endMs - 1)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      usedWeight = Number(res.headers.get('x-mbx-used-weight-1m') ?? usedWeight);
      if (res.status === 200) return await res.json();
      const ra = Number(res.headers.get('retry-after') ?? 0);
      const wait = ra > 0 ? ra * 1000 : 1000 * 2 ** attempt;
      console.warn(`[binance] ${sym} ${fromMs} HTTP ${res.status}; backing off ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    } catch (e) {
      console.warn(`[binance] ${sym} ${fromMs} ${e?.message}; retry`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`failed ${sym} ${fromMs}`);
}

const meta = { source: 'https://data-api.binance.vision/api/v3/klines interval=1s (spot, close price)', startMs, endMs, seconds, fetchedAt: new Date().toISOString(), symbols: {} };
console.log(`[binance] ${SYMBOLS.join(',')} ${new Date(startMs).toISOString()} -> ${new Date(endMs).toISOString()} (${seconds} s)`);

for (const sym of SYMBOLS) {
  const closes = new Float64Array(seconds).fill(NaN);
  const chunks = [];
  for (let t = startMs; t < endMs; t += 1000000) chunks.push(t);
  let rows = 0;
  let done = 0;
  const queue = chunks.slice();
  async function worker() {
    while (queue.length) {
      const from = queue.shift();
      const data = await fetchChunk(sym, from);
      for (const k of data) {
        const idx = Math.round((k[0] - startMs) / 1000);
        if (idx >= 0 && idx < seconds) { closes[idx] = Number(k[4]); rows++; }
      }
      done++;
      if (done % 100 === 0) console.log(`[binance] ${sym} ${done}/${chunks.length} chunks, weight1m=${usedWeight}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  let missing = 0;
  for (let i = 0; i < seconds; i++) if (Number.isNaN(closes[i])) missing++;
  fs.writeFileSync(path.join(OUT_DIR, `binance-1s-${TAG}-${sym}.bin`), Buffer.from(closes.buffer));
  meta.symbols[sym] = { rows, missing, first: closes.find((x) => !Number.isNaN(x)), chunks: chunks.length };
  console.log(`[binance] ${sym} done rows=${rows} missing=${missing}`);
  fs.writeFileSync(path.join(OUT_DIR, `binance-1s-${TAG}.meta.json`), JSON.stringify(meta, null, 2));
}
console.log('[binance] all done');

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
