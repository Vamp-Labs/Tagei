import type { Address } from 'viem';
import { DEPLOYMENTS_JSON } from './abi.ts';

// BSC testnet facts verified on 2026-09-26 (research/spike-report.md).
export const bscTestnet = {
  chainId: 97,
  name: 'BNB Smart Chain Testnet',
  nativeSymbol: 'tBNB',
  rpcHttp: [
    'https://bsc-testnet-dataseed.bnbchain.org',
    'https://bsc-testnet.bnbchain.org',
    'https://bsc-testnet-rpc.publicnode.com',
  ],
  rpcWs: ['wss://bsc-testnet-rpc.publicnode.com', 'wss://bsc-testnet.drpc.org'],
  explorer: 'https://testnet.bscscan.com',
  blockTimeMs: 450,
  supra: {
    restUrl: 'https://rpc-testnet-dora-2.supra.com',
    pull: '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917' as Address,
    storage: '0x004d42225631F6bec6503a281Ed4c233810CBC29' as Address,
    /** BLS committee verifier (UUPS proxy) — the stateless verification entry point. */
    committeeVerifier: '0x8694E798112a9Df06d9Ccc772967A5AeCfb24320' as Address,
    /** Owner of the Supra proxies; monitor its Upgraded and key-rotation events. */
    owner: '0xaF90E04a87743312000607d0F6a0519892454B7A' as Address,
    /** Supra rejects rounds more than this far ahead of block.timestamp·1000 (IncorrectFutureUpdate). */
    futureToleranceMs: 3000,
  },
  /** Archive-capable RPC for anvil forks; the bnbchain.org RPCs prune state after ~200 blocks. */
  forkRpc: 'https://bsc-testnet-rpc.publicnode.com',
} as const;

export interface Deployment {
  chainId: number;
  startBlock: number;
  commit: string;
  arena: Address;
  checkpointOracle: Address;
  supraPriceVerifier: Address;
  signedPriceVerifier?: Address;
  signedCheckpointOracle?: Address;
  testUsd: Address;
  faucet: Address;
}

/** Filled by `tools/abi-sync.ts` from contracts/deployments/<chainId>.json (F2). */
export const DEPLOYMENTS: Partial<Record<number, Deployment>> = Object.fromEntries(
  Object.entries(DEPLOYMENTS_JSON).map(([chainId, d]) => [Number(chainId), d as Deployment]),
);

export const explorerTxUrl = (hash: string): string => `${bscTestnet.explorer}/tx/${hash}`;
export const explorerAddressUrl = (address: string): string => `${bscTestnet.explorer}/address/${address}`;
