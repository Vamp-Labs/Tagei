import { WalletState } from '../services/web3Service';
import { buttonClass } from '../ui/lucky/Button';
import { Icon } from '../ui/lucky/Icon';
import { cn } from '../ui/cn';

interface HeaderProps {
  wallet: WalletState;
  onOpenMenu: () => void;
}

/**
 * The top bar per docs/UI_UX_SPEC.md's `BNB PLAY   status   menu` mock — constant
 * across every screen. Asset name, price and 24h change are NOT header
 * content in the new spec: they're their own tappable block on Home
 * (`HomeHeroOverlay`), since the header stays identical on Active Trade too.
 */
export const Header: React.FC<HeaderProps> = ({ wallet, onOpenMenu }) => {
  return (
    <header className="relative z-30 flex items-center justify-between px-6 pb-3 pad-safe-top select-none">
      <span className="flex items-center gap-1.5 text-label font-extrabold tracking-[0.06em] text-ink uppercase">
        <span>BNB</span>
        <span className="lg-disc size-4 bg-gold" aria-hidden="true" />
        <span>PLAY</span>
      </span>

      <div className="flex items-center gap-3">
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
