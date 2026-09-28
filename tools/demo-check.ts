#!/usr/bin/env node
// Pre-demo readiness gate (M4 DoD). Run before every judging session:
//   node tools/demo-check.ts [apiUrl]
// Exits non-zero if anything would embarrass a live demo.

const API = process.argv[2] ?? process.env.DEMO_API_URL ?? 'https://bnb-play-server-production.up.railway.app';
const WEB = process.env.DEMO_WEB_URL ?? 'https://bnb-play.vercel.app';

const ok = (b: boolean) => (b ? '\x1b[32mOK\x1b[0m' : '\x1b[31mFAIL\x1b[0m');
let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log(`  ${ok(false)}  ${msg}`);
};
const pass = (msg: string) => console.log(`  ${ok(true)}  ${msg}`);

async function getJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  return { res, body: await res.json().catch(() => undefined) };
}

async function main() {
  console.log(`Tagei demo-check — ${new Date().toISOString()}\n`);

  console.log('web');
  {
    const res = await fetch(WEB, { signal: AbortSignal.timeout(8000) }).catch((e) => ({ ok: false, status: 0, error: e }) as const);
    if ('ok' in res && res.ok) pass(`${WEB} responds (${res.status})`);
    else fail(`${WEB} unreachable`);
  }

  console.log('server');
  const { res: healthRes, body: health } = await getJson(`${API}/healthz`);
  if (healthRes.ok && health?.ok) pass(`healthz (${API}, v${health.version})`);
  else fail(`healthz: ${JSON.stringify(health)}`);

  const { res: readyRes, body: ready } = await getJson(`${API}/readyz`);
  if (!readyRes.ok || !ready?.ok) {
    fail(`readyz reports not-ready: ${JSON.stringify(ready)}`);
  } else {
    for (const c of ready.checks ?? []) {
      if (c.ok) pass(`${c.name}: ${JSON.stringify(c.detail ?? {})}`);
      else fail(`${c.name}: ${JSON.stringify(c.detail ?? {})}`);
    }
  }

  const senderBal = ready?.checks?.find((c: { name: string }) => c.name === 'sender-balances')?.detail as
    | Record<string, string>
    | undefined;
  if (senderBal) {
    for (const [key, v] of Object.entries(senderBal)) {
      const bnb = Number(v);
      if (bnb < 0.02) fail(`${key} key is low on tBNB (${v}) — top up via https://faucet.quicknode.com/binance-smart-chain/bnb-testnet`);
      else pass(`${key} balance ${v} tBNB`);
    }
  }

  console.log('config & lanes');
  const { res: cfgRes, body: config } = await getJson(`${API}/v1/config`);
  if (!cfgRes.ok || !config?.contracts) {
    fail('contracts not deployed (config.contracts is null)');
  } else {
    pass(`arena ${config.contracts.arena} on chain ${config.chainId}`);
    for (const asset of config.assets ?? []) {
      const enabled = asset.tiers.filter((t: { enabled: boolean }) => t.enabled).map((t: { label: string }) => t.label);
      if (enabled.length === 0) fail(`${asset.symbol}: no enabled tiers`);
      else pass(`${asset.symbol}: ${enabled.join('/')}`);
    }
  }

  console.log('oracle calibration (informational — never shown to players as win odds)');
  const { res: calRes, body: cal } = await getJson(`${API}/v1/oracle/calibration`);
  if (calRes.ok && Array.isArray(cal?.assets)) {
    for (const c of cal.assets) pass(`${c.asset}: sigma1s live=${c.sigma1sPpm?.live ?? 'n/a'} backtest=${c.sigma1sPpm?.backtest}`);
  } else {
    console.log('  (calibration endpoint not available — non-blocking)');
  }

  console.log('\nlive round smoke test (guest -> faucet -> open -> settle)');
  if (!process.argv.includes('--smoke')) {
    // Opt-in only: each run creates a guest and drips real faucet funds, which shares the
    // same per-IP-hash daily cap (3/day) as real players on this network. Running this by
    // default before every demo would burn the same quota judges need. Pass --smoke to run it.
    console.log('  skipped (pass --smoke to run; it consumes 1 of the 3 faucet claims/day for this IP)');
  } else {
    try {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(process.execPath, [new URL('./smoke-live.mjs', import.meta.url).pathname, API], {
        stdio: 'inherit',
        timeout: 120_000,
      });
      if (r.status === 0) pass('smoke-live.mjs PASS');
      else fail(`smoke-live.mjs exited ${r.status}`);
    } catch (e) {
      fail(`smoke-live.mjs crashed: ${e}`);
    }
  }

  console.log(`\n${failed ? '\x1b[31mDEMO NOT READY\x1b[0m' : '\x1b[32mDEMO READY\x1b[0m'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
