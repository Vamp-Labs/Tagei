import type * as React from 'react';
type IconName = 'back' | 'grid' | 'plus' | 'check' | 'lock' | 'chevron-left' | 'chevron-right';
export interface IconProps { name: IconName; size?: number; strokeWidth?: number }
export declare function Icon(props: IconProps): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'hot' | 'secondary' | 'icon' | 'arrow'; icon?: IconName }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface BadgeProps { tone?: 'pro' | 'count' | 'check'; label?: string; children?: React.ReactNode; className?: string }
export declare function Badge(props: BadgeProps): React.ReactElement;
export interface AppBarProps { mark?: string; avatar?: string; avatarLabel?: string; left?: string; right?: string; menuLabel?: string; onMenu?: () => void }
export declare function AppBar(props: AppBarProps): React.ReactElement;
export interface SheetHeaderProps { title: React.ReactNode; subtitle?: React.ReactNode; back?: boolean; onBack?: () => void; action?: React.ReactNode }
export declare function SheetHeader(props: SheetHeaderProps): React.ReactElement;
export interface PanelProps { title?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties; className?: string }
export declare function Panel(props: PanelProps): React.ReactElement;
export interface SegmentedTabsItem { value: string; label: string; eyebrow?: string }
export interface SegmentedTabsProps { items: SegmentedTabsItem[]; value?: string; defaultValue?: string; onChange?: (value: string) => void }
export declare function SegmentedTabs(props: SegmentedTabsProps): React.ReactElement;
export interface HeroCardProps { art?: string; artLabel?: string; cta?: React.ReactNode; onPlay?: () => void; onPrev?: () => void; onNext?: () => void }
export declare function HeroCard(props: HeroCardProps): React.ReactElement;
export interface RoomCardProps { art?: string; title: string; maxPlayers?: number; seats: React.ReactNode; entry: React.ReactNode; count: React.ReactNode }
export declare function RoomCard(props: RoomCardProps): React.ReactElement;
export interface RewardTileProps { state?: 'default' | 'claimed' | 'selected' | 'locked' | 'pro'; art?: string; name?: string; timer?: string; progress?: number; progressTone?: 'amber' | 'lucky'; label?: string; onClick?: () => void }
export declare function RewardTile(props: RewardTileProps): React.ReactElement;
export interface ProgressBarProps { value: number; max?: number; next?: React.ReactNode; label?: string }
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;
export interface BalanceHeaderProps { brand?: string; word: string; value: React.ReactNode; unit?: string; art?: string }
export declare function BalanceHeader(props: BalanceHeaderProps): React.ReactElement;
export interface WalletRowProps { icon?: string; amount: string; currency?: string; bonus?: string; bonusTone?: 'lucky' | 'info'; selected?: boolean; onSelect?: () => void }
export declare function WalletRow(props: WalletRowProps): React.ReactElement;
declare global { interface Window { LuckyGames: { Icon: typeof Icon; Button: typeof Button; Badge: typeof Badge; AppBar: typeof AppBar; SheetHeader: typeof SheetHeader; Panel: typeof Panel; SegmentedTabs: typeof SegmentedTabs; HeroCard: typeof HeroCard; RoomCard: typeof RoomCard; RewardTile: typeof RewardTile; ProgressBar: typeof ProgressBar; BalanceHeader: typeof BalanceHeader; WalletRow: typeof WalletRow } } }
