import { SUPPORTED_ASSETS, type AssetSymbol } from '../types/market';
import type { SettlementStep } from '../services/web3Service';
import type { DevSceneParams } from './types';

export const DEFAULT_SEED = 7;
const PARK_TIMERS_FROM_MS = 1000;
const PARKED_DELAY_MS = 2_147_483_647;
const SETTLEMENT_STEPS: readonly SettlementStep[] = ['idle', 'preparing', 'signing', 'submitted', 'confirmed', 'failed'];
const HIDE_LEGACY_CONFETTI_CSS = 'body > canvas { display: none !important; }';

export const sceneErrors: string[] = [];

let installed = false;
let nativeSetTimeout: ((handler: () => void, ms: number) => number) | null = null;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedRandom(seed: number): void {
  Math.random = mulberry32(seed);
}

export function sleep(ms: number): Promise<void> {
  const schedule = nativeSetTimeout ?? ((handler: () => void, delay: number) => window.setTimeout(handler, delay));
  return new Promise((resolve) => {
    schedule(resolve, ms);
  });
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isAsset(value: string): value is AssetSymbol {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_ASSETS, value);
}

function isStep(value: string): value is SettlementStep {
  return (SETTLEMENT_STEPS as readonly string[]).includes(value);
}

export function readSceneParams(search: string): DevSceneParams | null {
  const query = new URLSearchParams(search);
  const name = query.get('scene');
  if (!name) return null;

  const warn = (key: string, value: string) => sceneErrors.push(`Ignored ${key}=${value}`);
  const rawDir = query.get('dir')?.toUpperCase() ?? null;
  const rawAsset = query.get('asset')?.toUpperCase() ?? null;
  const rawDelta = query.get('delta');
  const rawStep = query.get('step');
  const rawSeed = query.get('seed');

  let dir: DevSceneParams['dir'] = null;
  if (rawDir === 'LONG' || rawDir === 'SHORT') dir = rawDir;
  else if (rawDir) warn('dir', rawDir);

  let asset: DevSceneParams['asset'] = null;
  if (rawAsset && isAsset(rawAsset)) asset = rawAsset;
  else if (rawAsset) warn('asset', rawAsset);

  let delta: number | null = null;
  if (rawDelta !== null && Number.isFinite(Number(rawDelta))) delta = Number(rawDelta);
  else if (rawDelta !== null) warn('delta', rawDelta);

  let step: SettlementStep | null = null;
  if (rawStep && isStep(rawStep)) step = rawStep;
  else if (rawStep) warn('step', rawStep);

  let seed = DEFAULT_SEED;
  if (rawSeed !== null && Number.isInteger(Number(rawSeed))) seed = Number(rawSeed);
  else if (rawSeed !== null) warn('seed', rawSeed);

  return {
    name,
    freeze: query.get('freeze') === '1',
    rm: query.get('rm') === '1',
    sim: query.get('sim') === '1',
    fx: query.get('fx') !== '0',
    dir,
    asset,
    delta,
    step,
    seed,
  };
}

function parkLongTimers(): void {
  const setTimeoutNative = window.setTimeout.bind(window);
  const setIntervalNative = window.setInterval.bind(window);
  nativeSetTimeout = (handler, ms) => setTimeoutNative(handler, ms);
  const parkedDelay = (ms?: number) => (ms !== undefined && ms >= PARK_TIMERS_FROM_MS ? PARKED_DELAY_MS : ms);

  window.setTimeout = Object.assign(
    (handler: TimerHandler, ms?: number, ...args: unknown[]) => setTimeoutNative(handler, parkedDelay(ms), ...args),
    window.setTimeout,
  );
  window.setInterval = Object.assign(
    (handler: TimerHandler, ms?: number, ...args: unknown[]) => setIntervalNative(handler, parkedDelay(ms), ...args),
    window.setInterval,
  );
}

export function installSceneRuntime(params: DevSceneParams): void {
  if (installed) return;
  installed = true;

  const root = document.documentElement;
  root.dataset.scene = params.name;
  if (params.freeze) root.dataset.sceneFreeze = '1';
  if (!params.fx) root.dataset.sceneFx = '0';

  window.addEventListener('error', (event) => sceneErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => sceneErrors.push(String(event.reason)));

  if (params.freeze) {
    seedRandom(params.seed);
    parkLongTimers();
  }

  if (params.freeze || !params.fx) {
    const style = document.createElement('style');
    style.dataset.sceneStyle = 'confetti';
    style.textContent = HIDE_LEGACY_CONFETTI_CSS;
    document.head.appendChild(style);
  }
}
