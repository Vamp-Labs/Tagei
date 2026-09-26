import { describe, expect, it } from 'vitest';
import { STALL_AFTER_SEC } from '../src/constants.ts';
import { Direction, Outcome, VoidReason } from '../src/enums.ts';
import { barrierPrices, maxPayout } from '../src/lane.ts';
import { evaluatePath, type Checkpoint, type PathSource, type RoundTerms } from '../src/path.ts';

const E18 = 10n ** 18n;
const p0 = 600n * E18;
const stake = 10n * E18;

const terms = (over: Partial<RoundTerms> = {}): RoundTerms => ({
  direction: Direction.Long,
  stake,
  maxPayout: maxPayout(stake, 20_000),
  entrySec: 1_000,
  endSec: 1_020,
  targetPpm: 450,
  stopPpm: 400,
  multiplierBps: 20_000,
  feeBps: 100,
  maxJumpPpm: 5_000,
  cashOutRequested: false,
  ...over,
});

function source(prices: Record<number, bigint | Checkpoint>, permanent: number[] = []): PathSource {
  return {
    get: (sec) => {
      const v = prices[sec];
      if (v === undefined) return undefined;
      return typeof v === 'bigint' ? { price18: v, disputed: false } : v;
    },
    isPermanentlyMissing: (sec) => permanent.includes(sec),
  };
}

const flatPath = (from: number, to: number, price = p0) => {
  const out: Record<number, bigint> = {};
  for (let s = from; s <= to; s++) out[s] = price;
  return out;
};

const { target, stop } = barrierPrices(Direction.Long, p0, 450, 400);

describe('evaluatePath', () => {
  it('pays maxPayout on the first target touch even if the stop is touched later', () => {
    const prices = { ...flatPath(1_000, 1_020), 1_005: target, 1_006: stop };
    const r = evaluatePath(terms(), source(prices), 1_030);
    expect(r).toMatchObject({ decidable: true, outcome: Outcome.TargetHit, payout: maxPayout(stake, 20_000), decisionSec: 1_005 });
  });

  it('pays zero on the first stop touch', () => {
    const prices = { ...flatPath(1_000, 1_020), 1_003: stop, 1_004: target };
    expect(evaluatePath(terms(), source(prices), 1_030)).toMatchObject({ outcome: Outcome.StopHit, payout: 0n, decisionSec: 1_003 });
  });

  it('decides a touch before later seconds are recorded', () => {
    const prices = { 1_000: p0, 1_001: p0, 1_002: target };
    expect(evaluatePath(terms(), source(prices), 1_002)).toMatchObject({ decidable: true, outcome: Outcome.TargetHit });
  });

  it('settles a timeout with the interior payout', () => {
    const r = evaluatePath(terms(), source(flatPath(1_000, 1_020)), 1_021);
    expect(r).toMatchObject({ outcome: Outcome.Timeout, payout: (stake * 9_900n) / 10_000n, decisionSec: 1_020 });
  });

  it('labels a shortened round as a cash-out', () => {
    const r = evaluatePath(terms({ endSec: 1_008, cashOutRequested: true }), source(flatPath(1_000, 1_008)), 1_009);
    expect(r).toMatchObject({ outcome: Outcome.CashedOut, decisionSec: 1_008 });
  });

  it('waits on a missing second that can still be recorded', () => {
    const prices = flatPath(1_000, 1_020);
    delete prices[1_010];
    expect(evaluatePath(terms(), source(prices), 1_025)).toEqual({ decidable: false, missingSec: 1_010, entryPrice: p0 });
  });

  it('voids on a provably permanent gap and refunds the stake', () => {
    const prices = flatPath(1_000, 1_020);
    delete prices[1_010];
    expect(evaluatePath(terms(), source(prices, [1_010]), 1_025)).toMatchObject({
      outcome: Outcome.Voided,
      voidReason: VoidReason.CheckpointGap,
      payout: stake,
    });
  });

  it('voids a stalled round', () => {
    const prices = flatPath(1_000, 1_020);
    delete prices[1_010];
    const r = evaluatePath(terms(), source(prices), 1_020 + STALL_AFTER_SEC + 1);
    expect(r).toMatchObject({ outcome: Outcome.Voided, voidReason: VoidReason.Stalled });
  });

  it('voids a disputed entry', () => {
    const prices = { ...flatPath(1_000, 1_020), 1_000: { price18: p0, disputed: true } };
    expect(evaluatePath(terms(), source(prices), 1_021)).toMatchObject({ outcome: Outcome.Voided, voidReason: VoidReason.EntryInvalid });
  });

  it('voids a round when a checkpoint inside the path is disputed (G1 L1)', () => {
    const prices = { ...flatPath(1_000, 1_020), 1_005: { price18: target, disputed: true } };
    expect(evaluatePath(terms(), source(prices), 1_021)).toMatchObject({
      outcome: Outcome.Voided,
      voidReason: VoidReason.PathDisputed,
      payout: stake,
      decisionSec: 1_005,
    });
  });

  it('ignores a dispute after the deciding second', () => {
    const prices = { ...flatPath(1_000, 1_020), 1_003: target, 1_006: { price18: p0, disputed: true } };
    expect(evaluatePath(terms(), source(prices), 1_021)).toMatchObject({ outcome: Outcome.TargetHit, decisionSec: 1_003 });
  });

  it('skips a jump checkpoint mid-round but voids an invalid terminal', () => {
    const spike = p0 + p0 / 50n; // +2%, above maxJumpPpm
    const mid = { ...flatPath(1_000, 1_020), 1_010: spike };
    expect(evaluatePath(terms(), source(mid), 1_021)).toMatchObject({ outcome: Outcome.Timeout });

    const end = { ...flatPath(1_000, 1_020), 1_020: spike };
    expect(evaluatePath(terms(), source(end), 1_021)).toMatchObject({ outcome: Outcome.Voided, voidReason: VoidReason.TerminalInvalid });
  });

  it('lets a barrier win at the exit second of a cash-out', () => {
    const prices = { ...flatPath(1_000, 1_008), 1_008: target };
    expect(evaluatePath(terms({ endSec: 1_008, cashOutRequested: true }), source(prices), 1_009)).toMatchObject({ outcome: Outcome.TargetHit });
  });
});
