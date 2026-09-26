// Live soak of the price hub against the real Supra DORA-2 testnet REST endpoint (read-only).
//   node server/test/pricehub/live-hub.ts [durationSec=600] [out.json]
// Logs per-minute summaries, then prints a JSON verdict: missed seconds per pair, lag and RTT
// percentiles, request errors, plus σ₁ₛ (bipower, Supra) per asset and the adaptive-lane k.

import { writeFileSync } from 'node:fs';
import { ASSETS } from '@bnbplay/shared/assets';
import { Bus } from '../../src/bus.ts';
import { BASE_LANES } from '../../src/ops/lanes.ts';
import { createPriceHub } from '../../src/pricehub/index.ts';
import { percentile } from '../../src/pricehub/stats.ts';
import { createLogger } from '../../src/relayer/log.ts';

const durationSec = Number(process.argv[2] ?? 600);
const out = process.argv[3];
const bus = new Bus();
const lags: number[] = [];
bus.on('oracle.round', (r) => lags.push(r.receivedAtMs - Number(r.roundMs)));
const hub = createPriceHub({
  config: {
    SUPRA_REST_URL: process.env.SUPRA_REST_URL ?? 'https://rpc-testnet-dora-2.supra.com',
    SUPRA_POLL_MS: 200,
    ORACLE_STALE_MS: 3000,
    ORACLE_PROOF_RETENTION_H: 6,
    ORACLE_ROUND_RETENTION_D: 3,
  },
  bus,
  log: createLogger('pricehub', 'info'),
});
await hub.start();
const startSec = Math.floor(Date.now() / 1000) + 2;
await new Promise((r) => setTimeout(r, durationSec * 1000));
const endSec = Math.floor(Date.now() / 1000) - 2;
await hub.stop();

const m = hub.metrics;
const perPair: Record<string, unknown> = {};
for (const a of ASSETS) {
  const rounds = hub.rounds(a.supraPairId, startSec, endSec);
  const have = new Set(rounds.map((r) => r.sec));
  const missing: number[] = [];
  for (let s = startSec; s <= endSec; s++) if (!have.has(s)) missing.push(s);
  const sigma = hub.sigmaBipower(a.supraPairId, durationSec);
  const base = BASE_LANES[a.assetId].sigmaBasePpm;
  perPair[a.symbol] = {
    pairId: a.supraPairId,
    secondsWindow: endSec - startSec + 1,
    secondsSeen: have.size,
    missing: missing.length,
    missingSecs: missing.slice(0, 20),
    sigma1sBipowerPpm: sigma.sigmaPpm,
    kVsBase: sigma.sigmaPpm === null ? null : Math.min(2, Math.max(0.5, sigma.sigmaPpm / base)),
  };
}
const verdict = {
  startedAt: new Date(m.startedAtMs).toISOString(),
  durationSec,
  window: { startSec, endSec },
  requests: { polls: m.polls, ok: m.ok, http429: m.http429, httpErrors: m.httpErrors, netErrors: m.netErrors, decodeErrors: m.decodeErrors, newProofs: m.newProofs, duplicateProofs: m.duplicateProofs },
  nonCanonical: m.nonCanonical,
  regressions: m.regressions,
  hubMissingByPair: m.missingByPair,
  lagMs: { p50: percentile(lags, 0.5), p95: percentile(lags, 0.95), p99: percentile(lags, 0.99), max: lags.length ? Math.max(...lags) : null, n: lags.length },
  perPair,
};
console.log(JSON.stringify(verdict, null, 2));
if (out) writeFileSync(out, JSON.stringify(verdict, null, 2));
