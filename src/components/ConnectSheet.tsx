import React, { useState } from 'react';
import { env } from '../api/env';
import { toApiError } from '../api/errors';
import { soundEngine } from '../services/audioHaptics';
import { web3Service, type ConnectKind } from '../services/web3Service';
import { Sheet } from '../ui/Sheet';
import { Icon, SheetHeader, WalletRow, useConfetti, type IconName } from '../ui/lucky';

interface ConnectSheetProps {
  onClose: () => void;
  onConnected?: () => void;
}

interface ConnectOption {
  kind: ConnectKind;
  title: string;
  detail: string;
  icon: IconName;
  unavailable: string | null;
}

const hasInjectedWallet = () => typeof window !== 'undefined' && 'ethereum' in window && window.ethereum !== undefined;

const options = (): ConnectOption[] => [
  {
    kind: 'guest',
    title: 'Play as Guest',
    detail: 'instant · gasless · key stays in this browser',
    icon: 'bolt',
    unavailable: null,
  },
  {
    kind: 'injected',
    title: 'Browser wallet',
    detail: 'MetaMask, Rabby, Brave and others',
    icon: 'key',
    unavailable: hasInjectedWallet() ? null : 'not detected',
  },
  {
    kind: 'walletConnect',
    title: 'WalletConnect',
    detail: 'scan with a mobile wallet',
    icon: 'broadcast',
    unavailable: env.wcProjectId ? null : 'not configured',
  },
];

export const ConnectSheet: React.FC<ConnectSheetProps> = ({ onClose, onConnected }) => {
  const { burst } = useConfetti();
  const [busy, setBusy] = useState<ConnectKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async (option: ConnectOption) => {
    if (busy || option.unavailable) return;
    soundEngine.playClick();
    setBusy(option.kind);
    setError(null);
    try {
      await web3Service.connect(option.kind);
      soundEngine.playChipSelect();
      burst('connect');
      onConnected?.();
      onClose();
    } catch (cause) {
      setError(toApiError(cause, 'NO_WALLET').message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <SheetHeader title="Connect" subtitle="bnb smart chain testnet · no real funds" />
      <div className="flex flex-col gap-2 px-6 pb-3">
        {options().map((option) => {
          const disabled = option.unavailable !== null || (busy !== null && busy !== option.kind);
          return (
            <WalletRow
              key={option.kind}
              mode="button"
              disabled={disabled}
              onSelect={() => void connect(option)}
              aria-busy={busy === option.kind || undefined}
              icon={
                <span className="grid size-10 place-items-center rounded-full bg-control text-ink-secondary" aria-hidden="true">
                  <Icon name={option.icon} size={20} />
                </span>
              }
              title={option.title}
              amount={
                <span className="block text-caption font-semibold text-ink-soft">
                  {busy === option.kind ? 'connecting…' : (option.unavailable ?? option.detail)}
                </span>
              }
              trailing={<Icon name="chevron-right" size={20} className="text-ink-muted" />}
              className="min-h-16 pr-3"
            />
          );
        })}
        {error && (
          <p role="alert" className="mt-1 text-caption text-ink-soft">
            {error}
          </p>
        )}
        <p className="mt-2 text-micro text-ink-muted">
          Guests sign locally with a key saved in this browser. Export it from your profile to keep it.
        </p>
      </div>
    </Sheet>
  );
};
