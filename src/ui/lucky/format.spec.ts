import { describe, expect, it } from 'vitest';
import {
  MINUS,
  formatAmount,
  formatHash,
  formatLeverage,
  formatMultiplier,
  formatPct,
  formatPrice,
  formatTimer,
  formatXp,
  signOf,
} from './format';

describe('formatAmount', () => {
  it('signs gains and losses with a true minus and the code after the number', () => {
    expect(formatAmount(2.16)).toBe('+2.16 USDT');
    expect(formatAmount(-1.62)).toBe(`${MINUS}1.62 USDT`);
    expect(MINUS).toBe('−');
  });

  it('rounds before choosing the sign and prints zero unsigned', () => {
    expect(formatAmount(0)).toBe('0.00 USDT');
    expect(formatAmount(-0.004)).toBe('0.00 USDT');
    expect(formatAmount(0.004)).toBe('0.00 USDT');
    expect(formatAmount(-0.005, 'USDT', { decimals: 2 })).not.toContain('+');
  });

  it('supports auto and never signs, custom decimals and no unit', () => {
    expect(formatAmount(10, 'USDT', { sign: 'never' })).toBe('10.00 USDT');
    expect(formatAmount(1.25, 'USDT', { sign: 'auto' })).toBe('1.25 USDT');
    expect(formatAmount(-1.25, null, { sign: 'auto' })).toBe(`${MINUS}1.25`);
    expect(formatAmount(612.3456, 'USDT', { sign: 'never', decimals: 3 })).toBe('612.346 USDT');
    expect(formatAmount(1234.5)).toBe('+1,234.50 USDT');
  });
});

describe('formatPrice', () => {
  it('uses fixed en-US grouping', () => {
    expect(formatPrice(95400)).toBe('95,400.00');
    expect(formatPrice(612.34, { unit: 'USDT' })).toBe('612.34 USDT');
    expect(formatPrice(0.245)).toBe('0.2450');
    expect(formatPrice(2850.5, { decimals: 1 })).toBe('2,850.5');
  });
});

describe('small formatters', () => {
  it('formats percentages, multipliers, leverage and xp', () => {
    expect(formatPct(1.2)).toBe('+1.20%');
    expect(formatPct(-0.9)).toBe(`${MINUS}0.90%`);
    expect(formatMultiplier(1.216)).toBe('1.22x');
    expect(formatLeverage(18.4)).toBe('18x');
    expect(formatXp(720)).toBe('720 XP');
    expect(formatXp(50, { sign: 'always' })).toBe('+50 XP');
  });

  it('formats timers and hashes', () => {
    expect(formatTimer(17)).toBe('00:17');
    expect(formatTimer(75.9)).toBe('01:15');
    expect(formatTimer(-3)).toBe('00:00');
    expect(formatTimer(72504)).toBe('20:08:24');
    expect(formatHash('0x12ab34cd56ef78909f3c')).toBe('0x12ab…9f3c');
    expect(formatHash('0x1234')).toBe('0x1234');
  });

  it('reports the sign of the rounded value', () => {
    expect(signOf(2.16)).toBe(1);
    expect(signOf(-1.62)).toBe(-1);
    expect(signOf(-0.001)).toBe(0);
  });
});
