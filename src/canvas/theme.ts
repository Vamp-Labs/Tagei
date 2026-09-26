import { CANVAS, ROLE, TOKENS, canvasFont, mix, rgba, type Hex, type Swatch } from '../ui/lucky/palette';

const ALPHA_STEPS = 64;
const BOOM_STEPS = 16;
const CHARGE_FRAC_STEPS = 8;
const CHARGE_FRAC_BLEND = 0.6;
const LIFT_TOWARD_INK = 0.55;
const MIN_FONT_PX = 13;
const MAX_FONT_PX = 32;

type ColorInput = Swatch | Hex;

const hexOf = (c: ColorInput): Hex => (typeof c === 'string' ? c : c.hex);

const stepOf = (value: number, steps: number) =>
  value > 0 ? (value >= 1 ? steps : Math.round(value * steps)) : 0;

let nextToneId = 1;

export class Tone {
  readonly id = nextToneId++;
  private ramp: string[] | null = null;
  private lifted: Tone | null = null;

  constructor(readonly hex: Hex) {}

  a(alpha: number): string {
    if (!this.ramp) {
      const ramp: string[] = [];
      for (let i = 0; i <= ALPHA_STEPS; i++) ramp.push(rgba(this.hex, i / ALPHA_STEPS));
      this.ramp = ramp;
    }
    return this.ramp[stepOf(alpha, ALPHA_STEPS)];
  }

  get lift(): Tone {
    if (!this.lifted) this.lifted = tone(mix(this.hex, TOKENS.ink, LIFT_TOWARD_INK));
    return this.lifted;
  }
}

const TONES = new Map<Hex, Tone>();

export const tone = (c: ColorInput): Tone => {
  const hex = hexOf(c);
  let t = TONES.get(hex);
  if (!t) {
    t = new Tone(hex);
    TONES.set(hex, t);
  }
  return t;
};

export const TONE = {
  ink: tone(TOKENS.ink),
  inkSoft: tone(TOKENS.inkSoft),
  inkMuted: tone(TOKENS.inkMuted),
  inkFaint: tone(TOKENS.inkFaint),
  heroSky: tone(TOKENS.heroSky),
  lucky: tone(ROLE.profit),
  luckyBar: tone(TOKENS.luckyBar),
  amber: tone(ROLE.loss),
  info: tone(ROLE.dirShort),
  gold: tone(TOKENS.gold),
  goldBright: tone(TOKENS.goldBright),
  goldDeep: tone(TOKENS.goldDeep),
  frame: tone(CANVAS.trackGlow),
  line: tone(CANVAS.grid),
  tile: tone(CANVAS.labelBg),
  well: tone(TOKENS.well),
  controlRing: tone(TOKENS.controlRing),
} as const;

export const CLEAR = 'transparent';

const boomRamp = (from: ColorInput, to: ColorInput, reach: number, alpha?: (t: number) => number) => {
  const out: string[] = [];
  for (let i = 0; i <= BOOM_STEPS; i++) {
    const t = i / BOOM_STEPS;
    const c = mix(from, to, t * reach);
    out.push(alpha ? rgba(c, alpha(t)) : c);
  }
  return out;
};

export const boomStep = (boom: number) => stepOf(boom, BOOM_STEPS);

export const STAGE = {
  top: boomRamp(CANVAS.stageTop, CANVAS.boomWin, 0.16),
  mid: boomRamp(TOKENS.lobbyActive, CANVAS.boomWin, 0.26),
  bottom: boomRamp(CANVAS.stageBottom, CANVAS.boomWin, 0.18),
  midStop: 0.55,
  star: CANVAS.star.hex,
  starTint: CANVAS.starTint.hex,
  starTintShare: 0.3,
  ambientCore: boomRamp(CANVAS.trackGlow, CANVAS.boomWin, 1, (t) => 0.06 + t * 0.22),
  ambientEdge: boomRamp(CANVAS.trackGlow, CANVAS.boomWin, 1, (t) => 0.025 + t * 0.12),
  grid: rgba(CANVAS.grid, 0.7),
  gridBoom: TONE.lucky,
} as const;

export interface TrackScheme {
  stroke: string;
  glow: string;
  fill: string;
}

export const TRACK: Record<'idle' | 'profit' | 'loss', TrackScheme> = {
  idle: { stroke: CANVAS.track.hex, glow: rgba(CANVAS.trackGlow, 0.45), fill: rgba(CANVAS.trackGlow, 0.1) },
  profit: { stroke: ROLE.profit.hex, glow: rgba(ROLE.profit, 0.5), fill: rgba(ROLE.profit, 0.12) },
  loss: { stroke: ROLE.loss.hex, glow: rgba(ROLE.loss, 0.5), fill: rgba(ROLE.loss, 0.12) },
};

export const MARKER = {
  profitZoneNear: rgba(CANVAS.target, 0.13),
  profitZoneFar: rgba(CANVAS.target, 0.02),
  stopZoneNear: rgba(CANVAS.stop, 0.12),
  stopZoneFar: rgba(CANVAS.stop, 0.02),
  profitLabel: rgba(CANVAS.target, 0.8),
  stopLabel: rgba(CANVAS.stop, 0.8),
  entryLine: rgba(CANVAS.entry, 0.75),
  entryRing: rgba(CANVAS.entry, 0.5),
  entry: CANVAS.entry.hex,
  tagBg: CANVAS.labelBg.hex,
  tagBgSoft: rgba(CANVAS.labelBg, 0.92),
  tagText: CANVAS.labelText.hex,
  target: CANVAS.target.hex,
  targetLine: rgba(CANVAS.target, 0.5),
  targetLineClose: rgba(CANVAS.target, 0.85),
  stop: CANVAS.stop.hex,
  stopLine: rgba(CANVAS.stop, 0.7),
  profit: ROLE.profit.hex,
  loss: ROLE.loss.hex,
  lastWinRing: rgba(ROLE.profit, 0.4),
  lastLossRing: rgba(ROLE.loss, 0.4),
  lastWinStem: rgba(ROLE.profit, 0.6),
  lastLossStem: rgba(ROLE.loss, 0.6),
  pathLong: ROLE.dirLong.hex,
  pathShort: ROLE.dirShort.hex,
} as const;

export const TEXT_HALO = rgba(CANVAS.stageBottom, 0.85);

export const FX = {
  winEdge: TONE.lucky,
  winCorner: TONE.ink,
  lossEdge: TONE.amber,
  flashCore: TONE.ink,
  flashRing: TONE.lucky,
} as const;

const CHARGE_LADDER: readonly Hex[] = [
  CANVAS.rocketBody.hex,
  CANVAS.charge[0].hex,
  CANVAS.charge[1].hex,
  mix(CANVAS.charge[1], CANVAS.charge[2], 0.45),
  CANVAS.charge[2].hex,
];

const DAMAGE_LADDER: readonly Hex[] = [
  TOKENS.inkMuted.hex,
  CANVAS.damage[0].hex,
  mix(CANVAS.damage[0], CANVAS.damage[1], 0.5),
  CANVAS.damage[1].hex,
  mix(CANVAS.damage[1], CANVAS.damage[2], 0.35),
];

const CHARGE_TONES: readonly (readonly Tone[])[] = CHARGE_LADDER.map((base, i) => {
  const next = CHARGE_LADDER[Math.min(CHARGE_LADDER.length - 1, i + 1)];
  const row: Tone[] = [];
  for (let s = 0; s <= CHARGE_FRAC_STEPS; s++) {
    row.push(tone(mix(base, next, (s / CHARGE_FRAC_STEPS) * CHARGE_FRAC_BLEND)));
  }
  return row;
});

const DAMAGE_TONES: readonly Tone[] = DAMAGE_LADDER.map((c) => tone(c));

export const chargeTone = (tier: number, frac: number): Tone =>
  CHARGE_TONES[Math.min(4, Math.max(0, tier))][stepOf(frac, CHARGE_FRAC_STEPS)];

export const damageTone = (depth: number): Tone => DAMAGE_TONES[Math.min(4, Math.max(0, depth))];

export const ROCKET = {
  idleFlame: tone(CANVAS.flame[2]),
  profitFlame: TONE.lucky,
  hyperFlame: tone(CANVAS.flame[1]),
  lossFlame: TONE.amber,
  flameCore: CANVAS.flame[0].hex,
  tiers: CANVAS.tiers.map((c) => c.hex),
  tierLoss: CANVAS.stop.hex,
  surgeGood: TONE.lucky.hex,
  surgeHyper: CANVAS.flame[1].hex,
  surgeBad: TONE.amber.hex,
  hullLight: TOKENS.ink.hex,
  hullMid: CANVAS.rocketBody.hex,
  hullDark: TOKENS.inkMuted.hex,
  hullEdge: TOKENS.controlRing.hex,
  hullSoot: TOKENS.well.hex,
  finFill: TOKENS.lobbyActive.hex,
  finEdge: TOKENS.frameMuted.hex,
  stripe: CANVAS.rocketTrim.hex,
  nozzle: TOKENS.line.hex,
  sootDark: TONE.well,
  sootMid: TONE.inkFaint,
  visorBase: TOKENS.inkMuted.hex,
  visorDeep: TOKENS.controlRing.hex,
  visorScorchLight: TOKENS.inkSecondary.hex,
  visorScorchDark: TOKENS.frameMuted.hex,
  visorScorchSink: TOKENS.lobbyRaised.hex,
  visorScorchFloor: TOKENS.well.hex,
  glass: TONE.inkSoft,
  shieldCore: rgba(ROLE.profit, 0.12),
  shieldMid: rgba(ROLE.profit, 0.26),
  shieldRim: rgba(TOKENS.ink, 0.38),
  shieldStroke: ROLE.profit.hex,
  arc: TONE.amber.hex,
  hazard: TONE.amber,
  hit: TONE.amber,
  cone: TONE.ink,
  coneOuter: TONE.heroSky,
  trailGood: TONE.lucky,
  trailBad: TONE.amber,
} as const;

export const PARTICLE = {
  spark: TOKENS.ink.hex,
  coin: CANVAS.coin.hex,
  coinDeep: CANVAS.coinRim.hex,
  coinShine: CANVAS.coinShine.hex,
  gem: ROLE.profit.hex,
  gemGold: CANVAS.coinShine.hex,
  ringWin: CANVAS.boomWin.hex,
  ringWinInner: TOKENS.ink.hex,
  rewardText: ROLE.profit.hex,
  headlineText: TOKENS.ink.hex,
  mist: CANVAS.boomLoss.hex,
  mistSoft: TOKENS.inkMuted.hex,
  smoke: TOKENS.inkMuted.hex,
  smokeDark: TOKENS.inkFaint.hex,
  ember: CANVAS.damage[0].hex,
  emberDeep: CANVAS.damage[1].hex,
  thruster: ROLE.profit.hex,
  warp: TOKENS.heroSky.hex,
} as const;

const FONTS: string[] = [];
for (let px = 0; px <= MAX_FONT_PX; px++) FONTS.push(canvasFont(800, Math.max(MIN_FONT_PX, px)));

export const font = (px: number) => FONTS[Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.round(px)))];

export const LABEL_FONT = font(MIN_FONT_PX);

let fontEpoch = 0;
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => {
    fontEpoch++;
  });
}

const DIGITS = /\d/g;

export class TextMemo {
  text = '';
  width = 0;
  private value = Number.NaN;
  private font = '';
  private epoch = -1;

  constructor(private readonly format: (value: number) => string) {}

  update(ctx: CanvasRenderingContext2D, value: number, px: string): this {
    ctx.font = px;
    if (value !== this.value || px !== this.font || fontEpoch !== this.epoch) {
      this.value = value;
      this.font = px;
      this.epoch = fontEpoch;
      this.text = this.format(value);
      this.width = ctx.measureText(this.text.replace(DIGITS, '0')).width;
    }
    return this;
  }
}
