export type Hex = `#${string}`;
export type Rgb = readonly [number, number, number];

export interface Swatch {
  hex: Hex;
  rgb: Rgb;
  css: `var(--color-${string})`;
}

const hexToRgb = (hex: Hex): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const swatch = (name: string, hex: Hex): Swatch => ({
  hex,
  rgb: hexToRgb(hex),
  css: `var(--color-${name})`,
});

export const TOKENS = {
  canvas: swatch('canvas', '#030d19'),
  sheet: swatch('sheet', '#111b2d'),
  panel: swatch('panel', '#1a263b'),
  well: swatch('well', '#0e1726'),
  tile: swatch('tile', '#0a111c'),
  control: swatch('control', '#1b263e'),
  controlHover: swatch('control-hover', '#232d44'),
  lobby: swatch('lobby', '#0a1e42'),
  lobbyRaised: swatch('lobby-raised', '#172747'),
  lobbyActive: swatch('lobby-active', '#142959'),
  heroSky: swatch('hero-sky', '#b0c4f5'),
  heroIndigo: swatch('hero-indigo', '#4452a8'),
  frame: swatch('frame', '#255bd0'),
  frameMuted: swatch('frame-muted', '#2d5295'),
  line: swatch('line', '#243149'),
  controlRing: swatch('control-ring', '#667490'),
  ink: swatch('ink', '#ffffff'),
  inkSoft: swatch('ink-soft', '#d8e4f2'),
  inkSecondary: swatch('ink-secondary', '#bcd1ef'),
  inkMuted: swatch('ink-muted', '#9eb4d0'),
  inkFaint: swatch('ink-faint', '#61769a'),
  lucky: swatch('lucky', '#1ef66d'),
  luckyBar: swatch('lucky-bar', '#04f233'),
  luckyTint: swatch('lucky-tint', '#123326'),
  onLucky: swatch('on-lucky', '#041a0c'),
  gold: swatch('gold', '#fcbe20'),
  goldBright: swatch('gold-bright', '#fbd50b'),
  goldDeep: swatch('gold-deep', '#c37f09'),
  onGold: swatch('on-gold', '#1b1405'),
  hot: swatch('hot', '#f80757'),
  hotLight: swatch('hot-light', '#fd3b73'),
  onHot: swatch('on-hot', '#ffffff'),
  info: swatch('info', '#2dbdf1'),
  amber: swatch('amber', '#f08204'),
  focus: swatch('focus', '#1ef66d'),
  coinUsd: swatch('coin-usd', '#feb300'),
  coinEur: swatch('coin-eur', '#1d47b9'),
  coinBtc: swatch('coin-btc', '#fd9600'),
  coinUsdt: swatch('coin-usdt', '#02af88'),
} as const satisfies Record<string, Swatch>;

export type TokenName = keyof typeof TOKENS;

const role = (name: string, source: Swatch): Swatch => ({ ...source, css: `var(--color-${name})` });

export const ROLE = {
  cta: role('cta', TOKENS.hot),
  brand: role('brand', TOKENS.lucky),
  premium: role('premium', TOKENS.gold),
  dirLong: role('dir-long', TOKENS.lucky),
  dirShort: role('dir-short', TOKENS.info),
  profit: role('profit', TOKENS.lucky),
  loss: role('loss', TOKENS.amber),
} as const satisfies Record<string, Swatch>;

export const CANVAS = {
  stageTop: TOKENS.lobby,
  stageBottom: TOKENS.canvas,
  grid: TOKENS.line,
  star: TOKENS.ink,
  starTint: TOKENS.heroSky,
  track: TOKENS.inkSoft,
  trackGlow: TOKENS.frame,
  entry: TOKENS.inkSoft,
  entryRing: TOKENS.controlRing,
  target: TOKENS.lucky,
  targetZone: TOKENS.luckyTint,
  stop: TOKENS.amber,
  labelBg: TOKENS.tile,
  labelText: TOKENS.ink,
  labelMuted: TOKENS.inkMuted,
  rocketBody: TOKENS.inkSoft,
  rocketTrim: TOKENS.gold,
  flame: [TOKENS.ink, TOKENS.goldBright, TOKENS.gold],
  tiers: [TOKENS.gold, TOKENS.lucky, TOKENS.goldBright, TOKENS.ink],
  charge: [TOKENS.luckyBar, TOKENS.lucky, TOKENS.ink],
  damage: [TOKENS.amber, TOKENS.goldDeep, TOKENS.inkMuted],
  coin: TOKENS.gold,
  coinRim: TOKENS.goldDeep,
  coinShine: TOKENS.goldBright,
  boomWin: TOKENS.lucky,
  boomLoss: TOKENS.amber,
} as const satisfies Record<string, Swatch | readonly Swatch[]>;

export type ConfettiKind = 'connect' | 'win' | 'levelUp' | 'mission';

export const CONFETTI: Record<ConfettiKind, readonly Hex[]> = {
  connect: [TOKENS.gold.hex, TOKENS.ink.hex, TOKENS.lucky.hex],
  win: [TOKENS.lucky.hex, TOKENS.gold.hex, TOKENS.ink.hex],
  levelUp: [TOKENS.gold.hex, TOKENS.lucky.hex, TOKENS.goldBright.hex, TOKENS.ink.hex],
  mission: [TOKENS.gold.hex, TOKENS.lucky.hex, TOKENS.ink.hex],
};

type ColorInput = Swatch | Hex;

const rgbOf = (c: ColorInput): Rgb => (typeof c === 'string' ? hexToRgb(c) : c.rgb);

const clampAlpha = (a: number) => Math.min(1, Math.max(0, a));

const byteHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export const hexA = (c: ColorInput, a: number): Hex => {
  const [r, g, b] = rgbOf(c);
  return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}${byteHex(clampAlpha(a) * 255)}`;
};

export const rgba = (c: ColorInput, a: number): string => {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r}, ${g}, ${b}, ${clampAlpha(a)})`;
};

export const mix = (a: ColorInput, b: ColorInput, t: number): Hex => {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  const k = clampAlpha(t);
  return `#${byteHex(ar + (br - ar) * k)}${byteHex(ag + (bg - ag) * k)}${byteHex(ab + (bb - ab) * k)}`;
};

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (c: ColorInput): number => {
  const [r, g, b] = rgbOf(c);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export const readableInk = (background: ColorInput): Swatch =>
  luminance(background) > 0.4 ? TOKENS.onGold : TOKENS.ink;

export const FONT_FAMILY = '"Figtree", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif';

export const canvasFont = (weight: number, px: number) => `${weight} ${px}px ${FONT_FAMILY}`;
