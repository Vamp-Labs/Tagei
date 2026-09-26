export type ArtSurface = 'tile' | 'hero-sky' | 'room' | 'lobby' | 'any';

export interface ArtAsset {
  src: `/lucky/${string}.png`;
  w: number;
  h: number;
  surface: ArtSurface;
  alt: string;
}

export const ART = {
  avatar: { src: '/lucky/illustrations/avatar.png', w: 44, h: 45, surface: 'lobby', alt: 'Player avatar' },
  'clover-mark': { src: '/lucky/illustrations/clover-mark.png', w: 42, h: 42, surface: 'lobby', alt: '' },
  coin: { src: '/lucky/illustrations/coin.png', w: 76, h: 78, surface: 'any', alt: 'Gold coin' },
  'hero-bomb': { src: '/lucky/illustrations/hero-bomb.png', w: 220, h: 230, surface: 'hero-sky', alt: '' },
  'locked-bolt': { src: '/lucky/illustrations/locked-bolt.png', w: 80, h: 72, surface: 'tile', alt: 'Locked bolt reward' },
  'locked-crown': { src: '/lucky/illustrations/locked-crown.png', w: 80, h: 72, surface: 'tile', alt: 'Locked crown reward' },
  'locked-magnet': { src: '/lucky/illustrations/locked-magnet.png', w: 80, h: 72, surface: 'tile', alt: 'Locked magnet reward' },
  'pro-bolt': { src: '/lucky/illustrations/pro-bolt.png', w: 80, h: 70, surface: 'tile', alt: 'Pro bolt reward' },
  'pro-chip': { src: '/lucky/illustrations/pro-chip.png', w: 80, h: 70, surface: 'tile', alt: 'Pro chip reward' },
  'reward-clover': { src: '/lucky/illustrations/reward-clover.png', w: 78, h: 80, surface: 'tile', alt: 'Clover reward' },
  'reward-crown': { src: '/lucky/illustrations/reward-crown.png', w: 70, h: 60, surface: 'tile', alt: 'Crown reward' },
  'reward-gift': { src: '/lucky/illustrations/reward-gift.png', w: 65, h: 60, surface: 'tile', alt: 'Gift reward' },
  'room-crash-race': { src: '/lucky/illustrations/room-crash-race.png', w: 165, h: 116, surface: 'room', alt: '' },
  'room-m-money': { src: '/lucky/illustrations/room-m-money.png', w: 165, h: 116, surface: 'room', alt: '' },
} as const satisfies Record<string, ArtAsset>;

export type ArtName = keyof typeof ART;

export const CURRENCY = {
  btc: { src: '/lucky/currency/btc.png', w: 54, h: 54, surface: 'any', alt: 'BTC' },
  eur: { src: '/lucky/currency/eur.png', w: 54, h: 54, surface: 'any', alt: 'EUR' },
  usd: { src: '/lucky/currency/usd.png', w: 54, h: 54, surface: 'any', alt: 'USD' },
  usdt: { src: '/lucky/currency/usdt.png', w: 54, h: 54, surface: 'any', alt: 'USDT' },
} as const satisfies Record<string, ArtAsset>;

export type CurrencyName = keyof typeof CURRENCY;
