import { describe, expect, it } from 'vitest';
import { dailyXpFactor, isDisciplinedExit, levelForXp, levelStartXp, titleForLevel, xpToNextLevel } from '../src/progression.ts';

const E18 = 10n ** 18n;

describe('level curve', () => {
  it('matches the published thresholds', () => {
    expect([2, 3, 4, 5, 7, 8, 10].map(levelStartXp)).toEqual([40, 100, 180, 280, 540, 700, 1080]);
    expect(xpToNextLevel(1)).toBe(40);
  });

  it('maps xp to level at the boundaries', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(39)).toBe(1);
    expect(levelForXp(40)).toBe(2);
    expect(levelForXp(539)).toBe(6);
    expect(levelForXp(540)).toBe(7);
  });

  it('assigns titles by level', () => {
    expect(titleForLevel(1)).toBe('CADET');
    expect(titleForLevel(7)).toBe('MOMENTUM HUNTER');
    expect(titleForLevel(25)).toBe('ORBIT LEGEND');
  });
});

describe('disciplined exit', () => {
  const base = { stake: 10n * E18, durationSec: 20 };
  it('requires minimum hold time', () => {
    expect(isDisciplinedExit({ ...base, payout: 12n * E18, elapsedSec: 4 })).toBe(false);
    expect(isDisciplinedExit({ ...base, payout: 12n * E18, elapsedSec: 6 })).toBe(true);
  });
  it('accepts cutting losses but not a near-total loss', () => {
    expect(isDisciplinedExit({ ...base, payout: 5n * E18, elapsedSec: 10 })).toBe(true);
    expect(isDisciplinedExit({ ...base, payout: 3n * E18, elapsedSec: 10 })).toBe(false);
  });
});

describe('daily diminishing returns', () => {
  it('halves then stops XP', () => {
    expect(dailyXpFactor(0)).toBe(1);
    expect(dailyXpFactor(30)).toBe(0.5);
    expect(dailyXpFactor(60)).toBe(0);
  });
});
