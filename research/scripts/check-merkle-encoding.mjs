#!/usr/bin/env node
// Validates the recovered Supra leaf encoding + OZ multiproof off-chain on every captured proof:
//   node scripts/check-merkle-encoding.mjs [data/proofs-main-XXXX.ndjson] [fixtures/supra-97-XXXX.json]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { decodeAbiParameters, keccak256, concat, toHex } from 'viem';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ABI = JSON.parse(fs.readFileSync(path.join(ROOT, 'abi/oracleProofV2.json'), 'utf8'));
const le = (v, n) => { let x = BigInt(v); const b = new Uint8Array(n); for (let i = 0; i < n; i++) { b[i] = Number(x & 0xffn); x >>= 8n; } return toHex(b); };
const leaf = (f) => keccak256(concat([le(f.pair, 4), le(f.price, 16), le(f.timestamp, 8), le(f.decimals, 2), le(f.round, 8)]));
const hp = (a, b) => (BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a])));
function root(proof, flags, leaves) {
  if (leaves.length + proof.length !== flags.length + 1) return null;
  const h = []; let li = 0, hi = 0, pi = 0;
  for (let i = 0; i < flags.length; i++) { const a = li < leaves.length ? leaves[li++] : h[hi++]; const b = flags[i] ? (li < leaves.length ? leaves[li++] : h[hi++]) : proof[pi++]; h[i] = hp(a, b); }
  return flags.length ? (pi === proof.length ? h[flags.length - 1] : null) : leaves[0];
}
const check = (hex) => decodeAbiParameters(ABI, hex)[0].data.every((d) => root(d.committee_data.proof, d.committee_data.flags, d.committee_data.committee_feed.map(leaf)) === d.root);
const dataDir = path.join(ROOT, 'data');
const sidecar = process.argv[2] ?? path.join(dataDir, fs.readdirSync(dataDir).filter((f) => f.startsWith('proofs-main-')).sort().pop());
const fixture = process.argv[3] ?? path.join(ROOT, 'fixtures', fs.readdirSync(path.join(ROOT, 'fixtures')).sort().pop());
let ok = 0, bad = 0;
for (const p of JSON.parse(fs.readFileSync(fixture, 'utf8')).proofs) check(p.proof) ? ok++ : bad++;
console.log(`fixture ${path.basename(fixture)}: ${ok} ok, ${bad} mismatch`);
ok = 0; bad = 0;
const rl = readline.createInterface({ input: fs.createReadStream(sidecar) });
for await (const line of rl) { if (!line.trim()) continue; check(JSON.parse(line).proof) ? ok++ : bad++; }
console.log(`sidecar ${path.basename(sidecar)}: ${ok} ok, ${bad} mismatch`);
