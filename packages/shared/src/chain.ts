import type { Address } from 'viem';

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
  },
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

/** Filled by `pnpm abi:sync` from contracts/deployments/<chainId>.json (F2). */
export const DEPLOYMENTS: Partial<Record<number, Deployment>> = {};

export const explorerTxUrl = (hash: string): string => `${bscTestnet.explorer}/tx/${hash}`;
export const explorerAddressUrl = (address: string): string => `${bscTestnet.explorer}/address/${address}`;
