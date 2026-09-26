#!/usr/bin/env node
// T4: lane calibration by exhaustive historical simulation on Binance 1-second closes (A1 spike).
//
//   node scripts/fetch-binance-1s.mjs --days 7 --tag cal          # 7 days of 1 s closes -> data/
//   node scripts/calibrate-lanes.mjs [--tag cal] [--rec-tag rec]  # -> lane-params.json, results/t4-*.json
//
// Game model (per round): entry = p[s]; seconds s+1..s+D are checked IN ORDER; the first barrier
// touched wins (inclusive >=): favourable move >= T -> payout M; adverse move >= S -> payout 0;
// otherwise at s+D payout = V(r)*(1-fee), V = 1+(M-1)*r/T (r>=0), 1-|r|/S (r<0). Returns are simple
// returns vs entry in ppm. Every start second is simulated (stride 1), LONG and SHORT.
//
// Efficient exhaustive grid: for each path we compute first-passage times up[l]/dn[l] to a common
// log-spaced level grid L[l] (in units of sigma1s), then accumulate outcome counts for every
// (T=L[i], S=L[j]) pair with difference arrays. Accumulators do not depend on M, so every tier is
// evaluated from the same pass. Chosen parameters are then re-simulated directly (exact integer
// ppm values) as a cross-check, together with simple momentum/contrarian player strategies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = parseArgs(process.argv.slice(2));
const TAG = String(args.tag ?? 'cal');
const REC_TAG = String(args['rec-tag'] ?? 'rec');
const SIGMA_MODE = String(args['sigma-mode'] ?? 'plain'); // plain (as specified) | robust (bipower) for S>=4σ and gap margin
const DATA = path.join(ROOT, 'data');

const ASSETS = [
  { sym: 'BNB', pairId: 49 },
  { sym: 'BTC', pairId: 0 },
  { sym: 'ETH', pairId: 1 },
  { sym: 'SOL', pairId: 10 },
  { sym: 'DOGE', pairId: 3 },
];
const TIERS = [
  { tier: 1, label: 'CRUISE', M: 1.5, band: [0.40, 0.55] },
  { tier: 2, label: 'BOOST', M: 2, band: [0.30, 0.45] },
  { tier: 3, label: 'HYPER', M: 3, band: [0.20, 0.35] },
  { tier: 4, label: 'WARP', M: 5, band: [0.15, 0.25] },
];
const FEE_BPS = 100;
const FEE = FEE_BPS / 1e4;
const DURATIONS = [20, 30];
const EDGE_MIN = 0.02, EDGE_MAX = 0.06, EDGE_TGT_LO = 0.03, EDGE_TGT_HI = 0.04, EDGE_TGT = 0.035;
const GAP_K = 0.5826; // -zeta(1/2)/sqrt(2*pi): Broadie-Glasserman-Kou discrete-monitoring shift
const S_MIN_SIGMA = 4;
const NL = 110; // level grid size
const L_LO = 0.5, L_HI = 120; // levels span [0.5, 120] * sigma1s (log-spaced)

const meta = JSON.parse(fs.readFileSync(path.join(DATA, `binance-1s-${TAG}.meta.json`), 'utf8'));
const N = meta.seconds;

const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const r6 = (x) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 1e6) / 1e6);

function loadCloses(sym, tag = TAG) {
  const buf = fs.readFileSync(path.join(DATA, `binance-1s-${tag}-${sym}.bin`));
  const a = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  const p = Float64Array.from(a);
  let last = NaN;
  for (let i = 0; i < p.length; i++) { if (Number.isNaN(p[i])) p[i] = last; else last = p[i]; }
  for (let i = 0; i < p.length && Number.isNaN(p[i]); i++) p[i] = p.find((x) => !Number.isNaN(x));
  return p;
}

// ------------------------------------------------------------------ volatility statistics
function volStats(p) {
  const n = p.length - 1;
  const r = new Float64Array(n);
  let s1 = 0, s2 = 0, zero = 0, minTick = Infinity, bp = 0;
  for (let i = 0; i < n; i++) {
    const x = (p[i + 1] / p[i] - 1) * 1e6;
    r[i] = x; s1 += x; s2 += x * x;
    if (x === 0) zero++;
    else { const t = Math.abs(p[i + 1] - p[i]) / p[i] * 1e6; if (t < minTick) minTick = t; }
    if (i > 0) bp += Math.abs(x) * Math.abs(r[i - 1]);
  }
  const mean = s1 / n;
  const sd = Math.sqrt(s2 / n - mean * mean);
  const abs = Float64Array.from(r, Math.abs).sort();
  const med = q(Float64Array.from(r).sort(), 0.5);
  const mad = q(Float64Array.from(r, (x) => Math.abs(x - med)).sort(), 0.5) * 1.4826;
  const bipower = Math.sqrt((Math.PI / 2) * (bp / (n - 1)));
  const horizon = {};
  for (const D of [5, 20, 30, 60]) {
    let a = 0, b = 0, m = 0;
    for (let i = 0; i + D < p.length; i++) { const x = (p[i + D] / p[i] - 1) * 1e6; a += x; b += x * x; m++; }
    const mu = a / m;
    horizon[D] = Math.sqrt((b / m - mu * mu) / D);
  }
  const acf = {};
  for (let lag = 1; lag <= 10; lag++) { let c = 0; for (let i = lag; i < n; i++) c += (r[i] - mean) * (r[i - lag] - mean); acf[lag] = c / n / (sd * sd); }
  const varianceRatio = Object.fromEntries(Object.entries(horizon).map(([k, v]) => [k, (v / sd) ** 2]));
  return {
    r,
    stats: {
      sigma1sPlainPpm: sd, sigma1sMadPpm: mad, sigma1sBipowerPpm: bipower, acf1s: acf, varianceRatio,
      sigmaEffFromHorizonPpm: horizon, // sd(r_D)/sqrt(D): diffusion-equivalent per-second sigma
      varianceRatio20: (horizon[20] / sd) ** 2,
      zeroReturnPct: 100 * zero / n, approxTickPpm: minTick,
      absReturnPpm: { p50: q(abs, 0.5), p99: q(abs, 0.99), p999: q(abs, 0.999), p9999: q(abs, 0.9999), max: abs[abs.length - 1] },
      meanPpm: mean,
    },
  };
}

// ------------------------------------------------------------------ regimes
function regimes(r, startMs) {
  const hourRV = new Float64Array(24), hourN = new Float64Array(24);
  for (let i = 0; i < r.length; i++) {
    const h = new Date(startMs + (i + 1) * 1000).getUTCHours();
    hourRV[h] += r[i] * r[i]; hourN[h]++;
  }
  const hourVol = Array.from(hourRV, (v, h) => Math.sqrt(v / hourN[h]));
  const order = [...hourVol.keys()].sort((a, b) => hourVol[a] - hourVol[b]);
  const quartileOfHour = new Array(24);
  order.forEach((h, rank) => (quartileOfHour[h] = Math.floor(rank / 6)));
  const cells = new Uint8Array(r.length + 1);
  for (let s = 0; s < cells.length; s++) {
    const d = new Date(startMs + s * 1000);
    const wk = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1 : 0;
    cells[s] = quartileOfHour[d.getUTCHours()] * 2 + wk;
  }
  const cellOf = (s) => cells[s];
  return { hourVolPpm: hourVol, quartileOfHour, cellOf };
}
const REGIMES = {
  volQ1_quietest: [0, 1], volQ2: [2, 3], volQ3: [4, 5], volQ4_loudest: [6, 7],
  weekday: [0, 2, 4, 6], weekend: [1, 3, 5, 7],
};

// ------------------------------------------------------------------ exhaustive accumulation
function accumulate(p, D, L, cellOf) {
  const nCells = 8, W = NL + 1;
  const mk = () => Array.from({ length: nCells * 2 }, () => new Float64Array(W * W));
  const TPd = mk(), TOd = mk(), RPd = mk(), RMd = mk();
  const nPaths = new Float64Array(nCells * 2);
  const up = new Int32Array(NL), dn = new Int32Array(NL);
  const last = p.length - 1 - D;
  for (let s = 0; s <= last; s++) {
    const e = p[s];
    let mx = -Infinity, mn = Infinity, ui = 0, di = 0, rD = 0;
    for (let k = 1; k <= D; k++) {
      const x = (p[s + k] / e - 1) * 1e6;
      if (x > mx) { mx = x; while (ui < NL && mx >= L[ui]) up[ui++] = k; }
      if (x < mn) { mn = x; const a = -mn; while (di < NL && a >= L[di]) dn[di++] = k; }
      if (k === D) rD = x;
    }
    for (let l = ui; l < NL; l++) up[l] = D + 1;
    for (let l = di; l < NL; l++) dn[l] = D + 1;
    const cell = cellOf(s);
    for (let dir = 0; dir < 2; dir++) {
      const kT = dir === 0 ? up : dn, kS = dir === 0 ? dn : up;
      const nT = dir === 0 ? ui : di, nS = dir === 0 ? di : ui;
      const fav = dir === 0 ? rD : -rD;
      const idx = cell * 2 + dir;
      nPaths[idx]++;
      const tp = TPd[idx];
      let jp = 0;
      for (let i = 0; i < nT; i++) {
        const kt = kT[i];
        while (jp < nS && kS[jp] <= kt) jp++;
        tp[i * W + jp] += 1; // TP for all j >= jp in row i
      }
      // rows i >= nT (target never reached): timeout for j >= nS, stop-out for j < nS
      const o = nT * W + nS;
      TOd[idx][o] += 1;
      if (fav > 0) RPd[idx][o] += fav; else RMd[idx][o] -= fav;
    }
  }
  // prefix sums: TP along j; TO/RP/RM 2D
  for (let idx = 0; idx < nCells * 2; idx++) {
    const tp = TPd[idx];
    for (let i = 0; i < NL; i++) for (let j = 1; j < NL; j++) tp[i * W + j] += tp[i * W + j - 1];
    for (const A of [TOd[idx], RPd[idx], RMd[idx]]) {
      for (let i = 0; i < NL; i++) for (let j = 1; j < NL; j++) A[i * W + j] += A[i * W + j - 1];
      for (let i = 1; i < NL; i++) for (let j = 0; j < NL; j++) A[i * W + j] += A[(i - 1) * W + j];
    }
  }
  return { TPd, TOd, RPd, RMd, nPaths, W };
}

function evalCell(acc, cells, dir, i, j, T, S, M) {
  let n = 0, tp = 0, to = 0, rp = 0, rm = 0;
  const k = i * acc.W + j;
  for (const c of cells) {
    const idx = c * 2 + dir;
    n += acc.nPaths[idx]; tp += acc.TPd[idx][k]; to += acc.TOd[idx][k]; rp += acc.RPd[idx][k]; rm += acc.RMd[idx][k];
  }
  const ev = (tp * M + (1 - FEE) * (to + ((M - 1) * rp) / T - rm / S)) / n;
  return { n, pTP: tp / n, pTO: to / n, pSL: (n - tp - to) / n, ev };
}

function metrics(acc, i, j, T, S, M) {
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  const L = evalCell(acc, all, 0, i, j, T, S, M), Sh = evalCell(acc, all, 1, i, j, T, S, M);
  const reg = {};
  let worst = Infinity;
  for (const [name, cells] of Object.entries(REGIMES)) {
    const a = evalCell(acc, cells, 0, i, j, T, S, M), b = evalCell(acc, cells, 1, i, j, T, S, M);
    reg[name] = { edgeLong: 1 - a.ev, edgeShort: 1 - b.ev, pTP: (a.pTP + b.pTP) / 2, pTimeout: (a.pTO + b.pTO) / 2 };
    worst = Math.min(worst, 1 - a.ev, 1 - b.ev);
  }
  return {
    pTP: (L.pTP + Sh.pTP) / 2, pSL: (L.pSL + Sh.pSL) / 2, pTimeout: (L.pTO + Sh.pTO) / 2,
    ev: (L.ev + Sh.ev) / 2, houseEdge: 1 - (L.ev + Sh.ev) / 2, edgeLong: 1 - L.ev, edgeShort: 1 - Sh.ev,
    worstRegimeEdge: worst, regimes: reg,
  };
}

function select(acc, L, sigma, tier) {
  const g = GAP_K * sigma;
  const { M, band } = tier;
  const cands = [];
  for (let j = 0; j < NL; j++) {
    const S = L[j];
    if (S < S_MIN_SIGMA * sigma) continue;
    for (let i = 0; i < NL; i++) {
      const T = L[i];
      if ((M - 1) * S + Math.max(0, M - 2) * g > T) continue;
      const m = metrics(acc, i, j, T, S, M);
      cands.push({ i, j, T, S, ...m });
    }
  }
  const okEdge = (c) => c.houseEdge >= EDGE_MIN && c.houseEdge <= EDGE_MAX && c.worstRegimeEdge >= 0;
  const inBand = (c) => c.pTP >= band[0] && c.pTP <= band[1];
  const rank = (a, b) => {
    const at = a.houseEdge >= EDGE_TGT_LO && a.houseEdge <= EDGE_TGT_HI, bt = b.houseEdge >= EDGE_TGT_LO && b.houseEdge <= EDGE_TGT_HI;
    if (at !== bt) return at ? -1 : 1;
    const ta = a.pTP + a.pSL, tb = b.pTP + b.pSL; // prefer resolution by touch
    if (Math.abs(ta - tb) > 0.005) return tb - ta;
    return Math.abs(a.houseEdge - EDGE_TGT) - Math.abs(b.houseEdge - EDGE_TGT);
  };
  const feasible = cands.filter((c) => okEdge(c) && inBand(c)).sort(rank);
  if (feasible.length) return { enabled: true, best: feasible[0], nFeasible: feasible.length, nCandidates: cands.length };
  // diagnostics: why infeasible
  const edgeOk = cands.filter(okEdge);
  const maxPTPedgeOk = edgeOk.reduce((m, c) => (c.pTP > (m?.pTP ?? -1) ? c : m), null);
  const maxPTPany = cands.reduce((m, c) => (c.pTP > (m?.pTP ?? -1) ? c : m), null);
  const closest = edgeOk.length ? edgeOk.sort((a, b) => Math.abs(a.pTP - (band[0] + band[1]) / 2) - Math.abs(b.pTP - (band[0] + band[1]) / 2))[0] : null;
  let reason;
  if (!cands.length) reason = 'no (T,S) satisfies guard + S>=4*sigma1s on the grid';
  else if (!edgeOk.length) reason = `no (T,S) under guard + S>=4σ gives house edge in [2%,6%] with worst-regime edge >= 0 (max P(TP) under guard ${pct(maxPTPany?.pTP)} at edge ${pct(maxPTPany?.houseEdge)})`;
  else reason = `P(TP) band [${pct(band[0])}, ${pct(band[1])}] unreachable: with guard (M-1)S+max(0,M-2)g<=T, S>=4σ and edge in [2%,6%] (worst regime >= 0) the max P(TP) is ${pct(maxPTPedgeOk?.pTP)}`;
  return { enabled: false, best: closest, reason, maxPTPedgeOk: maxPTPedgeOk && pick(maxPTPedgeOk), nCandidates: cands.length };
}
const pct = (x) => (x == null ? 'n/a' : (100 * x).toFixed(1) + '%');
const pick = (c) => ({ targetPpm: Math.round(c.T), stopPpm: Math.round(c.S), pTP: r6(c.pTP), pSL: r6(c.pSL), pTimeout: r6(c.pTimeout), houseEdge: r6(c.houseEdge), worstRegimeEdge: r6(c.worstRegimeEdge) });

// ------------------------------------------------------------------ exact re-simulation
const STRATEGIES = ['momentum:5', 'momentum:10', 'momentum:30', 'contrarian:5', 'contrarian:10'];
function simulateExact(p, D, T, S, M, lag = 2) {
  // LONG/SHORT stats plus player strategies (direction from the last k seconds before commit at s-2)
  const res = { long: acc0(), short: acc0() };
  const st = STRATEGIES.map((name) => ({ name, k0: Number(name.split(':')[1]), mom: name.startsWith('momentum'), a: acc0() }));
  const last = p.length - 1 - D;
  for (let s = 0; s <= last; s++) {
    const e = p[s];
    let outL = 0, outS = 0, rD = 0, kL = D, kS = D; // 0 = timeout, 1 = tp, 2 = sl
    for (let k = 1; k <= D; k++) {
      const x = (p[s + k] / e - 1) * 1e6;
      if (outL === 0) { if (x >= T) { outL = 1; kL = k; } else if (-x >= S) { outL = 2; kL = k; } }
      if (outS === 0) { if (-x >= T) { outS = 1; kS = k; } else if (x >= S) { outS = 2; kS = k; } }
      if (outL !== 0 && outS !== 0) break;
      if (k === D) rD = x;
    }
    if (outL !== 0 && outS !== 0) rD = 0;
    const payL = pay(outL, rD, T, S, M), payS = pay(outS, -rD, T, S, M);
    add(res.long, outL, payL, kL); add(res.short, outS, payS, kS);
    for (const x of st) {
      if (s - lag - x.k0 < 0) continue;
      const sig = p[s - lag] - p[s - lag - x.k0];
      if (sig === 0) continue;
      const goLong = x.mom ? sig > 0 : sig < 0;
      add(x.a, goLong ? outL : outS, goLong ? payL : payS, goLong ? kL : kS);
    }
  }
  const fin = (a) => ({ n: a.n, pTP: a.tp / a.n, pSL: a.sl / a.n, pTimeout: a.to / a.n, ev: a.pay / a.n, houseEdge: 1 - a.pay / a.n, meanResolveSec: a.k / a.n });
  return { long: fin(res.long), short: fin(res.short), strategies: Object.fromEntries(st.map((x) => [x.name, x.a.n ? fin(x.a) : null])) };
}
function acc0() { return { n: 0, tp: 0, sl: 0, to: 0, pay: 0, k: 0 }; }
function add(a, out, pv, k) { a.n++; a.k += k; if (out === 1) a.tp++; else if (out === 2) a.sl++; else a.to++; a.pay += pv; }
function pay(out, fav, T, S, M) {
  if (out === 1) return M;
  if (out === 2) return 0;
  const v = fav >= 0 ? 1 + ((M - 1) * fav) / T : 1 - -fav / S;
  return v * (1 - FEE);
}

// ------------------------------------------------------------------ Supra vs Binance proxy check
function proxyCheck() {
  const seriesFile = fs.readdirSync(DATA).filter((f) => f.startsWith('supra-series-main-')).sort().pop();
  const recMetaFile = path.join(DATA, `binance-1s-${REC_TAG}.meta.json`);
  if (!seriesFile || !fs.existsSync(recMetaFile)) return { skipped: 'missing supra series or binance rec-window data' };
  const series = JSON.parse(fs.readFileSync(path.join(DATA, seriesFile), 'utf8'));
  const rm = JSON.parse(fs.readFileSync(recMetaFile, 'utf8'));
  const out = { supraSeries: seriesFile, binanceWindow: { startMs: rm.startMs, endMs: rm.endMs }, perAsset: {} };
  for (const a of ASSETS) {
    const s = series[a.pairId];
    if (!s) continue;
    const b = loadCloses(a.sym, REC_TAG);
    const lags = {};
    for (const lag of [-5, -4, -3, -2, -1, 0, 1, 2]) {
      // supra round second t  <->  binance kline open second t + lag
      const xs = [], ys = [];
      for (let k = 0; k < s.prices.length; k++) {
        const t = s.startRoundMs + k * 1000;
        const bi = Math.round((t - rm.startMs) / 1000) + lag;
        if (s.prices[k] == null || bi < 0 || bi >= b.length || Number.isNaN(b[bi])) { xs.push(NaN); ys.push(NaN); continue; }
        xs.push(s.prices[k]); ys.push(b[bi]);
      }
      const te = [], rx = [], ry = [], rx20 = [], ry20 = [];
      for (let k = 0; k < xs.length; k++) {
        if (!Number.isNaN(xs[k])) te.push((xs[k] / ys[k] - 1) * 1e4);
        if (k > 0 && !Number.isNaN(xs[k]) && !Number.isNaN(xs[k - 1])) { rx.push((xs[k] / xs[k - 1] - 1) * 1e6); ry.push((ys[k] / ys[k - 1] - 1) * 1e6); }
        if (k >= 20 && !Number.isNaN(xs[k]) && !Number.isNaN(xs[k - 20])) { rx20.push((xs[k] / xs[k - 20] - 1) * 1e6); ry20.push((ys[k] / ys[k - 20] - 1) * 1e6); }
      }
      const ate = te.map(Math.abs).sort((x, y) => x - y);
      lags[lag] = {
        n: te.length, trackingErrorBps: { mean: mean(te), sd: sd(te), p50Abs: q(ate, 0.5), p95Abs: q(ate, 0.95), maxAbs: ate[ate.length - 1] },
        corr1s: corr(rx, ry), corr20s: corr(rx20, ry20), sigma1sSupraPpm: sd(rx), sigma1sBinancePpm: sd(ry), sigma20sRatioSupraOverBinance: sd(rx20) / sd(ry20),
      };
    }
    const bestLag = Object.entries(lags).sort((x, y) => y[1].corr1s - x[1].corr1s)[0][0];
    // Supra-only statistics (forward-filled series)
    const sp = Float64Array.from(s.prices.map((x) => (x == null ? NaN : x)));
    for (let k = 1; k < sp.length; k++) if (Number.isNaN(sp[k])) sp[k] = sp[k - 1];
    const sv = volStats(sp).stats;
    // Binance series aligned to the same seconds (lag 0)
    const bp = new Float64Array(sp.length);
    for (let k = 0; k < sp.length; k++) bp[k] = b[Math.min(b.length - 1, Math.max(0, Math.round((s.startRoundMs + k * 1000 - rm.startMs) / 1000)))];
    const bv = volStats(bp).stats;
    const game = {};
    for (const D of DURATIONS) {
      game[D] = {};
      for (const t of (globalThis.__perD?.[D]?.[a.sym] ?? [])) {
        if (!t.targetPpm) continue;
        const M = t.multiplierBps / 1e4;
        const xs = simulateExact(sp, D, t.targetPpm, t.stopPpm, M), xb = simulateExact(bp, D, t.targetPpm, t.stopPpm, M);
        const f = (x) => ({ pTP: r6((x.long.pTP + x.short.pTP) / 2), pTimeout: r6((x.long.pTimeout + x.short.pTimeout) / 2), houseEdge: r6(1 - (x.long.ev + x.short.ev) / 2), momentum5Edge: r6(x.strategies['momentum:5']?.houseEdge) });
        game[D][t.label] = { supra: f(xs), binanceSameHour: f(xb) };
      }
    }
    // Binance-informed player on the SUPRA path: at commit second c the player knows Binance klines up to
    // open c-1 (closed at c); direction = sign(bp[c-1] - bp[c-1-k]); entry = Supra round c+delay.
    const informed = {};
    for (const D of DURATIONS) {
      informed[D] = {};
      for (const t of (globalThis.__perD?.[D]?.[a.sym] ?? [])) {
        if (!t.targetPpm || t.multiplierBps > 20000) continue;
        const M = t.multiplierBps / 1e4, T = t.targetPpm, S = t.stopPpm;
        const row = {};
        for (const delay of [2, 3, 5, 8]) for (const k of [3, 5, 10]) {
          let n = 0, sum = 0;
          for (let c = k + 1; c + delay + D < sp.length; c++) {
            const sig = bp[c - 1] - bp[c - 1 - k];
            if (sig === 0) continue;
            const dir = sig > 0 ? 1 : -1, s0 = c + delay, e = sp[s0];
            let out = 0, fav = 0;
            for (let j = 1; j <= D; j++) { const x = dir * (sp[s0 + j] / e - 1) * 1e6; if (x >= T) { out = 1; break; } if (-x >= S) { out = 2; break; } if (j === D) fav = x; }
            sum += pay(out, fav, T, S, M); n++;
          }
          row[`delay${delay}_k${k}`] = { n, houseEdge: r6(1 - sum / n) };
        }
        informed[D][t.label] = row;
      }
    }
    out.perAsset[a.sym] = {
      pairId: a.pairId, bestLagSec: Number(bestLag), lags, binanceInformedOnSupra: informed,
      supraStats: { sigma1sPlainPpm: sv.sigma1sPlainPpm, sigma1sBipowerPpm: sv.sigma1sBipowerPpm, zeroReturnPct: sv.zeroReturnPct, acf1s: sv.acf1s, varianceRatio: sv.varianceRatio, absReturnPpm: sv.absReturnPpm },
      binanceSameHourStats: { sigma1sPlainPpm: bv.sigma1sPlainPpm, sigma1sBipowerPpm: bv.sigma1sBipowerPpm, zeroReturnPct: bv.zeroReturnPct, acf1s: bv.acf1s, varianceRatio: bv.varianceRatio, absReturnPpm: bv.absReturnPpm },
      gameOnRecordedHour: game,
    };
  }
  return out;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function corr(x, y) { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); }

// ------------------------------------------------------------------ main
const t0 = Date.now();
const full = { generatedAt: new Date().toISOString(), dataWindow: meta, assets: {}, durations: {} };
const perD = Object.fromEntries(DURATIONS.map((D) => [D, {}]));
for (const a of ASSETS) {
  const p = loadCloses(a.sym);
  const { r, stats } = volStats(p);
  const reg = regimes(r, meta.startMs);
  const sigma = SIGMA_MODE === 'robust' ? stats.sigma1sBipowerPpm : stats.sigma1sPlainPpm;
  const L = Float64Array.from({ length: NL }, (_, l) => sigma * L_LO * Math.pow(L_HI / L_LO, l / (NL - 1)));
  const maxJump = niceCeil(Math.max(2 * stats.absReturnPpm.max, 10 * stats.absReturnPpm.p9999));
  full.assets[a.sym] = { pairId: a.pairId, ...stats, gapMarginPpm: GAP_K * sigma, maxJumpPpm: maxJump, hourVolPpm: reg.hourVolPpm.map((x) => +x.toFixed(2)), quartileOfHourUTC: reg.quartileOfHour };
  console.log(`[cal] ${a.sym} sigma1s plain=${sigma.toFixed(2)} bipower=${stats.sigma1sBipowerPpm.toFixed(2)} mad=${stats.sigma1sMadPpm.toFixed(2)} eff20=${stats.sigmaEffFromHorizonPpm[20].toFixed(2)} zero%=${stats.zeroReturnPct.toFixed(1)} |r| p99.99=${stats.absReturnPpm.p9999.toFixed(0)} max=${stats.absReturnPpm.max.toFixed(0)} -> maxJump=${maxJump}`);
  for (const D of DURATIONS) {
    const acc = accumulate(p, D, L, reg.cellOf);
    const tiers = [];
    for (const tier of TIERS) {
      const sel = select(acc, L, sigma, tier);
      const b = sel.best;
      let row = { tier: tier.tier, label: tier.label, multiplierBps: Math.round(tier.M * 1e4), targetPpm: null, stopPpm: null, feeBps: FEE_BPS, enabled: sel.enabled };
      if (b) {
        // exact integer ppm, rounded so the guard still holds
        let S = Math.floor(b.S), T = Math.ceil(b.T);
        const g = GAP_K * sigma;
        while ((tier.M - 1) * S + Math.max(0, tier.M - 2) * g > T) T++;
        const ex = simulateExact(p, D, T, S, tier.M);
        const exEdge = 1 - (ex.long.ev + ex.short.ev) / 2;
        row = { ...row, targetPpm: T, stopPpm: S,
          stats: { pTP: r6((ex.long.pTP + ex.short.pTP) / 2), pSL: r6((ex.long.pSL + ex.short.pSL) / 2), pTimeout: r6((ex.long.pTimeout + ex.short.pTimeout) / 2), houseEdge: r6(exEdge), worstRegimeEdge: r6(b.worstRegimeEdge), edgeLong: r6(1 - ex.long.ev), edgeShort: r6(1 - ex.short.ev), expectedPayout: r6(1 - exEdge), meanResolveSec: r6((ex.long.meanResolveSec + ex.short.meanResolveSec) / 2) },
          grid: { T: r6(b.T), S: r6(b.S), houseEdge: r6(b.houseEdge), pTP: r6(b.pTP), regimes: Object.fromEntries(Object.entries(b.regimes).map(([k, v]) => [k, { edgeLong: r6(v.edgeLong), edgeShort: r6(v.edgeShort), pTP: r6(v.pTP), pTimeout: r6(v.pTimeout) }])) },
        };
        // player-strategy stress (direction chosen from the last k seconds before commit)
        row.strategyStress = Object.fromEntries(Object.entries(ex.strategies).map(([k, sx]) => [k, sx ? { n: sx.n, houseEdge: r6(sx.houseEdge), pTP: r6(sx.pTP) } : null]));
        row.stats.momentumWorstEdge = r6(Math.min(...['momentum:5', 'momentum:10', 'momentum:30'].map((k) => ex.strategies[k].houseEdge)));
        if (tier.M <= 2) {
          row.entryDelaySweep = {};
          for (const lag of [3, 4, 6, 10]) {
            const e2 = simulateExact(p, D, T, S, tier.M, lag).strategies;
            row.entryDelaySweep[lag] = { 'momentum:5': r6(e2['momentum:5'].houseEdge), 'momentum:10': r6(e2['momentum:10'].houseEdge), 'momentum:30': r6(e2['momentum:30'].houseEdge) };
          }
          row.entryDelaySweep[2] = { 'momentum:5': r6(ex.strategies['momentum:5'].houseEdge), 'momentum:10': r6(ex.strategies['momentum:10'].houseEdge), 'momentum:30': r6(ex.strategies['momentum:30'].houseEdge) };
        }
      }
      if (!sel.enabled) row.disabledReason = sel.reason;
      if (sel.maxPTPedgeOk) row.maxPTPUnderConstraints = sel.maxPTPedgeOk;
      tiers.push(row);
      console.log(`[cal]   D=${D} ${tier.label.padEnd(6)} ${sel.enabled ? 'ON ' : 'off'} T=${row.targetPpm} S=${row.stopPpm} pTP=${pct(row.stats?.pTP)} pSL=${pct(row.stats?.pSL)} pTO=${pct(row.stats?.pTimeout)} edge=${pct(row.stats?.houseEdge)} worst=${pct(row.stats?.worstRegimeEdge)} mom=${pct(row.stats?.momentumWorstEdge)} ${sel.enabled ? '' : '| ' + sel.reason}`);
    }
    perD[D][a.sym] = tiers;
  }
  console.log(`[cal] ${a.sym} done (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// choose D: more enabled tiers, then higher touch-resolution, then shorter
const scoreD = (D) => {
  let enabled = 0, touch = 0, n = 0;
  for (const tiers of Object.values(perD[D])) for (const t of tiers) { if (t.enabled) { enabled++; touch += 1 - t.stats.pTimeout; n++; } }
  return { D, enabled, meanTouchRate: n ? touch / n : 0 };
};
const dScores = DURATIONS.map(scoreD);
const recD = [...dScores].sort((a, b) => b.enabled - a.enabled || b.meanTouchRate - a.meanTouchRate || a.D - b.D)[0].D;
full.durations = { scores: dScores, recommended: recD, perD };
globalThis.__perD = perD;
full.proxyCheck = proxyCheck();

const lane = {
  version: 1,
  sigmaModeForConstraints: SIGMA_MODE,
  generatedAt: full.generatedAt,
  recommendedDurationSec: recD,
  warnings: [
    'Calibrated on Binance 1 s closes, NOT on Supra rounds: Supra is smoother (sigma1s ~20-37% lower) and lags Binance by ~1-2 s (spike-report.md section 6.4).',
    'Informed-flow risk: on the recorded Supra hour a player betting the direction of Binance\'s last 5 s had positive expectation on every CRUISE/BOOST lane even with an 8 s entry delay; Supra-only 5 s momentum was negative-edge on all 20 lanes (spike-report.md section 6.3). Do not use with real value before Supra-native re-validation.',
    'Tiers with enabled=false carry the closest candidate (T,S,stats) for reference only; see disabledReason.',
  ],
  methodology: {
    data: 'Binance spot 1-second klines (close), data-api.binance.vision, used as a proxy for Supra DORA-2 per-second rounds (see results/t4-calibration-full.json proxyCheck for the Supra-vs-Binance validation).',
    roundModel: 'entry = p[s]; seconds s+1..s+D checked in order; first touch wins (inclusive): favourable >= targetPpm -> stake*M; adverse >= stopPpm -> 0; else at s+D stake*V(r)*(1-fee), V=1+(M-1)r/T (r>=0), 1-|r|/S (r<0); r = simple return vs entry in ppm. LONG and SHORT, every start second (stride 1).',
    sigma1sPpm: 'plain standard deviation of 1-second simple returns (ppm) over the window (includes microstructure noise; conservative for S>=4*sigma and the gap margin). Robust alternatives reported in results/t4-calibration-full.json.',
    gapMarginPpm: `${GAP_K} * sigma1sPpm (Broadie-Glasserman-Kou discrete-monitoring shift beta = -zeta(1/2)/sqrt(2*pi))`,
    maxJumpPpm: 'niceCeil(max(2 * max observed |1s return|, 10 * p99.99 |1s return|)) over the window: should essentially never trigger on real data.',
    constraints: { guard: '(M-1)*S + max(0, M-2)*gapMarginPpm <= T', stopMin: 'S >= 4*sigma1sPpm', houseEdge: '[2%, 6%], target 3-4%', worstRegimeEdge: '>= 0 over {vol-quartile hours Q1..Q4, weekday, weekend} x {LONG, SHORT}', pTPBands: Object.fromEntries(TIERS.map((t) => [t.label, t.band])) },
    selection: 'exhaustive (T,S) grid (log-spaced 0.5..120 sigma, 110 levels) -> filter constraints -> prefer edge in [3%,4%], then highest touch-resolution P(TP)+P(SL), then edge closest to 3.5%; final values rounded to integer ppm (guard preserved) and re-simulated exactly.',
    houseEdge: '1 - E[payout/stake], LONG/SHORT averaged (50/50 flow). worstRegimeEdge = min over regimes and directions.',
    statisticalPrecision: '~30k independent D-second windows per asset in 7 days => edge standard error roughly +-0.3-0.6 percentage points; treat 2% as the practical floor.',
  },
  dataWindow: { source: meta.source, startMs: meta.startMs, endMs: meta.endMs, startIso: new Date(meta.startMs).toISOString(), endIso: new Date(meta.endMs).toISOString(), seconds: meta.seconds },
  assets: Object.fromEntries(ASSETS.map((a) => [a.sym, {
    pairId: a.pairId,
    sigma1sPpm: Math.round(full.assets[a.sym].sigma1sPlainPpm * 100) / 100,
    sigma1sRobustPpm: Math.round(full.assets[a.sym].sigma1sBipowerPpm * 100) / 100,
    gapMarginPpm: Math.round(full.assets[a.sym].gapMarginPpm * 100) / 100,
    maxJumpPpm: full.assets[a.sym].maxJumpPpm,
    durationSec: recD,
    tiers: perD[recD][a.sym].map(({ grid, strategyStress, maxPTPUnderConstraints, entryDelaySweep, ...t }) => t),
  }])),
};
fs.mkdirSync(path.join(ROOT, 'results'), { recursive: true });
const laneOut = SIGMA_MODE === 'plain' ? 'lane-params.json' : `results/lane-params-${SIGMA_MODE}-sigma.json`;
const fullOut = SIGMA_MODE === 'plain' ? 'results/t4-calibration-full.json' : `results/t4-calibration-${SIGMA_MODE}-sigma.json`;
fs.writeFileSync(path.join(ROOT, laneOut), JSON.stringify(lane, null, 1));
fs.writeFileSync(path.join(ROOT, fullOut), JSON.stringify(full, (k, v) => (v instanceof Float64Array ? Array.from(v) : v), 1));
console.log(`[cal] D scores ${JSON.stringify(dScores)} -> recommended D=${recD}; wrote ${laneOut} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

function niceCeil(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= x) return Math.round(m * e);
  return Math.round(10 * e);
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
