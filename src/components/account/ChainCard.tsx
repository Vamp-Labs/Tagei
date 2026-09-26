import React from 'react';
import { AssetDisc, Button, Panel, Pill, WalletRow, formatHash } from '../../ui/lucky';
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
      <WalletRow
        mode="static"
        compact
        icon={<AssetDisc symbol="BNB" />}
        title="BNB Chain"
        amount={
          connected ? (
            `${wallet.balanceBNB} tBNB`
          ) : (
            <span className="block whitespace-nowrap text-caption font-semibold text-ink-soft">Not connected</span>
          )
        }
        bonus={
          connected && wallet.address ? (
            <span className="tabular-nums">{wallet.isDemoWallet ? wallet.address : formatHash(wallet.address)}</span>
          ) : undefined
        }
        bonusTone="muted"
        trailing={<Pill size="sm">testnet · {TESTNET_CHAIN_ID}</Pill>}
        className="pr-4"
      />
      {!connected && (
        <Button variant="hot" block onClick={onConnectWallet}>
          CONNECT WALLET!
        </Button>
      )}
    </Panel>
  );
};
