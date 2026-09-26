import React from 'react';
import { CHAIN_ID } from '@bnbplay/shared/constants';
import { AssetDisc, Button, Panel, Pill, WalletRow, formatAmount, formatHash } from '../../ui/lucky';
import type { WalletState } from '../../services/web3Service';

interface ChainCardProps {
  wallet: WalletState;
  onConnectWallet: () => void;
}

export const ChainCard: React.FC<ChainCardProps> = ({ wallet, onConnectWallet }) => {
  const connected = wallet.isConnected;
  const credits = wallet.creditsUsd ?? null;
  return (
    <Panel className="flex flex-col gap-3 p-3">
      <WalletRow
        mode="static"
        compact
        icon={<AssetDisc symbol="BNB" />}
        title={wallet.kind === 'guest' ? 'Guest · BNB Chain' : 'BNB Chain'}
        amount={
          connected ? (
            credits !== null ? (
              formatAmount(credits, 'USDT', { sign: 'never' })
            ) : (
              `${wallet.balanceBNB} tBNB`
            )
          ) : (
            <span className="block whitespace-nowrap text-caption font-semibold text-ink-soft">Not connected</span>
          )
        }
        bonus={connected && wallet.address ? <span className="tabular-nums">{formatHash(wallet.address)}</span> : undefined}
        bonusTone="muted"
        trailing={<Pill size="sm">testnet · {CHAIN_ID}</Pill>}
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
