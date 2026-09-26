import catalogue from './scenes.json';
import { marketFeed } from '../services/marketFeed';
import { DEFAULT_CONFIG, SettlementEngine } from '../services/settlementEngine';
import type {
  ActiveTradeRound,
  GameStage,
  LastRoundSummary,
  PositionDirection,
  TradeResult,
  UserProgression,
} from '../types/game';
import type { AssetSymbol } from '../types/market';
import { mulberry32, nextFrame, sceneErrors, seedRandom, sleep } from './runtime';
import type { DevSceneContext, DevSceneParams, DevSheet, SceneEntry } from './types';

export const SCENES: readonly SceneEntry[] = catalogue;

const STAKE = 10;
const DEFAULT_ASSET: AssetSymbol = 'BNB';
const DEFAULT_SETTLE_MS = 1200;
const FONT_TIMEOUT_MS = 5000;
const PROMPT_TIMEOUT_MS = 2000;
const DEFAULT_SETTLEMENT_STEP = 'submitted';
const HASH_SALT = 0x5eed;
const HASH_LENGTH = 64;
const XP_WIN = 50;
const XP_OTHER = 25;
const NEAR_TARGET_FRACTION = 0.92;
const TARGET_PCT = DEFAULT_CONFIG.targetThresholdPct;
const STOP_PCT = -DEFAULT_CONFIG.stopLossThresholdPct;
const PRICE_WALK = [0.18, 0.08, 0.34, 0.27, 0.55, 0.48, 0.76, 0.9, 1];
const PIX_PROMPT_SELECTOR = '[data-scene-target="pix-prompt"]';
const PIX_PROMPT_FALLBACK_TEXT = "What's the trend for BNB?";

const BASE_PROGRESSION: Partial<UserProgression> = {
  level: 7,
  currentXp: 650,
  nextLevelXp: 770,
  dailyRoundsPlayed: 2,
  dailyRoundsGoal: 3,
  missionCompleted: false,
};
const LEVEL_UP_PROGRESSION: Partial<UserProgression> = { level: 8, currentXp: 790, nextLevelXp: 820 };
const MISSION_PROGRESSION: Partial<UserProgression> = { dailyRoundsPlayed: 3, missionCompleted: true };

interface Kit {
  name: string;
  params: DevSceneParams;
  ctx: () => DevSceneContext;
  hash: string;
}

type Recipe = (kit: Kit) => void | Promise<void>;

interface ResultExtras {
  progression?: Partial<UserProgression>;
  leveledUp?: boolean;
  missionToast?: boolean;
}

const favourForPnl = (pnl: number) => (pnl / (STAKE * DEFAULT_CONFIG.multiplierLeverage)) * 100;
const signedMove = (kit: Kit, direction: PositionDirection, favourPct: number) =>
  kit.params.delta ?? (direction === 'LONG' ? favourPct : -favourPct);

function sceneHash(seed: number): string {
  const next = mulberry32(seed ^ HASH_SALT);
  let hex = '0x';
  for (let i = 0; i < HASH_LENGTH; i += 1) hex += Math.floor(next() * 16).toString(16);
  return hex;
}

function resetMarket(kit: Kit): void {
  const asset = kit.params.asset ?? DEFAULT_ASSET;
  const detour: AssetSymbol = asset === 'ETH' ? 'BNB' : 'ETH';
  marketFeed.setAsset(detour, false);
  marketFeed.setAsset(asset, false);
  if (kit.params.freeze) marketFeed.cleanup();
  kit.ctx().setCurrentAsset(asset);
  marketFeed.pushPriceDelta(0);
}

function prepare(kit: Kit, connected = true): DevSceneContext {
  resetMarket(kit);
  const ctx = kit.ctx();
  if (kit.params.rm) ctx.setSettings((prev) => ({ ...prev, reducedMotion: true }));
  ctx.setProgression((prev) => ({ ...prev, ...BASE_PROGRESSION }));
  if (connected) void ctx.handleConnectWallet();
  return ctx;
}

function walkPrice(entry: number, signedPct: number): void {
  for (const fraction of PRICE_WALK) {
    const goal = entry * (1 + (signedPct * fraction) / 100);
    marketFeed.pushPriceDelta((goal / marketFeed.getCurrentPrice() - 1) * 100);
  }
}

function openRound(kit: Kit, direction: PositionDirection, favourPct: number): { round: ActiveTradeRound; progress: number } {
  const entry = marketFeed.getCurrentPrice();
  walkPrice(entry, signedMove(kit, direction, favourPct));
  const opened = SettlementEngine.initRound(marketFeed.getCurrentAsset(), direction, STAKE, entry);
  const { updatedRound, targetProgressPct } = SettlementEngine.evaluateTick(opened, marketFeed.getCurrentPrice());
  return { round: { ...updatedRound, id: `scene_${kit.name}` }, progress: targetProgressPct };
}

function summaryFor(kit: Kit, direction: PositionDirection, favourPct: number): LastRoundSummary {
  const entry = marketFeed.getCurrentPrice();
  const exit = entry * (1 + signedMove(kit, direction, favourPct) / 100);
  const opened = SettlementEngine.initRound(marketFeed.getCurrentAsset(), direction, STAKE, entry);
  const { updatedRound } = SettlementEngine.evaluateTick(opened, exit);
  return {
    pnl: updatedRound.currentPnl,
    direction,
    asset: updatedRound.asset,
    entryPrice: entry,
    exitPrice: exit,
    outcome: updatedRound.currentPnl >= 0 ? 'win' : 'loss',
    timestamp: Date.now(),
  };
}

function toResult(round: ActiveTradeRound, outcome: TradeResult['outcome'], txHash: string): TradeResult {
  return {
    id: round.id,
    asset: round.asset,
    direction: round.direction,
    stake: round.stake,
    entryPrice: round.entryPrice,
    exitPrice: round.currentPrice,
    pnl: round.currentPnl,
    multiplier: (round.stake + round.currentPnl) / round.stake,
    outcome,
    timestamp: Date.now(),
    txHash,
    xpEarned: outcome === 'win' ? XP_WIN : XP_OTHER,
  };
}

function toSummary(result: TradeResult): LastRoundSummary {
  return {
    pnl: result.pnl,
    direction: result.direction,
    asset: result.asset,
    entryPrice: result.entryPrice,
    exitPrice: result.exitPrice,
    outcome: result.pnl >= 0 ? 'win' : 'loss',
    timestamp: result.timestamp,
  };
}

function flight(kit: Kit, stage: GameStage, direction: PositionDirection, favourPct: number): ActiveTradeRound {
  const ctx = prepare(kit);
  const dir = kit.params.dir ?? direction;
  const { round, progress } = openRound(kit, dir, favourPct);
  ctx.setSelectedDirection(dir);
  ctx.setActiveRound(round);
  ctx.setTargetProgressPct(progress);
  ctx.setStage(stage);
  return round;
}

const sheet =
  (name: DevSheet): Recipe =>
  (kit) => {
    prepare(kit).setActiveSheet(name);
  };

const tradeSetup =
  (direction: PositionDirection | null): Recipe =>
  (kit) => {
    const ctx = prepare(kit);
    ctx.setSelectedDirection(kit.params.dir ?? direction);
    ctx.handlePlayNow();
  };

const live =
  (direction: PositionDirection, favourPct: number, openSheet: DevSheet = 'none'): Recipe =>
  (kit) => {
    flight(kit, 'LIVE_TRADE', direction, favourPct);
    kit.ctx().setActiveSheet(openSheet);
  };

const outcome =
  (stage: 'TARGET_HIT' | 'LOSS_HIT'): Recipe =>
  (kit) => {
    flight(kit, stage, 'LONG', stage === 'TARGET_HIT' ? TARGET_PCT : STOP_PCT);
  };

const lastRound =
  (favourPct: number): Recipe =>
  (kit) => {
    prepare(kit).setLastRoundSummary(summaryFor(kit, kit.params.dir ?? 'LONG', favourPct));
  };

const result =
  (kind: TradeResult['outcome'], favourPct: number, extras: ResultExtras = {}): Recipe =>
  (kit) => {
    const round = flight(kit, 'RESULT', 'LONG', favourPct);
    const ctx = kit.ctx();
    const trade = toResult(round, kind, kit.hash);
    ctx.setSettlementStep('confirmed');
    ctx.setSettlementTxHash(kit.hash);
    ctx.setLastResult(trade);
    ctx.setLastRoundSummary(toSummary(trade));
    ctx.setJustLeveledUp(extras.leveledUp ?? false);
    if (extras.progression) {
      const next = extras.progression;
      ctx.setProgression((prev) => ({ ...prev, ...next }));
    }
    ctx.setIsMissionToastOpen(extras.missionToast ?? false);
  };

async function findPixPrompt(): Promise<HTMLElement | null> {
  const deadline = performance.now() + PROMPT_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const tagged = document.querySelector<HTMLElement>(PIX_PROMPT_SELECTOR);
    if (tagged) return tagged;
    const byText = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === PIX_PROMPT_FALLBACK_TEXT,
    );
    if (byText) return byText;
    await nextFrame();
  }
  return null;
}

const RECIPES: Record<string, Recipe> = {
  landing: (kit) => {
    prepare(kit, false);
  },
  home: (kit) => {
    prepare(kit);
  },
  'home-active': (kit) => {
    flight(kit, 'HOME', 'LONG', favourForPnl(0.72));
  },
  'home-last-win': lastRound(TARGET_PCT),
  'home-last-loss': lastRound(STOP_PCT),
  'asset-selector': sheet('asset-selector'),
  menu: sheet('menu'),
  profile: (kit) => {
    prepare(kit).setIsProfileOpen(true);
  },
  'profile-guest': (kit) => {
    prepare(kit, false).setIsProfileOpen(true);
  },
  settings: (kit) => {
    prepare(kit).setIsSettingsOpen(true);
  },
  'pix-chat': sheet('pix-chat'),
  'pix-chat-thread': async (kit) => {
    prepare(kit).setActiveSheet('pix-chat');
    const prompt = await findPixPrompt();
    if (prompt) prompt.click();
    else sceneErrors.push(`No PIX quick prompt found (${PIX_PROMPT_SELECTOR})`);
  },
  'trade-setup': tradeSetup('LONG'),
  'trade-setup-empty': tradeSetup(null),
  'trade-setup-short': tradeSetup('SHORT'),
  'live-profit': live('LONG', favourForPnl(1.3)),
  'live-loss': live('LONG', favourForPnl(-0.72)),
  'live-short': live('SHORT', favourForPnl(0.9)),
  'live-near-target': live('LONG', TARGET_PCT * NEAR_TARGET_FRACTION),
  'position-details': live('LONG', favourForPnl(1.3), 'position-details'),
  'outcome-win': outcome('TARGET_HIT'),
  'outcome-loss': outcome('LOSS_HIT'),
  settlement: (kit) => {
    flight(kit, 'SETTLING', 'LONG', TARGET_PCT);
    const step = kit.params.step ?? DEFAULT_SETTLEMENT_STEP;
    const ctx = kit.ctx();
    ctx.setSettlementStep(step);
    ctx.setSettlementTxHash(step === 'submitted' || step === 'confirmed' ? kit.hash : '');
  },
  'result-win': result('win', TARGET_PCT),
  'result-loss': result('loss', STOP_PCT),
  'result-cashout': result('cashed_out', favourForPnl(1.25)),
  'result-timeout': result('timeout', favourForPnl(0.35)),
  'result-levelup': result('win', TARGET_PCT, { progression: LEVEL_UP_PROGRESSION, leveledUp: true }),
  'mission-toast': result('win', TARGET_PCT, { progression: MISSION_PROGRESSION, missionToast: true }),
};

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');

async function waitForFonts(): Promise<boolean> {
  const settled = await Promise.race([
    document.fonts.ready.then(() => true),
    sleep(FONT_TIMEOUT_MS).then(() => false),
  ]);
  if (!settled) return false;
  const primary = unquote(getComputedStyle(document.body).fontFamily.split(',')[0] ?? '');
  return Array.from(document.fonts).some((face) => unquote(face.family) === primary && face.status === 'loaded');
}

export async function playScene(params: DevSceneParams, ctx: () => DevSceneContext): Promise<void> {
  const entry = SCENES.find((scene) => scene.name === params.name);
  try {
    if (!entry || !Object.hasOwn(RECIPES, params.name)) throw new Error(`Unknown scene "${params.name}"`);
    if (params.freeze) seedRandom(params.seed);
    await RECIPES[params.name]({ name: params.name, params, ctx, hash: sceneHash(params.seed) });
  } catch (error) {
    sceneErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (params.freeze) marketFeed.cleanup();

  const fontsOk = await waitForFonts();
  await sleep(entry?.settleMs ?? DEFAULT_SETTLE_MS);
  window.__scene = { name: params.name, fontsOk, errors: [...sceneErrors] };
  document.documentElement.dataset.sceneReady = '1';
}
