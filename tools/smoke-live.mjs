#!/usr/bin/env node
// Live end-to-end smoke test against the deployed API (no browser): guest login → faucet →
// open a round → poll until it settles. Mirrors exactly what the web client signs.
// Usage: node tools/smoke-live.mjs [apiUrl]

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = process.argv[2] ?? process.env.SMOKE_API_URL ?? 'https://bnb-play-server-production.up.railway.app';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function j(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  log('guest account', account.address);

  const config = await j('/v1/config');
  if (!config.contracts) throw new Error('no contracts deployed (config.contracts is null)');
  log('chain', config.chainId, 'arena', config.contracts.arena);
  const asset = config.assets.find((a) => a.tiers.some((t) => t.enabled));
  const tier = asset.tiers.find((t) => t.enabled);
  log('using', asset.symbol, tier.label, `T=${tier.targetPpm}ppm S=${tier.stopPpm}ppm M=${tier.multiplierBps / 10_000}x dur=${tier.durationSec}s`);

  // 1. Auth: EIP-712 Login, off-chain only.
  const challenge = await j('/v1/auth/challenge', { method: 'POST', body: JSON.stringify({ address: account.address }) });
  const domain = { name: 'BnbPlayAPI', version: '1', chainId: config.chainId };
  const types = { Login: [{ name: 'player', type: 'address' }, { name: 'salt', type: 'bytes32' }, { name: 'expiresAt', type: 'uint48' }] };
  const message = { player: account.address, salt: challenge.salt, expiresAt: challenge.expiresAt };
  const signature = await account.signTypedData({ domain, types, primaryType: 'Login', message });
  const session = await j('/v1/auth/session', {
    method: 'POST',
    body: JSON.stringify({ address: account.address, salt: challenge.salt, expiresAt: challenge.expiresAt, signature, kind: 'guest' }),
  });
  const auth = { Authorization: `Bearer ${session.token}` };
  log('session ok, expires', new Date(session.expiresAt * 1000).toISOString());

  // 2. Faucet (auto-drips on first guest login server-side too, but claim explicitly to be sure).
  let balance = await j('/v1/me/balance', { headers: auth });
  log('balance before faucet', balance);
  if (BigInt(balance.available) === 0n) {
    try {
      await j('/v1/faucet/claim', { method: 'POST', headers: auth, body: '{}' });
      log('faucet claimed');
    } catch (e) {
      log('faucet claim:', e.message);
    }
    for (let i = 0; i < 20 && BigInt(balance.available) === 0n; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      balance = await j('/v1/me/balance', { headers: auth });
    }
  }
  log('balance', balance);
  if (BigInt(balance.available) === 0n) throw new Error('faucet did not credit a balance in time');

  // 3. Open a round: EIP-712 OpenRound intent (arena domain), stake = tier minStake.
  const stake = BigInt(tier.minStake);
  const arenaDomain = { name: 'BnbPlayArena', version: '1', chainId: config.chainId, verifyingContract: config.contracts.arena };
  const arenaTypes = {
    OpenRound: [
      { name: 'player', type: 'address' },
      { name: 'assetId', type: 'uint8' },
      { name: 'tier', type: 'uint8' },
      { name: 'direction', type: 'uint8' },
      { name: 'stake', type: 'uint128' },
      { name: 'laneVersion', type: 'uint32' },
      { name: 'oracleIdx', type: 'uint8' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint48' },
    ],
  };
  const deadline = Math.floor(Date.now() / 1000) + 15;
  const intent = {
    player: account.address,
    assetId: asset.assetId,
    tier: tier.tier,
    direction: 0, // LONG
    stake: stake.toString(),
    laneVersion: tier.laneVersion,
    oracleIdx: config.activeOracleIdx,
    nonce: '0',
    deadline,
  };
  const openSig = await account.signTypedData({
    domain: arenaDomain,
    types: arenaTypes,
    primaryType: 'OpenRound',
    message: { ...intent, stake, nonce: 0n, deadline },
  });
  const openRes = await j('/v1/rounds/open', { method: 'POST', headers: auth, body: JSON.stringify({ intent, signature: openSig }) });
  log('open submitted', openRes);

  // 4. Poll for the round to open, then settle.
  let round;
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const rounds = await j(`/v1/players/${account.address}/rounds?limit=1`, { headers: auth });
    round = rounds.items?.[0];
    if (round?.status === 'open' && round.entryPrice) {
      log(`entry locked after ${((Date.now() - t0) / 1000).toFixed(1)}s @ ${round.entryPrice}`);
      break;
    }
  }
  if (!round) throw new Error('round never appeared');

  for (let i = 0; i < 90 && round?.status !== 'settled'; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const rounds = await j(`/v1/players/${account.address}/rounds?limit=1`, { headers: auth }).catch(() => undefined);
    if (rounds?.items?.[0]) round = rounds.items[0];
  }
  if (round?.status !== 'settled') throw new Error(`round did not settle within budget: ${JSON.stringify(round)}`);
  log(`settled after ${((Date.now() - t0) / 1000).toFixed(1)}s: outcome=${round.outcome} payout=${round.payout} txHash=${round.settleTx}`);
  log(`explorer: ${config.explorer}/tx/${round.settleTx}`);

  const finalBalance = await j('/v1/me/balance', { headers: auth });
  log('final balance', finalBalance);

  console.log('\nSMOKE TEST: PASS');
}

main().catch((err) => {
  console.error('\nSMOKE TEST: FAIL —', err.message);
  process.exit(1);
});
