import { PPM } from '@bnbplay/shared/constants';
import { Direction, directionFromLabel } from '@bnbplay/shared/enums';
import { Touch, barrierPrices, directional } from '@bnbplay/shared/lane';
import { evaluatePath, markToMarket, type Checkpoint, type Evaluation, type RoundTerms } from '@bnbplay/shared/path';
import { explorerTxUrl } from '@bnbplay/shared/chain';
import type { RoundDTO, RoundTermsDTO } from '@bnbplay/shared/dto';
import type { ActiveTradeRound, TradeResult } from '../types/game';
import { tierLabel } from './lanes';
import { fromPrice18, payoutMultiple, roundCents, stake18ToUsd } from './units';

export function termsFromDTO(dto: RoundTermsDTO, cashOutRequested = false): RoundTerms {
  return {
    direction: directionFromLabel(dto.direction),
    stake: BigInt(dto.stake),
    maxPayout: BigInt(dto.maxPayout),
    entrySec: dto.entrySec,
    endSec: dto.endSec,
    targetPpm: dto.targetPpm,
    stopPpm: dto.stopPpm,
    multiplierBps: dto.multiplierBps,
    feeBps: dto.feeBps,
    maxJumpPpm: dto.maxJumpPpm,
    cashOutRequested,
  };
}

export const roundTerms = (round: RoundDTO): RoundTerms => {
  const terms = termsFromDTO(round.terms, round.cashOutRequested);
  return round.exitSec !== null && round.cashOutRequested ? { ...terms, endSec: round.exitSec } : terms;
};

export interface RoundMark {
  sec: number;
  price18: bigint;
  price: number;
  payout18: bigint;
  pnl18: bigint;
  payout: number;
  pnl: number;
  multiple: number;
  progressPct: number;
  touch: 'none' | 'target' | 'stop';
}

const MAX_PROGRESS_PCT = 120;

export function targetProgressPct(terms: Pick<RoundTerms, 'direction' | 'targetPpm'>, p0: bigint, price18: bigint): number {
  const { fav, mag } = directional(terms.direction, p0, price18);
  if (!fav || p0 <= 0n) return 0;
  const movePpm = Number((mag * PPM * 1_000n) / p0) / 1_000;
  return Math.max(0, Math.min(MAX_PROGRESS_PCT, (movePpm / terms.targetPpm) * 100));
}

export function markRound(terms: RoundTerms, p0: bigint, price18: bigint, sec: number): RoundMark {
  const { payout, touch } = markToMarket(terms, p0, price18);
  const pnl18 = payout - terms.stake;
  return {
    sec,
    price18,
    price: fromPrice18(price18),
    payout18: payout,
    pnl18,
    payout: stake18ToUsd(payout),
    pnl: roundCents(stake18ToUsd(pnl18)),
    multiple: payoutMultiple(payout, terms.stake),
    progressPct: targetProgressPct(terms, p0, price18),
    touch: touch === Touch.Target ? 'target' : touch === Touch.Stop ? 'stop' : 'none',
  };
}

export class RecordedPath {
  private readonly prices = new Map<number, bigint>();

  set(sec: number, price18: bigint): boolean {
    if (this.prices.has(sec)) return false;
    this.prices.set(sec, price18);
    return true;
  }

  get(sec: number): Checkpoint | undefined {
    const price18 = this.prices.get(sec);
    return price18 === undefined ? undefined : { price18, disputed: false };
  }

  isPermanentlyMissing(): boolean {
    return false;
  }

  has(sec: number): boolean {
    return this.prices.has(sec);
  }

  evaluate(terms: RoundTerms, nowSec: number): Evaluation {
    return evaluatePath(terms, this, nowSec);
  }
}

export function activeRoundView(round: RoundDTO, entryPrice18: bigint, mark: RoundMark | null, endSec: number): ActiveTradeRound {
  const terms = roundTerms(round);
  const barriers = barrierPrices(terms.direction, entryPrice18, terms.targetPpm, terms.stopPpm);
  const entryPrice = fromPrice18(entryPrice18);
  const stake = stake18ToUsd(terms.stake);
  const current = mark ?? markRound(terms, entryPrice18, entryPrice18, terms.entrySec);
  return {
    id: round.roundId,
    asset: round.asset,
    direction: terms.direction === Direction.Long ? 'LONG' : 'SHORT',
    stake,
    entryPrice,
    targetPrice: fromPrice18(barriers.target),
    stopLossPrice: fromPrice18(barriers.stop),
    targetPct: terms.targetPpm / 10_000,
    stopLossPct: terms.stopPpm / 10_000,
    startTime: terms.entrySec * 1000,
    durationSeconds: endSec - terms.entrySec,
    currentPrice: current.price,
    currentPnl: current.pnl,
    currentMultiplier: roundCents(current.multiple),
    mode: 'live',
    roundId: round.roundId,
    tier: round.terms.tier,
    tierLabel: tierLabel(round.terms.tier),
    laneVersion: round.terms.laneVersion,
    multiplierBps: terms.multiplierBps,
    feeBps: terms.feeBps,
    targetPpm: terms.targetPpm,
    stopPpm: terms.stopPpm,
    maxPayout: stake18ToUsd(terms.maxPayout),
    entrySec: terms.entrySec,
    endSec,
    cashOutRequested: round.cashOutRequested,
    exitSec: round.exitSec ?? undefined,
  };
}

const LEGACY_OUTCOME: Record<NonNullable<RoundDTO['outcome']>, TradeResult['outcome']> = {
  win: 'win',
  loss: 'loss',
  timeout: 'timeout',
  cashed_out: 'cashed_out',
  voided: 'timeout',
};

export function tradeResultFromRound(round: RoundDTO, xpEarned = 0): TradeResult {
  const stake18 = BigInt(round.terms.stake);
  const voided = round.outcome === 'voided';
  const payout18 = round.payout !== null ? BigInt(round.payout) : voided ? stake18 : 0n;
  const pnl18 = round.pnl !== null ? BigInt(round.pnl) : payout18 - stake18;
  const entryPrice = round.entryPrice !== null && round.entryPrice !== '0' ? fromPrice18(round.entryPrice) : 0;
  const exitPrice = round.exitPrice !== null && round.exitPrice !== '0' ? fromPrice18(round.exitPrice) : entryPrice;
  const settleTx = round.settleTx ?? '';
  const decisionSec = round.decisionSec ?? undefined;
  return {
    id: round.roundId,
    asset: round.asset,
    direction: round.terms.direction,
    stake: stake18ToUsd(stake18),
    entryPrice,
    exitPrice,
    pnl: voided ? 0 : roundCents(stake18ToUsd(pnl18)),
    multiplier: payoutMultiple(payout18, stake18),
    outcome: round.outcome ? LEGACY_OUTCOME[round.outcome] : 'timeout',
    timestamp: round.settledAtMs ?? round.openedAtMs,
    txHash: settleTx,
    xpEarned,
    mode: 'live',
    roundId: round.roundId,
    tier: round.terms.tier,
    tierLabel: tierLabel(round.terms.tier),
    payout: stake18ToUsd(payout18),
    multiplierBps: round.terms.multiplierBps,
    feeBps: round.terms.feeBps,
    entrySec: round.terms.entrySec,
    decisionSec,
    durationSec: decisionSec !== undefined ? Math.max(0, decisionSec - round.terms.entrySec) : undefined,
    voided,
    voidReason: round.voidReason,
    openTxHash: round.openTx,
    explorerUrl: settleTx ? explorerTxUrl(settleTx) : explorerTxUrl(round.openTx),
  };
}
