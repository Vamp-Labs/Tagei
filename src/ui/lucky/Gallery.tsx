import React, { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { SUPPORTED_ASSETS, type AssetSymbol } from '../../types/market';
import { HoldButton } from '../HoldButton';
import { cn } from '../cn';
import {
  ART,
  AssetDisc,
  Badge,
  BalanceHeader,
  Button,
  CURRENCY,
  DirectionChip,
  Icon,
  type IconName,
  Panel,
  Pill,
  type PillTone,
  ProgressBar,
  RewardTile,
  Scrim,
  SegmentedTabs,
  SheetHeader,
  SignedAmount,
  StatTable,
  StatTile,
  Toggle,
  TOKENS,
  WalletRow,
  formatAmount,
  formatPrice,
} from './index';

const ICONS: IconName[] = [
  'back',
  'grid',
  'plus',
  'minus',
  'check',
  'lock',
  'close',
  'chevron-left',
  'chevron-right',
  'chevron-up',
  'chevron-down',
  'tri-up',
  'tri-down',
  'arrow-right',
  'send',
  'search',
  'home',
  'external',
  'shield-check',
  'bolt',
  'key',
  'broadcast',
  'clock',
  'rocket',
];

const TYPE_SCALE = [
  { name: 'display', className: 'text-display' },
  { name: 'amount', className: 'text-amount' },
  { name: 'title', className: 'text-title' },
  { name: 'section', className: 'text-section' },
  { name: 'body', className: 'text-body' },
  { name: 'label', className: 'text-label uppercase' },
  { name: 'caption', className: 'text-caption' },
  { name: 'micro', className: 'text-micro' },
  { name: 'numeral', className: 'text-numeral tabular-nums' },
] as const;

const PILL_TONES: PillTone[] = ['neutral', 'lucky', 'gold', 'info', 'amber', 'long', 'short'];

const Section: React.FC<{ title: string; className?: string; children: React.ReactNode }> = ({ title, className, children }) => (
  <section className={cn('flex flex-col gap-3', className)}>
    <h2 className="text-micro font-bold uppercase tracking-[0.08em] text-lucky">{title}</h2>
    {children}
  </section>
);

const Row: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
);

type Direction = 'LONG' | 'SHORT';

export const Gallery: React.FC = () => {
  const [lobbyTab, setLobbyTab] = useState<'roulette' | 'casino' | 'opencase'>('casino');
  const [direction, setDirection] = useState<Direction | null>('LONG');
  const [toggleOn, setToggleOn] = useState(true);
  const [wallet, setWallet] = useState<'usdt' | 'btc'>('usdt');

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) document.documentElement.dataset.sceneReady = '1';
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const directionItems = [
    { value: 'LONG' as const, label: 'Long', tone: 'long' as const, icon: <Icon name="tri-up" size={14} /> },
    { value: 'SHORT' as const, label: 'Short', tone: 'short' as const, icon: <Icon name="tri-down" size={14} /> },
  ];

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto flex min-h-full max-w-md flex-col gap-8 bg-sheet px-6 pb-16 pt-6 font-sans">
        <header className="flex flex-col gap-1">
          <span className="text-micro font-bold uppercase tracking-[0.08em] text-ink-muted">dev gallery</span>
          <h1 className="text-display">
            <span className="text-brand">Lucky</span> Primitives
          </h1>
        </header>

        <Section title="Type scale">
          {TYPE_SCALE.map(({ name, className }) => (
            <div key={name} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
              <span className={className}>{name === 'numeral' ? '1234' : 'Figtree'}</span>
              <span className="text-micro text-ink-muted">{name}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1 rounded-md bg-well p-4 text-amount tabular-nums">
            <span>{formatAmount(111.11)}</span>
            <span>{formatAmount(-888.88)}</span>
            <span>{formatPrice(95400)}</span>
          </div>
        </Section>

        <Section title="Colour tokens">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(TOKENS).map(([name, swatch]) => (
              <div key={name} className="flex items-center gap-2 rounded-sm bg-well p-2">
                <span className="size-5 shrink-0 rounded-full border border-line" style={{ backgroundColor: swatch.css }} />
                <span className="truncate text-micro text-ink-soft">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Button">
          <Button variant="hot" block>
            PLAY NOW!
          </Button>
          <Row>
            <Button variant="hot" size="md">
              TRADE AGAIN!
            </Button>
            <Button variant="hot" size="md" disabled>
              DISABLED
            </Button>
          </Row>
          <Row>
            <Button variant="secondary" icon="plus">
              Add new
            </Button>
            <Button variant="secondary" size="md">
              Trade again
            </Button>
          </Row>
          <Row>
            <Button variant="ghost">Review round</Button>
            <Button variant="ghost" size="md" disabled>
              Disabled
            </Button>
            <Button variant="icon" icon="back" aria-label="Back" />
            <Button variant="icon" size="md" icon="grid" aria-label="Menu" />
          </Row>
          <Row className="rounded-md bg-lobby p-3">
            <Button variant="arrow" icon="chevron-left" aria-label="Previous" />
            <Button variant="arrow" icon="chevron-right" aria-label="Next" />
          </Row>
        </Section>

        <Section title="HoldButton">
          <HoldButton variant="hot" onCommit={() => undefined} holdingLabel="HOLDING…">
            HOLD TO LAUNCH!
          </HoldButton>
          <HoldButton variant="hot" disabled onCommit={() => undefined}>
            PICK A DIRECTION
          </HoldButton>
          <HoldButton
            onCommit={() => undefined}
            className="h-14 w-full rounded-sm bg-control text-label font-bold text-ink"
            ringClassName="text-lucky"
          >
            Bare variant
          </HoldButton>
        </Section>

        <Section title="Badge">
          <Row>
            <Badge tone="count">36</Badge>
            <Badge tone="pro">Pro</Badge>
            <Badge tone="check" />
          </Row>
        </Section>

        <Section title="Icon">
          <div className="grid grid-cols-7 gap-3 text-ink">
            {ICONS.map((name) => (
              <span key={name} className="flex size-11 items-center justify-center rounded-sm bg-well" title={name}>
                <Icon name={name} />
              </span>
            ))}
          </div>
        </Section>

        <Section title="SegmentedTabs">
          <SegmentedTabs
            ariaLabel="Game mode"
            value={lobbyTab}
            onChange={setLobbyTab}
            items={[
              { value: 'roulette', label: 'Roulette' },
              { value: 'casino', label: 'Casino', eyebrow: 'crypto' },
              { value: 'opencase', label: 'Opencase' },
            ]}
          />
          <SegmentedTabs
            ariaLabel="Direction"
            role="radiogroup"
            surface="sheet"
            value={direction}
            onChange={setDirection}
            items={directionItems}
          />
          <SegmentedTabs ariaLabel="Direction, SHORT selected" role="radiogroup" surface="sheet" value="SHORT" items={directionItems} />
          <SegmentedTabs ariaLabel="Direction, none selected" role="radiogroup" surface="sheet" value={null} items={directionItems} />
          <SegmentedTabs
            ariaLabel="Leverage"
            surface="sheet"
            size="sm"
            value="18"
            items={[
              { value: '5', label: <span className="normal-case">5x</span> },
              { value: '10', label: <span className="normal-case">10x</span> },
              { value: '18', label: <span className="normal-case">18x</span> },
            ]}
          />
        </Section>

        <Section title="Panel · ProgressBar">
          <Panel title="Bonus Level">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-caption tabular-nums">720 / 770 XP</span>
              <span className="text-body text-ink-faint">Until level 8</span>
            </div>
            <ProgressBar value={720} max={770} next={8} label="Level progress" />
          </Panel>
          <Panel tone="well">
            <ProgressBar value={2} max={3} size="sm" tone="gold" label="Daily rounds" />
            <p className="mt-2 text-micro text-ink-muted">well tone, small gold bar</p>
          </Panel>
        </Section>

        <Section title="RewardTile">
          <Panel title="Rewards">
            <div className="grid grid-cols-3 justify-items-center gap-2">
              <RewardTile state="claimed" art={ART['reward-crown'].src} name="Crown" timer="20:08:24" />
              <RewardTile state="selected" art={ART['reward-gift'].src} label="Gift" />
              <RewardTile state="default" art={ART['reward-clover'].src} label="Clover" />
              <RewardTile state="locked" art={ART['locked-crown'].src} label="Locked crown" progress={40} />
              <RewardTile state="locked" art={ART['locked-magnet'].src} label="Locked magnet" progress={90} progressTone="lucky" />
              <RewardTile state="pro" art={ART['pro-chip'].src} label="Pro chip" />
            </div>
          </Panel>
        </Section>

        <Section title="WalletRow">
          <Panel title="Wallets">
            <div role="radiogroup" aria-label="Wallet" className="flex flex-col gap-2">
              <WalletRow
                iconSrc={CURRENCY.usdt.src}
                amount="612.34"
                currency="USDT"
                bonus="demo balance"
                selected={wallet === 'usdt'}
                onSelect={() => setWallet('usdt')}
              />
              <WalletRow
                iconSrc={CURRENCY.btc.src}
                amount="0.989220"
                currency="BTC"
                bonus="dp.bonus 20 fs"
                bonusTone="info"
                selected={wallet === 'btc'}
                onSelect={() => setWallet('btc')}
              />
            </div>
          </Panel>
          <div role="radiogroup" aria-label="Asset" className="flex flex-col gap-2">
            {(Object.keys(SUPPORTED_ASSETS) as AssetSymbol[]).slice(0, 3).map((symbol, index) => (
              <WalletRow
                key={symbol}
                compact
                icon={<AssetDisc symbol={symbol} />}
                title={SUPPORTED_ASSETS[symbol].name}
                amount={symbol}
                bonus={index === 1 ? '−0.42%' : '+1.20%'}
                bonusTone={index === 1 ? 'amber' : 'lucky'}
                trailing={<span className="text-caption font-bold">{formatPrice(SUPPORTED_ASSETS[symbol].basePrice)}</span>}
                selected={index === 0}
              />
            ))}
          </div>
        </Section>

        <Section title="BalanceHeader">
          <BalanceHeader brand="Lucky" word="Tokkens" value="3.420" unit="VP" art={ART.coin.src} />
        </Section>

        <Section title="DirectionChip · SignedAmount">
          <Row>
            <DirectionChip direction="LONG" leverage={18} />
            <DirectionChip direction="SHORT" leverage={18} />
            <DirectionChip direction="LONG" size="sm" />
            <DirectionChip direction="SHORT" size="sm" />
          </Row>
          <Row className="text-amount font-bold">
            <SignedAmount value={2.16} />
            <SignedAmount value={-1.62} />
          </Row>
          <Row className="text-caption font-semibold">
            <SignedAmount value={0} />
            <SignedAmount value={-0.004} />
            <SignedAmount value={12.5} tone="ink" />
            <SignedAmount value={1.25} sign="auto" unit={null} />
          </Row>
        </Section>

        <Section title="StatTable · StatTile">
          <StatTable
            rows={[
              { label: 'Stake', value: formatAmount(10, 'USDT', { sign: 'never' }) },
              { label: 'Direction', value: 'LONG', tone: 'long' },
              { label: 'Direction', value: 'SHORT', tone: 'short' },
              { label: 'Target', value: formatAmount(2.16), tone: 'profit' },
              { label: 'Stop', value: formatAmount(-1.62), tone: 'loss' },
              { label: 'Tx', value: '0x12ab…9f3c', tone: 'muted' },
            ]}
          />
          <div className="lg-stats">
            <StatTile value="3" label="streak" art={ART['reward-clover'].src} />
            <StatTile value="2/3" label="today" icon={<Icon name="check" className="text-lucky" />} />
            <StatTile value="7" label="level" art={ART.coin.src} />
          </div>
        </Section>

        <Section title="Pill">
          <Row>
            {PILL_TONES.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </Row>
          <Row>
            <Pill tone="lucky" dot="pulse">
              live
            </Pill>
            <Pill tone="neutral" dot size="sm">
              idle
            </Pill>
            <Pill tone="gold" size="sm" icon={<Icon name="lock" size={14} />}>
              pro
            </Pill>
          </Row>
        </Section>

        <Section title="Toggle">
          <Toggle checked={toggleOn} onChange={setToggleOn} label="Sound" description="Clicks, ticks and the launch tone" />
          <Toggle checked={false} onChange={() => undefined} label="Reduced motion" />
          <Toggle checked onChange={() => undefined} label="Live Binance feed" description="Unavailable offline" disabled />
        </Section>

        <Section title="AssetDisc">
          <Row>
            {(Object.keys(SUPPORTED_ASSETS) as AssetSymbol[]).map((symbol) => (
              <AssetDisc key={symbol} symbol={symbol} />
            ))}
            <AssetDisc symbol="BNB" size={56} />
            <AssetDisc symbol="BTC" size={24} />
          </Row>
        </Section>

        <Section title="Scrim · Card · SheetHeader">
          <div className="relative h-40 overflow-hidden rounded-lg bg-lobby">
            <div className="absolute inset-0 grid grid-cols-2">
              <Scrim tone="dim" className="flex items-center justify-center text-micro text-ink-soft">
                dim
              </Scrim>
              <Scrim tone="game" className="flex items-center justify-center text-micro text-ink-soft">
                game
              </Scrim>
            </div>
          </div>
          <div className="lg-card overflow-hidden">
            <SheetHeader grabber title="Select Asset" subtitle="live · 5 markets" onBack={() => undefined} action={<Badge tone="pro">Pro</Badge>} />
          </div>
          <div className="lg-sheet">
            <SheetHeader eyebrow="position" title="Position Details" />
          </div>
        </Section>

        <Section title="Art">
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(ART).map(([name, art]) => (
              <figure
                key={name}
                className={cn(
                  'flex flex-col items-center justify-end gap-1 rounded-md p-2',
                  art.surface === 'tile' && 'bg-tile',
                  art.surface === 'hero-sky' && 'bg-hero-sky',
                  art.surface === 'room' && 'bg-hero-indigo',
                  art.surface === 'lobby' && 'bg-lobby',
                  art.surface === 'any' && 'bg-panel'
                )}
              >
                <img src={art.src} alt="" width={Math.min(art.w, 64)} className="h-auto" />
                <figcaption className="w-full truncate text-center text-micro text-ink-soft">{name}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      </main>
    </MotionConfig>
  );
};
