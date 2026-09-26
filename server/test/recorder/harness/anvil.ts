// Starts anvil on the A3 port (8548) for the integration suite and kills it by PID.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export const ANVIL_PORT = 8548;
export const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`;
/** anvil's default mnemonic accounts (test keys, never funded anywhere real). */
export const ANVIL_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
] as const;

export const anvilAvailable = (): boolean => spawnSync('anvil', ['--version']).status === 0;

export async function startAnvil(args: string[] = []): Promise<{ proc: ChildProcess; stop(): Promise<void> }> {
  const proc = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent', '--chain-id', '31337', ...args], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(ANVIL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    proc,
    stop: () =>
      new Promise<void>((r) => {
        if (proc.exitCode !== null) return r();
        proc.once('exit', () => r());
        proc.kill('SIGTERM');
      }),
  };
}

export async function anvilRpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(ANVIL_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}
