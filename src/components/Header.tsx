import { WalletState } from '../services/web3Service';
import { buttonClass } from '../ui/lucky/Button';
import { Icon } from '../ui/lucky/Icon';
import { PRACTICE_PILL } from './game/roundDisplay';
import { cn } from '../ui/cn';

interface HeaderProps {
  wallet: WalletState;
  onOpenMenu: () => void;
  practice?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ wallet, onOpenMenu, practice = false }) => {
  return (
    <header className="relative z-30 flex items-center justify-between px-6 pb-3 pad-safe-top select-none">
      <span className="flex items-center gap-1.5 text-label font-extrabold tracking-[0.06em] text-ink uppercase">
        <span>BNB</span>
        <span className="lg-disc size-4 bg-gold" aria-hidden="true" />
        <span>PLAY</span>
      </span>

      <div className="flex items-center gap-3">
        {practice && (
          <span
            role="img"
            aria-label={PRACTICE_PILL}
            className="flex flex-col items-end rounded-sm bg-well px-2.5 py-1 text-micro leading-tight ring-1 ring-inset ring-line"
          >
            <span aria-hidden="true" className="font-extrabold tracking-[0.08em] text-ink">
              PRACTICE
            </span>
            <span aria-hidden="true" className="text-ink-muted">
              not on-chain
            </span>
          </span>
        )}
        <span
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0',
            wallet.isConnected ? 'bg-lucky ring-4 ring-lucky-tint' : 'bg-control-ring'
          )}
          aria-label={wallet.isConnected ? 'Wallet connected' : 'Wallet not connected'}
          role="img"
        />

        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className={cn(buttonClass('icon', 'md'), '-mr-1 active:scale-95 transition-transform')}
        >
          <Icon name="grid" />
        </button>
      </div>
    </header>
  );
};
