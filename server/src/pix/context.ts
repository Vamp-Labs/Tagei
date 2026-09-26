// PIX context builder: every number PIX can show is computed here, from the price
// hub (exact Supra rounds), cached hub `stats` events, Binance klines/ticker and the
// round's recorded path. The LLM only chooses which FactorKeys to show and writes copy.

import { assetBySymbol, type AssetSymbol } from '@bnbplay/shared/assets';
import type { RoundDTO } from '@bnbplay/shared/dto';
import type { FactorKey } from '@bnbplay/shared/pix';
import type { OracleRound, PriceHub } from '../ports.ts';
import type { MarketData, TierDTO } from '../api/deps.ts';
import { baseSigmaPpm } from '../api/lanes.fixture.ts';
import { FACTOR_LABELS, formatPct, formatUsd18, debriefBranch, type DebriefBranch, type InsightSentiment, type VolatilityRegime } from './templates.ts';

export interface Factor {
  key: FactorKey;
  label: string;
  value: string;
  positive?: boolean;
}

export interface HubStats {
  sigma1sPpm: number;
  momentum60sPpm: number;
  change24hPct: number | null;
}

export interface MarketFacts {
  asset: AssetSymbol;
  sentiment: InsightSentiment;
  volatility: VolatilityRegime | null;
  factors: Factor[];
  /** Plain-language facts handed to the LLM (numbers pre-formatted). */
  facts: Record<string, string>;
}

const sorted = (rs: readonly OracleRound[]) => [...rs].sort((a, b) => a.sec - b.sec);

/** Price move in % over `sec` seconds, from the latest round back. */
function changePct(rounds: readonly OracleRound[], sec: number): number | null {
  const last = rounds[rounds.length - 1];
  if (!last) return null;
  let ref: OracleRound | undefined;
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (r && r.sec <= last.sec - sec) {
      ref = r;
      break;
    }
  }
  if (!ref || ref.price18 === 0n) return null;
  return (Number(last.price18 - ref.price18) / Number(ref.price18)) * 100;
}

/** Realized σ of 1 s simple returns, in ppm, over consecutive rounds. */
export function realizedSigmaPpm(rounds: readonly OracleRound[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < rounds.length; i++) {
    const a = rounds[i - 1];
    const b = rounds[i];
    if (!a || !b || b.sec - a.sec !== 1 || a.price18 === 0n) continue;
    rets.push((Number(b.price18 - a.price18) / Number(a.price18)) * 1e6);
  }
  if (rets.length < 20) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  return Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1));
}

export function volatilityRegime(ratio: number | null): VolatilityRegime | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  if (ratio >= 1.4) return 'elevated';
  if (ratio <= 0.7) return 'calm';
  return 'normal';
}

const volFactor = (sigma: number | null, base: number): Factor | null => {
  if (sigma === null) return null;
  const ratio = sigma / base;
  const regime = volatilityRegime(ratio);
  const word = regime === 'elevated' ? 'Elevated' : regime === 'calm' ? 'Calm' : 'Normal';
  return { key: 'volatility', label: FACTOR_LABELS.volatility, value: `${word} (${ratio.toFixed(1)}x usual)` };
};

const signedFactor = (key: FactorKey, pct: number | null, digits = 2): Factor | null =>
  pct === null ? null : { key, label: FACTOR_LABELS[key], value: formatPct(pct, digits), ...(pct > 0 ? { positive: true } : pct < 0 ? { positive: false } : {}) };

export async function buildMarketFacts(deps: {
  asset: AssetSymbol;
  priceHub: PriceHub;
  marketData?: MarketData;
  stats?: HubStats;
  lane?: TierDTO;
}): Promise<MarketFacts> {
  const def = assetBySymbol(deps.asset);
  const rounds = sorted(deps.priceHub.history(def.supraPairId, 301));
  const base = baseSigmaPpm(deps.asset).robust;
  const [klines, ticker] = await Promise.all([
    deps.marketData?.klines1m(deps.asset, 60).catch(() => undefined),
    deps.marketData?.ticker24h(deps.asset).catch(() => undefined),
  ]);

  let change1m = changePct(rounds, 60);
  let change5m = changePct(rounds, 300);
  if (klines && klines.length >= 6) {
    const last = klines[klines.length - 1] as (typeof klines)[number];
    const k5 = klines[klines.length - 6] as (typeof klines)[number];
    if (change5m === null && k5.close > 0) change5m = ((last.close - k5.close) / k5.close) * 100;
    if (change1m === null && last.open > 0) change1m = ((last.close - last.open) / last.open) * 100;
  }
  const sigma = realizedSigmaPpm(rounds.slice(-121)) ?? deps.stats?.sigma1sPpm ?? null;

  let volumeSpikePct: number | null = null;
  let buyPressurePct: number | null = null;
  if (klines && klines.length >= 20) {
    const recent = klines.slice(-5);
    const prior = klines.slice(0, -5);
    const avgPrior = prior.reduce((s, k) => s + k.volume, 0) / prior.length;
    const avgRecent = recent.reduce((s, k) => s + k.volume, 0) / recent.length;
    if (avgPrior > 0) volumeSpikePct = (avgRecent / avgPrior - 1) * 100;
    const last15 = klines.slice(-15);
    const vol = last15.reduce((s, k) => s + k.volume, 0);
    if (vol > 0) buyPressurePct = (last15.reduce((s, k) => s + k.takerBuyVolume, 0) / vol) * 100;
  }
  let rangePct: number | null = null;
  if (ticker) {
    const hi = Number(ticker.highPrice);
    const lo = Number(ticker.lowPrice);
    const last = Number(ticker.lastPrice);
    if (hi > lo) rangePct = Math.max(0, Math.min(100, ((last - lo) / (hi - lo)) * 100));
  }
  const change24h = ticker?.changePct ?? deps.stats?.change24hPct ?? null;

  // Sentiment: σ-normalized momentum plus order-flow tilt (computed, never from the LLM).
  const s = sigma ?? base;
  const z1 = change1m === null ? 0 : (change1m * 1e4) / (s * Math.sqrt(60));
  const z5 = change5m === null ? 0 : (change5m * 1e4) / (s * Math.sqrt(300));
  const tilt = buyPressurePct === null ? 0 : (buyPressurePct - 50) / 10;
  const score = 0.6 * z5 + 0.4 * z1 + 0.5 * tilt;
  const sentiment: InsightSentiment = score > 0.8 ? 'bullish' : score < -0.8 ? 'bearish' : 'neutral';
  const volatility = volatilityRegime(sigma === null ? null : sigma / base);

  const factors: Factor[] = [];
  const push = (f: Factor | null) => {
    if (f) factors.push(f);
  };
  push(signedFactor('momentum_5m', change5m));
  push(signedFactor('momentum_1m', change1m));
  if (buyPressurePct !== null) {
    const word = buyPressurePct >= 55 ? 'Strong' : buyPressurePct <= 45 ? 'Weak' : 'Balanced';
    push({
      key: 'buy_pressure',
      label: FACTOR_LABELS.buy_pressure,
      value: `${word} (${Math.round(buyPressurePct)}% buys)`,
      ...(buyPressurePct >= 55 ? { positive: true } : buyPressurePct <= 45 ? { positive: false } : {}),
    });
  }
  push(volFactor(sigma, base));
  if (volumeSpikePct !== null) push({ key: 'volume_spike', label: FACTOR_LABELS.volume_spike, value: `${formatPct(volumeSpikePct, 0)} vs 1h avg` });
  if (rangePct !== null) {
    const where = rangePct >= 75 ? 'Near high' : rangePct <= 25 ? 'Near low' : 'Mid-range';
    push({ key: 'range_position', label: FACTOR_LABELS.range_position, value: `${where} (${Math.round(rangePct)}%)` });
  }
  push(signedFactor('change_24h', change24h));
  if (deps.lane && sigma) {
    const reach = deps.lane.targetPpm / (sigma * Math.sqrt(deps.lane.durationSec));
    push({ key: 'lane_reach', label: FACTOR_LABELS.lane_reach, value: `${reach.toFixed(1)}x a typical ${deps.lane.durationSec}s move` });
  }

  const facts: Record<string, string> = { asset: deps.asset, sentiment, ...(volatility ? { volatility } : {}) };
  if (deps.lane) facts.lane = `${deps.lane.label}: ${deps.lane.durationSec}s round`;
  return { asset: deps.asset, sentiment, volatility, factors, facts };
}

// ── Debrief facts ─────────────────────────────────────────────────────────────

export interface DebriefFacts {
  branch: DebriefBranch;
  elapsedSec: number | null;
  durationSec: number;
  factors: Factor[];
  facts: Record<string, string>;
}

export function buildDebriefFacts(round: RoundDTO, priceHub: PriceHub): DebriefFacts {
  const stake = BigInt(round.terms.stake);
  const payout = BigInt(round.payout ?? '0');
  const pnl = payout - stake;
  const branch = debriefBranch(round.outcome ?? 'voided', pnl);
  const entry = round.terms.entrySec;
  const decision = round.decisionSec ?? round.exitSec;
  const elapsedSec = decision !== null ? decision - entry : null;
  const durationSec = round.terms.endSec - entry;
  const def = assetBySymbol(round.asset);
  const rounds = sorted(priceHub.history(def.supraPairId, 1800));
  const factors: Factor[] = [];
  const secs = elapsedSec !== null && elapsedSec > 0 ? `${elapsedSec}s` : null;

  // Momentum in the 30 s before entry, relative to the chosen side.
  const pre = rounds.filter((r) => r.sec >= entry - 30 && r.sec <= entry);
  const first = pre[0];
  const last = pre[pre.length - 1];
  let entryTiming: Factor | null = null;
  if (first && last && pre.length >= 10 && first.price18 > 0n) {
    const movePct = (Number(last.price18 - first.price18) / Number(first.price18)) * 100;
    const aligned = round.terms.direction === 'LONG' ? movePct : -movePct;
    const flat = Math.abs(movePct) < 0.005;
    entryTiming = {
      key: 'entry_timing',
      label: FACTOR_LABELS.entry_timing,
      value: flat ? 'Flat start' : aligned > 0 ? 'With momentum' : 'Against momentum',
      ...(flat ? {} : { positive: aligned > 0 }),
    };
  }
  const during = rounds.filter((r) => r.sec >= entry && r.sec <= (decision ?? round.terms.endSec));
  const vol = volFactor(realizedSigmaPpm(during), baseSigmaPpm(round.asset).robust);

  const pnlText = formatUsd18(pnl, { signed: true });
  switch (branch) {
    case 'win':
      if (secs) factors.push({ key: 'time_to_touch', label: 'Time to target', value: secs, positive: true });
      break;
    case 'loss':
      if (secs) factors.push({ key: 'time_to_touch', label: 'Time to stop', value: secs, positive: false });
      factors.push({ key: 'stop_honored', label: FACTOR_LABELS.stop_honored, value: 'Loss capped at stake' });
      break;
    case 'timeout_gain':
      factors.push({ key: 'secured_gain', label: FACTOR_LABELS.secured_gain, value: pnlText, positive: true });
      break;
    case 'cashout_gain':
    case 'cashout_loss':
      if (secs) factors.push({ key: 'exit_choice', label: FACTOR_LABELS.exit_choice, value: `${secs} of ${durationSec}s` });
      if (branch === 'cashout_gain') factors.push({ key: 'secured_gain', label: FACTOR_LABELS.secured_gain, value: pnlText, positive: true });
      break;
    default:
      break;
  }
  if (branch !== 'voided') {
    if (entryTiming) factors.push(entryTiming);
    if (vol) factors.push(vol);
  }
  const facts: Record<string, string> = {
    asset: round.asset,
    direction: round.terms.direction,
    result: branch,
    pnl: branch === 'voided' ? 'stake returned' : pnlText,
    roundLength: `${durationSec}s`,
  };
  if (secs) facts.decidedAfter = secs;
  return { branch, elapsedSec, durationSec, factors, facts };
}
