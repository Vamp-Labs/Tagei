import { describe, expect, it } from 'vitest';
import { practiceTiers } from '../../src/game/lanes';
import { SettlementEngine } from '../../src/services/settlementEngine';
import { exitTickIndex, priceSpan } from '../../src/canvas/trackMath';
import { badgeViews, mergeUnlocked, pilotTitle, progressionFromEvent, streakBonusXp } from '../../src/components/game/progression';
import { clampStake, liveTierOptions, pickTier, practiceTierOptions, tierOptions } from '../../src/components/game/tiers';
import { leverageText, markerLabels, roundEndMs, splitNotice, stopPnl, targetPnl } from '../../src/components/game/roundDisplay';
import { priceBeyond, practiceResult } from '../../src/components/game/usePracticeRound';
import { LAUNCH_NOT_CONFIRMED_COPY } from '../../src/services/roundService';

const laneRound = () => {
  const lane = SettlementEngine.practiceLane('BNB', 0);
  if (!lane) throw new Error('BNB practice lane missing');
  return SettlementEngine.initLaneRound('BNB', 'LONG', 10, 612.34, lane, Date.parse('2026-09-27T00:00:00Z'));
};

describe('tier options (F1e)', () => {
  it('offers CRUISE and BOOST, and shows HYPER/WARP as locked coming-soon chips', () => {
    const options = practiceTierOptions('BNB');
    expect(options.map((option) => [option.label, option.enabled, option.comingSoon])).toEqual([
      ['CRUISE', true, false],
      ['BOOST', true, false],
      ['HYPER', false, true],
      ['WARP', false, true],
    ]);
    expect(options[0].summary).toMatch(/^Target \+[\d.]+% · Stop −[\d.]+% · 1\.5x$/);
    expect(options[0]).toMatchObject({ minStake: 5, maxStake: 50 });
  });

  it('hides BTC BOOST (disabled, not a preview tier) so BTC plays CRUISE only', () => {
    const labels = tierOptions(practiceTiers('BTC')).map((option) => option.label);
    expect(labels).toEqual(['CRUISE', 'HYPER', 'WARP']);
    expect(pickTier(practiceTierOptions('BTC'), 1)?.label).toBe('CRUISE');
  });

  it('reads live tiers from config and returns none for a disabled asset', () => {
    const tiers = practiceTiers('ETH');
    const config = { assets: [{ symbol: 'ETH', enabled: true, tiers }, { symbol: 'SOL', enabled: false, tiers }] };
    expect(liveTierOptions(config as never, 'ETH')).toHaveLength(4);
    expect(liveTierOptions(config as never, 'SOL')).toEqual([]);
    expect(liveTierOptions(null, 'ETH')).toEqual([]);
  });

  it('clamps the stake into the lane bounds without inventing a value', () => {
    const tier = pickTier(practiceTierOptions('BNB'), 0);
    expect(clampStake(10, tier)).toBe(10);
    expect(clampStake(80, tier)).toBe(50);
    expect(clampStake(1, tier)).toBe(5);
  });
});

describe('round display values come from the lane, not hardcoded dollars', () => {
  it('labels target and stop with the lane payout and −stake', () => {
    const round = laneRound();
    expect(targetPnl(round)).toBeCloseTo(5, 6);
    expect(stopPnl(round)).toBe(-10);
    const labels = markerLabels(round);
    expect(labels.target.startsWith('TARGET +5.00 USDT · ')).toBe(true);
    expect(labels.stop.startsWith('STOP −10.00 USDT · ')).toBe(true);
    expect(leverageText(round)).toBe('CRUISE 1.5x');
  });

  it('keeps legacy engine rounds on their own 18x terms', () => {
    const legacy = SettlementEngine.initRound('BNB', 'LONG', 10, 612.34);
    expect(leverageText(legacy)).toBe('18x');
    expect(targetPnl(legacy)).toBeCloseTo(2.16, 6);
    expect(stopPnl(legacy)).toBeCloseTo(-1.62, 6);
  });

  it('times live rounds from endSec and practice rounds from their start', () => {
    const round = laneRound();
    expect(roundEndMs(round)).toBe(round.startTime + round.durationSeconds * 1000);
    expect(roundEndMs({ ...round, mode: 'live', endSec: 1_800_000_030 })).toBe(1_800_000_030_000);
  });

  it('splits the launch failure copy into title and body', () => {
    expect(splitNotice(LAUNCH_NOT_CONFIRMED_COPY)).toEqual({ title: 'LAUNCH NOT CONFIRMED', body: 'Your stake was not taken.' });
  });
});

describe('practice results use the same exact tick for exit and P&L', () => {
  it('builds the result from the evaluated round, with no XP and no tx', () => {
    const round = laneRound();
    const { updatedRound } = SettlementEngine.evaluateLaneTick(round, priceBeyond(round, 'target'));
    const result = practiceResult(updatedRound, 'win', round.startTime + 12_000);
    expect(result.exitPrice).toBe(updatedRound.currentPrice);
    expect(result.pnl).toBe(updatedRound.currentPnl);
    expect(result.pnl).toBeCloseTo(5, 2);
    expect(result).toMatchObject({ mode: 'practice', xpEarned: 0, txHash: '', durationSec: 12, tierLabel: 'CRUISE' });
  });

  it('nudges a forced barrier just past the line so the evaluator sees a touch', () => {
    const round = laneRound();
    expect(SettlementEngine.evaluateLaneTick(round, priceBeyond(round, 'target')).isTargetHit).toBe(true);
    expect(SettlementEngine.evaluateLaneTick(round, priceBeyond(round, 'stop')).isLossHit).toBe(true);
    const short = { ...round, direction: 'SHORT' as const, targetPrice: round.stopLossPrice, stopLossPrice: round.targetPrice };
    expect(priceBeyond(short, 'target')).toBeLessThan(short.targetPrice);
  });
});

describe('canvas track maths', () => {
  it('keeps a 0.03% floor on the price span', () => {
    expect(priceSpan(600, 600)).toBeCloseTo(0.18, 9);
    expect(priceSpan(600, 610)).toBe(10);
  });

  it('places the last-round marker at the tick nearest the real exit time', () => {
    const history = [1000, 1250, 1500, 1750].map((timestamp) => ({ timestamp }));
    expect(exitTickIndex(history, 1300)).toBe(1);
    expect(exitTickIndex(history, 1400)).toBe(2);
    expect(exitTickIndex(history, 10)).toBe(0);
    expect(exitTickIndex(history, 9999)).toBe(3);
    expect(exitTickIndex([], 1)).toBe(-1);
  });
});

describe('progression mapping (F1d)', () => {
  const event = {
    roundId: '7',
    xpBefore: 120,
    xpAfter: 155,
    gained: [{ reason: 'round_complete', amount: 20 }, { reason: 'target_hit', amount: 15 }],
    level: 3,
    title: 'NAVIGATOR',
    levelStartXp: 100,
    nextLevelXp: 180,
    leveledUp: false,
    missions: [{ id: 'fly_3', title: 'Fly 3 rounds', progress: 2, goal: 3, xp: 50, completed: false }],
    missionJustCompleted: null,
    streakDays: 2,
    badgesUnlocked: [{ id: 'first_orbit', title: 'First Orbit' }],
  };

  it('maps the server payload onto the UI progression', () => {
    expect(progressionFromEvent(event)).toEqual({
      level: 3,
      title: 'NAVIGATOR',
      currentXp: 155,
      nextLevelXp: 180,
      streakDays: 2,
      dailyRoundsPlayed: 2,
      dailyRoundsGoal: 3,
      missionCompleted: false,
    });
    expect(pilotTitle({ level: 7 })).toBe('MOMENTUM HUNTER');
    expect(streakBonusXp(3)).toBe(30);
    expect(streakBonusXp(9)).toBe(50);
  });

  it('shows every badge locked until the server unlocks it', () => {
    expect(badgeViews([]).every((badge) => !badge.earned)).toBe(true);
    const views = badgeViews(mergeUnlocked([], event.badgesUnlocked));
    expect(views.find((badge) => badge.id === 'first_orbit')?.earned).toBe(true);
    expect(views.find((badge) => badge.id === 'whale_hunter')).toMatchObject({ earned: false, progress: { current: 0, goal: 5 } });
  });
});
