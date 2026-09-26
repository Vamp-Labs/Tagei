import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { queryClient } from '../api/queryClient';
import { web3Service } from '../services/web3Service';

export function Web3Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={web3Service.getConfig()} reconnectOnMount>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
