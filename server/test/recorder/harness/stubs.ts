// Deploys the Stubs.sol test doubles on anvil and configures assets + tier-0 lanes.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http, type Abi, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ASSETS } from '@bnbplay/shared/assets';
import { arenaAbi } from '../../../src/recorder/abi.ts';
import { BASE_LANES } from '../../../src/ops/lanes.ts';
import { chainFor } from '../../../src/relayer/chain.ts';
import { ANVIL_URL } from './anvil.ts';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = JSON.parse(readFileSync(join(here, 'stubs.artifacts.json'), 'utf8')).artifacts as Record<string, { abi: Abi; bytecode: Hex }>;

export const MAX_JUMP: Record<number, number> = { 0: 15_000, 1: 10_000, 2: 15_000, 3: 20_000, 4: 40_000 };
export const TEST_DURATION_SEC = 20; // 21 checkpoints per full round

export function wallet(pk: Hex) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: chainFor(31337, [ANVIL_URL]), transport: http(ANVIL_URL) });
}

export async function send(pc: PublicClient, pk: Hex, to: Address, data: Hex): Promise<void> {
  const w = wallet(pk);
  const hash = await w.sendTransaction({ to, data });
  const r = await pc.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  if (r.status !== 'success') throw new Error(`tx ${hash} reverted`);
}

async function deploy(pc: PublicClient, pk: Hex, name: string, args: unknown[] = []): Promise<Address> {
  const w = wallet(pk);
  const a = artifacts[name];
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const r = await pc.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  if (!r.contractAddress) throw new Error(`deploy ${name} failed`);
  return r.contractAddress;
}

export async function deployStubs(pc: PublicClient, deployerPk: Hex, opsAddress: Address): Promise<{ arena: Address; oracle: Address; faucet: Address; deployBlock: bigint }> {
  const deployBlock = await pc.getBlockNumber();
  const oracle = await deploy(pc, deployerPk, 'StubCheckpointOracle');
  const arena = await deploy(pc, deployerPk, 'StubArena');
  const faucet = await deploy(pc, deployerPk, 'StubFaucet', [arena, opsAddress]);
  const w = wallet(deployerPk);
  const call = async (functionName: 'addOracle' | 'setAsset' | 'setLane', args: readonly unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await w.writeContract({ address: arena, abi: arenaAbi, functionName, args } as any);
    await pc.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  };
  await call('addOracle', [oracle]);
  for (const a of ASSETS) {
    await call('setAsset', [a.assetId, { pairId: a.supraPairId, maxJumpPpm: MAX_JUMP[a.assetId], gapMarginPpm: 40, enabled: true }]);
    const t = BASE_LANES[a.assetId].tiers[0];
    await call('setLane', [
      a.assetId,
      0,
      { targetPpm: t.targetPpm, stopPpm: t.stopPpm, multiplierBps: 15_000, feeBps: 100, durationSec: TEST_DURATION_SEC, enabled: true, minStake: 5n * 10n ** 18n, maxStake: 50n * 10n ** 18n },
    ]);
  }
  return { arena, oracle, faucet, deployBlock };
}
