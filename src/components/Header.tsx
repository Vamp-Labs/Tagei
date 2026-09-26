import { Menu as MenuIcon } from 'lucide-react';
import { WalletState } from '../services/web3Service';

interface HeaderProps {
  wallet: WalletState;
  onOpenMenu: () => void;
}

/**
 * The top bar per docs/UI_UX_SPEC.md's `BNB PLAY   ◉  ☰` mock — constant
 * across every screen. Asset name, price and 24h change are NOT header
 * content in the new spec: they're their own tappable block on Home
 * (`HomeHeroOverlay`), since the header stays identical on Active Trade too.
 */
export const Header: React.FC<HeaderProps> = ({ wallet, onOpenMenu }) => {
  return (
    <header className="relative z-30 flex items-center justify-between px-4 pb-3 pad-safe-top select-none">
      <span className="text-sm font-black tracking-widest text-[color:var(--color-bnb-yellow)] uppercase">
        BNB PLAY
      </span>

      <div className="flex items-center gap-2">
        {/* Wallet status dot — the docs mock's "◉". Green when connected. */}
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{
            backgroundColor: wallet.isConnected
              ? 'var(--color-long)'
              : 'var(--color-text-3)',
          }}
          aria-label={wallet.isConnected ? 'Wallet connected' : 'Wallet not connected'}
          role="img"
        />

        <button
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="w-[var(--tap-min)] h-[var(--tap-min)] -mr-2 rounded-[var(--radius-sm)] flex items-center justify-center text-[color:var(--color-text-1)] hover:bg-white/5 active:scale-95 transition-all cursor-pointer"
        >
          <MenuIcon className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
