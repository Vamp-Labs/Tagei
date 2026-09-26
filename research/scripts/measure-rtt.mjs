#!/usr/bin/env node
// T5: RTT from this machine to Supra REST and BSC testnet RPCs (warm keep-alive and cold TLS),
// plus WSS newHeads arrival lag vs the block header milliTimestamp.
//   node scripts/measure-rtt.mjs [--n 40]   -> results/t5-rtt.json

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const N = Number(process.argv[process.argv.indexOf('--n') + 1] || 40);

const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : null; };
const st = (arr) => ({ n: arr.length, p50: q(arr, 50), p95: q(arr, 95), max: arr.length ? Math.max(...arr) : null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = {
  supraRest: { url: 'https://rpc-testnet-dora-2.supra.com/get_proof', body: JSON.stringify({ pair_indexes: [0, 1, 3, 10, 49], chain_type: 'evm' }) },
  bscDataseed: { url: 'https://bsc-testnet-dataseed.bnbchain.org', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) },
  bscBnbchain: { url: 'https://bsc-testnet.bnbchain.org', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) },
  bscPublicnode: { url: 'https://bsc-testnet-rpc.publicnode.com', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) },
};

const out = { generatedAt: new Date().toISOString(), n: N, warmKeepAliveMs: {}, coldCurlMs: {}, wss: null };
for (const [name, t] of Object.entries(targets)) {
  const warm = [];
  for (let i = 0; i < N + 2; i++) {
    const t0 = performance.now();
    const res = await fetch(t.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: t.body });
    await res.arrayBuffer();
    if (i >= 2) warm.push(Math.round(performance.now() - t0));
    await sleep(150);
  }
  out.warmKeepAliveMs[name] = st(warm);
  const cold = { total: [], connect: [], tls: [] };
  for (let i = 0; i < Math.min(N, 20); i++) {
    const r = execFileSync('curl', ['-s', '-o', '/dev/null', '-m', '10', '-X', 'POST', '-H', 'content-type: application/json', '-d', t.body, '-w', '%{time_connect} %{time_appconnect} %{time_total}', t.url]).toString().trim().split(' ').map(Number);
    cold.connect.push(Math.round(r[0] * 1000)); cold.tls.push(Math.round(r[1] * 1000)); cold.total.push(Math.round(r[2] * 1000));
    await sleep(150);
  }
  out.coldCurlMs[name] = { total: st(cold.total), tcpConnect: st(cold.connect), tlsDone: st(cold.tls) };
  console.log(name, JSON.stringify(out.warmKeepAliveMs[name]), JSON.stringify(out.coldCurlMs[name].total));
}

// WSS newHeads lag (arrival - header milliTimestamp)
await new Promise((resolve) => {
  const url = 'wss://bsc-testnet-rpc.publicnode.com';
  const lags = [];
  let ws;
  const done = () => { try { ws.close(); } catch {} out.wss = { url, headsReceived: lags.length, arrivalMinusHeaderMs: st(lags) }; resolve(); };
  try { ws = new WebSocket(url); } catch (e) { out.wss = { url, error: String(e) }; return resolve(); }
  const timer = setTimeout(done, 25000);
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
  ws.onmessage = (m) => {
    const now = Date.now();
    const j = JSON.parse(m.data);
    const h = j.params?.result;
    if (h?.milliTimestamp) lags.push(now - Number(h.milliTimestamp));
    else if (h?.timestamp) lags.push(now - Number(h.timestamp) * 1000);
    if (lags.length >= 40) { clearTimeout(timer); done(); }
  };
  ws.onerror = (e) => { clearTimeout(timer); out.wss = { url, error: String(e?.message || e) }; resolve(); };
});
console.log('wss', JSON.stringify(out.wss));
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'results/t5-rtt.json'), JSON.stringify(out, null, 1));
