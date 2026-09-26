// Golden vectors for the TS ↔ Solidity differential tests. Deterministic (seeded).
// `node scripts/gen-vectors.ts` writes vectors/*.json; `--check` fails if they drift.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTypedData, keccak256, toHex, type Address } from 'viem';
import { Direction } from '../src/enums.ts';
import { TYPE_STRINGS, arenaDomain, arenaTypes } from '../src/eip712.ts';
import { barrierPrices, directional, interiorPayout, maxPayout, touch, Touch } from '../src/lane.ts';
import { evaluatePath, type Checkpoint, type RoundTerms } from '../src/path.ts';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
const check = process.argv.includes('--check');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(0xb9b91a7e);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
const E18 = 10n ** 18n;
const BASE_PRICES = [612n * E18, 95_400n * E18, 2_850n * E18, 182n * E18, 245_000_000_000_000_000n];
const MULTIPLIERS = [15_000, 20_000, 30_000, 50_000];

const s = (v: bigint) => v.toString();

function jitter(p0: bigint, maxPpm: number): bigint {
  const ppm = BigInt(int(-maxPpm, maxPpm));
  return p0 + (p0 * ppm) / 1_000_000n;
}

function laneVectors() {
  const cases = [];
  for (let i = 0; i < 600; i++) {
    const direction = pick([Direction.Long, Direction.Short]);
    const p0 = BASE_PRICES[i % BASE_PRICES.length] + BigInt(int(0, 1_000_000_000));
    const targetPpm = int(10, 5_000);
    const stopPpm = int(10, 5_000);
    const multiplierBps = pick(MULTIPLIERS);
    const feeBps = int(0, 1_000);
    const stake = BigInt(int(1, 100)) * E18 + BigInt(int(0, 999_999));
    const edge = i % 5 === 0;
    let p: bigint;
    if (edge) {
      const b = barrierPrices(direction, p0, targetPpm, stopPpm);
      p = pick([b.target, b.stop, b.target + 1n, b.target - 1n, b.stop + 1n, b.stop - 1n, p0]);
    } else {
      p = jitter(p0, Math.max(targetPpm, stopPpm) * 2);
    }
    const { fav, mag } = directional(direction, p0, p);
    const t = touch(fav, mag, p0, targetPpm, stopPpm);
    cases.push({
      direction,
      p0: s(p0),
      p: s(p),
      targetPpm,
      stopPpm,
      multiplierBps,
      feeBps,
      stake: s(stake),
      expected: {
        fav,
        mag: s(mag),
        touch: t,
        maxPayout: s(maxPayout(stake, multiplierBps)),
        interiorPayout: t === Touch.None ? s(interiorPayout(stake, fav, mag, p0, targetPpm, stopPpm, multiplierBps, feeBps)) : '0',
      },
    });
  }
  return { version: 1, generator: 'packages/shared/scripts/gen-vectors.ts', cases };
}

function pathVectors() {
  const cases = [];
  for (let i = 0; i < 300; i++) {
    const direction = pick([Direction.Long, Direction.Short]);
    const multiplierBps = pick(MULTIPLIERS);
    const stake = BigInt(int(5, 50)) * E18;
    const entrySec = 1_790_000_000 + i * 100;
    const duration = pick([20, 30]);
    const cashOut = rand() < 0.2;
    const endSec = cashOut ? entrySec + int(1, duration - 1) : entrySec + duration;
    const terms: RoundTerms = {
      direction,
      stake,
      maxPayout: maxPayout(stake, multiplierBps),
      entrySec,
      endSec,
      targetPpm: int(200, 1_200),
      stopPpm: int(150, 600),
      multiplierBps,
      feeBps: 100,
      maxJumpPpm: pick([3_000, 5_000, 10_000]),
      cashOutRequested: cashOut,
    };

    const p0 = BASE_PRICES[i % BASE_PRICES.length];
    const checkpoints: (null | { price18: string; disputed: boolean })[] = [];
    const cps = new Map<number, Checkpoint>();
    let price = p0;
    const stepPpm = pick([30, 80, 400]);
    const terminalSpike = rand() < 0.06;
    for (let sec = entrySec; sec <= endSec; sec++) {
      if (sec > entrySec) price = jitter(price, rand() < 0.03 ? 20_000 : stepPpm);
      if (terminalSpike && sec === endSec) price = price + (price * 3n) / 100n;
      const missing = sec > entrySec && rand() < 0.03;
      const disputed = rand() < 0.02;
      if (missing) {
        checkpoints.push(null);
        continue;
      }
      checkpoints.push({ price18: s(price), disputed });
      cps.set(sec, { price18: price, disputed });
    }
    const permanentlyMissing = checkpoints.flatMap((c, k) => (c === null && rand() < 0.5 ? [entrySec + k] : []));
    const nowSec = rand() < 0.15 ? endSec + 400 : endSec + 2;
    const r = evaluatePath(terms, { get: (sec) => cps.get(sec), isPermanentlyMissing: (sec) => permanentlyMissing.includes(sec) }, nowSec);

    cases.push({
      terms: { ...terms, stake: s(terms.stake), maxPayout: s(terms.maxPayout) },
      checkpoints,
      permanentlyMissing,
      nowSec,
      expected: r.decidable
        ? { decidable: true, outcome: r.outcome, payout: s(r.payout), decisionSec: r.decisionSec, voidReason: r.voidReason, missingSec: 0 }
        : { decidable: false, outcome: 0, payout: '0', decisionSec: 0, voidReason: 0, missingSec: r.missingSec },
    });
  }
  return { version: 1, generator: 'packages/shared/scripts/gen-vectors.ts', cases };
}

function eip712Vectors() {
  const verifyingContract = '0x00000000000000000000000000000000000000A1' as Address;
  const domain = arenaDomain(97, verifyingContract);
  const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;
  const openRound = [];
  const cashOut = [];
  const withdraw = [];
  for (let i = 0; i < 40; i++) {
    const m = {
      player: addr(int(1, 1_000_000)),
      assetId: int(0, 4),
      tier: int(0, 3),
      direction: int(0, 1),
      stake: BigInt(int(1, 100)) * E18,
      laneVersion: int(1, 50),
      oracleIdx: int(0, 1),
      nonce: BigInt(int(0, 10_000)),
      deadline: 1_790_000_000 + int(0, 100_000),
    };
    openRound.push({ message: { ...m, stake: s(m.stake), nonce: s(m.nonce) }, digest: hashTypedData({ domain, types: arenaTypes, primaryType: 'OpenRound', message: m }) });

    const c = { player: addr(int(1, 1_000_000)), roundId: BigInt(int(1, 1_000_000)), deadline: 1_790_000_000 + int(0, 100_000) };
    cashOut.push({ message: { ...c, roundId: s(c.roundId) }, digest: hashTypedData({ domain, types: arenaTypes, primaryType: 'CashOut', message: c }) });

    const w = { player: addr(int(1, 1_000_000)), to: addr(int(1, 1_000_000)), amount: BigInt(int(1, 1_000)) * E18, nonce: BigInt(int(0, 10_000)), deadline: 1_790_000_000 + int(0, 100_000) };
    withdraw.push({ message: { ...w, amount: s(w.amount), nonce: s(w.nonce) }, digest: hashTypedData({ domain, types: arenaTypes, primaryType: 'Withdraw', message: w }) });
  }
  const typeHashes = Object.fromEntries(Object.entries(TYPE_STRINGS).map(([k, v]) => [k, keccak256(toHex(v))]));
  return { version: 1, generator: 'packages/shared/scripts/gen-vectors.ts', domain, typeStrings: TYPE_STRINGS, typeHashes, openRound, cashOut, withdraw };
}

const outputs: Record<string, unknown> = {
  'lane-vectors.json': laneVectors(),
  'path-vectors.json': pathVectors(),
  'eip712-vectors.json': eip712Vectors(),
};

let drift = false;
for (const [file, data] of Object.entries(outputs)) {
  const path = join(outDir, file);
  const json = `${JSON.stringify(data)}\n`;
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* missing counts as drift */
    }
    if (current !== json) {
      drift = true;
      console.error(`drift: ${file}`);
    }
  } else {
    writeFileSync(path, json);
    console.log(`wrote ${file}`);
  }
}
if (drift) process.exit(1);
