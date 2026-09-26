#!/usr/bin/env node
// Prints the markdown tables used in spike-report.md from results/*.json and lane-params.json.
//   node scripts/report-tables.mjs > data/report-tables.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const t1 = J('results/t1-metrics.json');
const t4 = J('results/t4-calibration-full.json');
const t4r = fs.existsSync(path.join(ROOT, 'results/t4-calibration-robust-sigma.json')) ? J('results/t4-calibration-robust-sigma.json') : null;
const lane = J('lane-params.json');
const rtt = J('results/t5-rtt.json');
const NAMES = { 0: 'BTC', 1: 'ETH', 3: 'DOGE', 10: 'SOL', 49: 'BNB' };
const pct = (x, d = 1) => (x == null ? '-' : (100 * x).toFixed(d) + '%');
const f0 = (x) => (x == null ? '-' : Math.round(x).toString());
const out = [];
const t1Out = [], t4Out = [];
let cur = t1Out;
const P = (s = '') => cur.push(s);

const m = t1.main;
P(`### T1 recording: ${m.runId}, ${m.durationS?.toFixed(0)} s at ${m.hz} Hz (${new Date(m.startMs).toISOString()})`);
P();
P('| pair | rounds seen | seconds spanned | missing | % seconds with a round | longest gap (s) | first-seen − round start p50 / p95 / p99 / max (ms) |');
P('|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(m.perPair)) {
  const l = v.firstSeenMinusRoundStartMs;
  P(`| ${NAMES[k]} (${k}) | ${v.roundsSeen} | ${v.secondsSpanned} | ${v.missingSeconds} | ${v.pctSecondsWithRound}% | ${v.longestGapSec} | ${l.p50} / ${l.p95} / ${l.p99} / ${l.max} |`);
}
P();
const a = m.allPairs, c = m.consistency, rq = m.requests, b = m.bsc;
P('| metric | value |');
P('|---|---|');
P(`| requests (5 Hz) | ${rq.sent} sent, ${rq.ok} OK, error rate ${rq.errorRatePct}% , HTTP 429: ${rq.http429}, statuses ${JSON.stringify(rq.statusCounts)} |`);
if (t1.burst10Hz) { const bq = t1.burst10Hz.requests; P(`| requests (10 Hz burst, ${t1.burst10Hz.durationS?.toFixed(0)} s) | ${bq.sent} sent, ${bq.ok} OK, HTTP 429: ${bq.http429}, RTT p50/p95 ${bq.rttMs.p50}/${bq.rttMs.p95} ms |`); }
P(`| REST RTT (keep-alive, in recorder) | p50 ${rq.rttMs.p50} / p95 ${rq.rttMs.p95} / p99 ${rq.rttMs.p99} / max ${rq.rttMs.max} ms |`);
P(`| first-seen − round start, all pairs (response received) | p50 ${a.firstSeenMinusRoundStartMs_recv.p50} / p95 ${a.firstSeenMinusRoundStartMs_recv.p95} / p99 ${a.firstSeenMinusRoundStartMs_recv.p99} / max ${a.firstSeenMinusRoundStartMs_recv.max} ms |`);
P(`| first-seen − round start (request sent; lower bound incl. 200 ms poll quantisation) | p50 ${a.firstSeenMinusRoundStartMs_sent.p50} / p95 ${a.firstSeenMinusRoundStartMs_sent.p95} / p99 ${a.firstSeenMinusRoundStartMs_sent.p99} ms |`);
P(`| feed ts − round | min ${a.tsMinusRoundMs.min} / p50 ${a.tsMinusRoundMs.p50} / p95 ${a.tsMinusRoundMs.p95} / p99 ${a.tsMinusRoundMs.p99} / max ${a.tsMinusRoundMs.max} ms |`);
P(`| first-seen − feed ts | p50 ${a.firstSeenMinusFeedTsMs.p50} / p95 ${a.firstSeenMinusFeedTsMs.p95} / p99 ${a.firstSeenMinusFeedTsMs.p99} ms |`);
P(`| how long a round stays the served one | p50 ${a.roundServedDurationMs.p50} / p95 ${a.roundServedDurationMs.p95} / max ${a.roundServedDurationMs.max} ms |`);
P(`| consistency | ${c.pairRounds} (pair, round) keys; >1 value: ${c.pairRoundsWithMoreThanOneValue}; >1 proof hash: ${c.pairRoundsWithMoreThanOneProofHash}; round ≠ floor(ts/1000)·1000: ${c.roundNotEqualFloorTs}; proofs with mixed rounds: ${c.proofsWithMixedRounds}; served-round regressions: ${c.servedRoundRegressions} |`);
P(`| proof size | ${Object.entries(m.proofSizeBytes).map(([k, v]) => `${k} B × ${v}`).join(', ')} (5 pairs) |`);
P(`| BSC testnet block time | ${b.blockRate?.avgBlockTimeMs} ms avg (${b.blockRate?.blocks} blocks / ${b.blockRate?.seconds} s) |`);
P(`| age of HTTP "latest" block when observed (dataseed/bnbchain) | p50 ${b.latestBlockAgeAtObservationMs.p50} / p95 ${b.latestBlockAgeAtObservationMs.p95} / max ${b.latestBlockAgeAtObservationMs.max} ms |`);
P();
P('### T5 RTT (results/t5-rtt.json)');
P();
P('| endpoint | warm keep-alive p50 / p95 (ms) | cold (new TCP+TLS, curl) p50 / p95 (ms) |');
P('|---|---|---|');
for (const [k, v] of Object.entries(rtt.warmKeepAliveMs)) P(`| ${k} | ${v.p50} / ${v.p95} | ${rtt.coldCurlMs[k].total.p50} / ${rtt.coldCurlMs[k].total.p95} |`);
if (rtt.wss) P(`| WSS newHeads (${rtt.wss.url}) arrival − header milliTimestamp | ${rtt.wss.arrivalMinusHeaderMs?.p50} / ${rtt.wss.arrivalMinusHeaderMs?.p95} | - |`);
P();
cur = t4Out;
P('### T4 volatility (Binance 1 s closes, 7 days)');
P();
P('| asset | σ1s plain (ppm) | σ1s bipower (ppm) | σ_eff from 20 s returns | VR(20) | ACF(1) | zero-return seconds | approx tick (ppm) | \\|r1s\\| p99.9 / p99.99 / max (ppm) | gapMargin (ppm) | maxJumpPpm |');
P('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [s, v] of Object.entries(t4.assets)) P(`| ${s} | ${v.sigma1sPlainPpm.toFixed(1)} | ${v.sigma1sBipowerPpm.toFixed(1)} | ${v.sigmaEffFromHorizonPpm['20'].toFixed(1)} | ${v.varianceRatio['20'].toFixed(2)} | ${v.acf1s['1'].toFixed(3)} | ${v.zeroReturnPct.toFixed(1)}% | ${v.approxTickPpm.toFixed(1)} | ${f0(v.absReturnPpm.p999)} / ${f0(v.absReturnPpm.p9999)} / ${f0(v.absReturnPpm.max)} | ${v.gapMarginPpm.toFixed(1)} | ${v.maxJumpPpm} |`);
P();
const laneTable = (perD, D, title) => {
  P(`#### ${title} (D = ${D} s)`);
  P();
  P('| asset | tier | M | enabled | T (ppm) | S (ppm) | P(TP) | P(SL) | P(timeout) | house edge | worst-regime edge | momentum-player edge (entry delay 2 s) | note |');
  P('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [s, tiers] of Object.entries(perD[D])) for (const t of tiers) {
    const st = t.stats ?? {};
    const note = t.enabled ? '' : (t.disabledReason?.includes('unreachable') ? `P(TP) band unreachable; max ${t.disabledReason.match(/max P\(TP\) is ([\d.]+%)/)?.[1] ?? '?'}` : t.disabledReason ?? '');
    P(`| ${s} | ${t.label} | ${t.multiplierBps / 1e4}x | ${t.enabled ? '**yes**' : 'no'} | ${t.targetPpm ?? '-'} | ${t.stopPpm ?? '-'} | ${pct(st.pTP)} | ${pct(st.pSL)} | ${pct(st.pTimeout)} | ${pct(st.houseEdge, 2)} | ${pct(st.worstRegimeEdge, 2)} | ${pct(st.momentumWorstEdge, 2)} | ${note} |`);
  }
  P();
};
laneTable(t4.durations.perD, 30, 'Strict constraints as specified (σ = plain stdev) → lane-params.json');
laneTable(t4.durations.perD, 20, 'Strict constraints, alternative duration');
if (t4r) laneTable(t4r.durations.perD, 30, 'Sensitivity: σ = bipower (robust) in S ≥ 4σ and gap margin');
P('### Entry-delay sweep: momentum:5 player house edge (Binance, D = 30)');
P();
P('| asset | tier | base edge (50/50) | delay 2 s | 3 s | 4 s | 6 s | 10 s |');
P('|---|---|---|---|---|---|---|---|');
for (const [s, tiers] of Object.entries(t4.durations.perD['30'])) for (const t of tiers) if (t.entryDelaySweep) {
  const w = t.entryDelaySweep;
  P(`| ${s} | ${t.label} | ${pct(t.stats.houseEdge, 2)} | ${pct(w[2]['momentum:5'], 2)} | ${pct(w[3]['momentum:5'], 2)} | ${pct(w[4]['momentum:5'], 2)} | ${pct(w[6]['momentum:5'], 2)} | ${pct(w[10]['momentum:5'], 2)} |`);
}
P();
const pc = t4.proxyCheck;
if (pc?.perAsset) {
  P(`### Proxy check: Supra rounds vs Binance 1 s closes over the recorded window (${pc.supraSeries})`);
  P();
  P('| asset | n (s) | tracking error mean / sd / p95 abs / max abs (bps) | corr 1 s returns by lag (Binance kline t+lag vs Supra round t): −3 / −2 / −1 / 0 / +1 | corr 20 s returns at lag −2 / 0 | σ1s Supra / Binance (ppm) | VR(20) Supra / Binance | Supra ACF lags 1..5 |');
  P('|---|---|---|---|---|---|---|---|');
  for (const [s, v] of Object.entries(pc.perAsset)) {
    const L = v.lags, z = L['0'];
    P(`| ${s} | ${z.n} | ${z.trackingErrorBps.mean.toFixed(2)} / ${z.trackingErrorBps.sd.toFixed(2)} / ${z.trackingErrorBps.p95Abs.toFixed(2)} / ${z.trackingErrorBps.maxAbs.toFixed(2)} | ${['-3', '-2', '-1', '0', '1'].map((k) => L[k]?.corr1s?.toFixed(2)).join(' / ')} | ${L['-2'].corr20s.toFixed(2)} / ${z.corr20s.toFixed(2)} | ${v.supraStats.sigma1sPlainPpm.toFixed(1)} / ${v.binanceSameHourStats.sigma1sPlainPpm.toFixed(1)} | ${v.supraStats.varianceRatio['20'].toFixed(2)} / ${v.binanceSameHourStats.varianceRatio['20'].toFixed(2)} | ${[1, 2, 3, 4, 5].map((k) => v.supraStats.acf1s[k].toFixed(2)).join(', ')} |`);
  }
  P();
  P('#### Game metrics of the chosen lanes on the recorded hour: Supra path vs Binance path (D = 30)');
  P();
  P('| asset | tier | P(TP) Supra / Binance | P(timeout) Supra / Binance | house edge Supra / Binance | momentum:5 edge Supra / Binance | Binance-informed player on Supra, edge at entry delay 2 / 3 / 5 / 8 s (k = 5) |');
  P('|---|---|---|---|---|---|---|');
  for (const [s, v] of Object.entries(pc.perAsset)) for (const [label, g] of Object.entries(v.gameOnRecordedHour['30'] ?? {})) {
    const inf = v.binanceInformedOnSupra?.['30']?.[label];
    P(`| ${s} | ${label} | ${pct(g.supra.pTP)} / ${pct(g.binanceSameHour.pTP)} | ${pct(g.supra.pTimeout)} / ${pct(g.binanceSameHour.pTimeout)} | ${pct(g.supra.houseEdge, 2)} / ${pct(g.binanceSameHour.houseEdge, 2)} | ${pct(g.supra.momentum5Edge, 2)} / ${pct(g.binanceSameHour.momentum5Edge, 2)} | ${inf ? [2, 3, 5, 8].map((d) => pct(inf[`delay${d}_k5`]?.houseEdge, 1)).join(' / ') : '-'} |`);
  }
  P();
}
P('### lane-params.json summary');
P();
P('| asset | pairId | σ1s (ppm) | gapMargin (ppm) | maxJumpPpm | D (s) | enabled tiers |');
P('|---|---|---|---|---|---|---|');
for (const [s, v] of Object.entries(lane.assets)) P(`| ${s} | ${v.pairId} | ${v.sigma1sPpm} | ${v.gapMarginPpm} | ${v.maxJumpPpm} | ${v.durationSec} | ${v.tiers.filter((t) => t.enabled).map((t) => `${t.label} (T ${t.targetPpm}, S ${t.stopPpm})`).join(', ') || 'none'} |`);
const which = process.argv[2];
if (which === '--fill') {
  const rp = path.join(ROOT, 'spike-report.md');
  let r = fs.readFileSync(rp, 'utf8');
  r = r.replace(/<!-- T1_TABLES:BEGIN -->[\s\S]*?<!-- T1_TABLES:END -->|\{\{T1_TABLES\}\}/, `<!-- T1_TABLES:BEGIN -->\n${t1Out.join('\n')}\n<!-- T1_TABLES:END -->`);
  r = r.replace(/<!-- T4_TABLES:BEGIN -->[\s\S]*?<!-- T4_TABLES:END -->|\{\{T4_TABLES\}\}/, `<!-- T4_TABLES:BEGIN -->\n${t4Out.join('\n')}\n<!-- T4_TABLES:END -->`);
  fs.writeFileSync(rp, r);
  console.log('filled spike-report.md');
} else console.log([...t1Out, ...t4Out].join('\n'));
