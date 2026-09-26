// Compiles Stubs.sol with a local solc (SOLC env, default ~/.local/share/svm/0.8.28/solc-0.8.28)
// and writes stubs.artifacts.json (abi + bytecode). Tests only read the committed artifact.
//   node server/test/recorder/harness/build-stubs.ts

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const solc = process.env.SOLC ?? join(homedir(), '.local/share/svm/0.8.28/solc-0.8.28');
const input = {
  language: 'Solidity',
  sources: { 'Stubs.sol': { content: readFileSync(join(here, 'Stubs.sol'), 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const out = JSON.parse(execFileSync(solc, ['--standard-json'], { input: JSON.stringify(input), maxBuffer: 64 * 1024 * 1024 }).toString());
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === 'error');
if (errors.length > 0) {
  console.error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join('\n'));
  process.exit(1);
}
const artifacts: Record<string, { abi: unknown; bytecode: string }> = {};
for (const name of ['StubCheckpointOracle', 'StubArena', 'StubFaucet']) {
  const c = out.contracts['Stubs.sol'][name];
  artifacts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
}
writeFileSync(join(here, 'stubs.artifacts.json'), `${JSON.stringify({ compiler: 'solc 0.8.28 viaIR cancun', artifacts }, null, 1)}\n`);
console.log('wrote stubs.artifacts.json', Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, (v.bytecode.length - 2) / 2])));
