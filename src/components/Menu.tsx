import { ChevronRight, Flame, HelpCircle, LogOut, Settings2, UserRound } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { UserProgression } from '../types/game';

interface MenuProps {
  progression: UserProgression;
  isWalletConnected: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onDisconnect: () => void;
}

const Row: React.FC<{
  label: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
}> = ({ label, badge, onClick, disabled, icon }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`w-full flex items-center justify-between gap-2 px-5 h-14 text-left transition-colors ${
      disabled ? 'opacity-40 cursor-default' : 'hover:bg-white/[0.03] active:bg-white/[0.05] cursor-pointer'
    }`}
  >
    <div className="flex items-center gap-2.5">
      {icon}
      <span className="text-[length:var(--text-body)] font-semibold text-[color:var(--color-text-1)]">
        {label}
      </span>
    </div>
    <div className="flex items-center gap-2">
      {badge && (
        <span className="text-[length:var(--text-metadata)] text-[color:var(--color-text-3)]">{badge}</span>
      )}
      {!disabled && <ChevronRight className="w-4 h-4 text-[color:var(--color-text-3)]" />}
    </div>
  </button>
);

/**
 * docs/UI_UX_SPEC.md §11. Profile/Settings/Streak/Disconnect route to real,
 * already-working state and components (PilotProfileDrawer, SettingsModal,
 * UserProgression, web3Service). Positions and History are honest stubs —
 * this app has no position-history persistence and holds one active round
 * at a time, so there's nothing real to list yet.
 */
export const Menu: React.FC<MenuProps> = ({
  progression,
  isWalletConnected,
  onClose,
  onOpenProfile,
  onOpenSettings,
  onDisconnect,
}) => {
  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pt-1 pb-4">
        <div className="w-12 h-12 rounded-full bg-[color:var(--color-bnb-yellow)]/15 border border-[color:var(--color-bnb-yellow)]/40 flex items-center justify-center">
          <UserRound className="w-6 h-6 text-[color:var(--color-bnb-yellow)]" />
        </div>
        <div>
          <div className="text-[length:var(--text-body)] font-black text-[color:var(--color-text-1)]">
            TraderFox
          </div>
          <div className="text-[length:var(--text-metadata)] text-[color:var(--color-text-2)] font-mono">
            Level {progression.level} · {progression.currentXp.toLocaleString()} XP
          </div>
        </div>
      </div>

      <div className="border-t border-[color:var(--color-line)]">
        <Row label="Positions" badge="0" disabled icon={<span className="w-4" />} />
        <Row label="History" disabled icon={<span className="w-4" />} />
        <Row label="Profile" onClick={onOpenProfile} icon={<UserRound className="w-4 h-4 text-[color:var(--color-text-2)]" />} />
        <Row label="Settings" onClick={onOpenSettings} icon={<Settings2 className="w-4 h-4 text-[color:var(--color-text-2)]" />} />
        <Row label="Help & Support" disabled icon={<HelpCircle className="w-4 h-4 text-[color:var(--color-text-2)]" />} />
      </div>

      <div className="mx-5 my-4 px-4 py-3 rounded-[var(--radius-md)] bg-[color:var(--color-panel-soft)] border border-[color:var(--color-line)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-[color:var(--color-bnb-yellow)]" />
          <span className="text-[length:var(--text-metadata)] font-bold text-[color:var(--color-text-1)]">
            Daily Streak · {progression.streakDays ?? 0} days
          </span>
        </div>
        <span className="text-[length:var(--text-micro)] font-bold text-[color:var(--color-long)]">+50 XP</span>
      </div>

      {isWalletConnected && (
        <div className="px-5 pb-5">
          <button
            onClick={onDisconnect}
            className="w-full flex items-center justify-center gap-2 h-[var(--tap-min)] rounded-[var(--radius-md)] border border-[color:var(--color-line)] text-[color:var(--color-short)] font-semibold text-[length:var(--text-metadata)] cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Disconnect Wallet
          </button>
        </div>
      )}
    </Sheet>
  );
};
