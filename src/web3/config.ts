import { fallback, http, type Chain, type EIP1193RequestFn, type Transport } from 'viem';
import { bscTestnet as viemBscTestnet } from 'viem/chains';
import { createConfig, createStorage, injected, noopStorage, type Config, type CreateConnectorFn } from 'wagmi';
import { bscTestnet } from '@bnbplay/shared/chain';
import type { AppEnv } from '../api/env';
import type { KeyValueStorage } from '../api/storage';
import { guest } from './guest';

export const WAGMI_STORAGE_KEY = 'bnbplay.wagmi';
export const WALLETCONNECT_CONNECTOR_ID = 'walletConnect';

export function rpcUrlsFor(env: Pick<AppEnv, 'rpcUrls'>): readonly string[] {
  return env.rpcUrls.length > 0 ? env.rpcUrls : bscTestnet.rpcHttp;
}

export function bnbPlayChain(rpcUrls: readonly string[]): Chain {
  return { ...viemBscTestnet, rpcUrls: { default: { http: [...rpcUrls] } } };
}

export function bnbPlayTransport(rpcUrls: readonly string[]): Transport {
  return fallback(rpcUrls.map((url) => http(url, { retryCount: 1, timeout: 8_000 })), { rank: false });
}

export interface Web3ConfigOptions {
  env: Pick<AppEnv, 'rpcUrls'>;
  storage: KeyValueStorage | null;
  extraConnectors?: CreateConnectorFn[];
  transport?: Transport;
}

export function createWeb3Config({ env, storage, extraConnectors = [], transport }: Web3ConfigOptions): Config {
  const rpcUrls = rpcUrlsFor(env);
  const chain = bnbPlayChain(rpcUrls);
  const chainTransport = transport ?? bnbPlayTransport(rpcUrls);
  const forward = chainTransport({ chain, retryCount: 0 }).request as EIP1193RequestFn;
  return createConfig({
    chains: [chain],
    connectors: [guest({ storage: storage ?? undefined, forward }), injected({ shimDisconnect: true }), ...extraConnectors],
    transports: { [chain.id]: chainTransport },
    storage: createStorage({ key: WAGMI_STORAGE_KEY, storage: storage ?? noopStorage }),
    multiInjectedProviderDiscovery: true,
    ssr: false,
  });
}

export async function loadWalletConnectConnector(projectId: string): Promise<CreateConnectorFn> {
  const { walletConnect } = await import('wagmi/connectors');
  return walletConnect({
    projectId,
    showQrModal: true,
    metadata: {
      name: 'BNB PLAY',
      description: 'Ride the live market on BNB Smart Chain Testnet.',
      url: typeof window === 'undefined' ? 'https://bnbplay.local' : window.location.origin,
      icons: [],
    },
  });
}
