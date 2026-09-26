import React from 'react';
import { AssetDisc, Button, Panel, Pill, formatHash } from '../../ui/lucky';
import type { WalletState } from '../../services/web3Service';

const TESTNET_CHAIN_ID = 97;

interface ChainCardProps {
  wallet: WalletState;
  onConnectWallet: () => void;
}

export const ChainCard: React.FC<ChainCardProps> = ({ wallet, onConnectWallet }) => {
  const connected = wallet.isConnected;
  return (
    <Panel className="flex flex-col gap-3 p-3">
      <div className="lg-wallet lg-wallet--compact cursor-default pr-4">
        <span className="lg-wallet-icon">
          <AssetDisc symbol="BNB" />
        </span>
        <span className="lg-wallet-text">
          <span className="lg-wallet-title">BNB Chain</span>
          {connected ? (
            <span className="lg-wallet-amount">{wallet.balanceBNB} tBNB</span>
          ) : (
            <span className="whitespace-nowrap text-caption font-semibold text-ink-soft">Not connected</span>
          )}
          {connected && wallet.address && (
            <span className="lg-wallet-bonus is-muted tabular-nums">{wallet.isDemoWallet ? wallet.address : formatHash(wallet.address)}</span>
          )}
        </span>
        <span className="lg-wallet-trailing">
          <Pill size="sm">testnet · {TESTNET_CHAIN_ID}</Pill>
        </span>
      </div>
      {!connected && (
        <Button variant="hot" block onClick={onConnectWallet}>
          CONNECT WALLET!
        </Button>
      )}
    </Panel>
  );
};
