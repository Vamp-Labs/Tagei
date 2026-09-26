import { describe, expect, it } from 'vitest';
import { guardrailViolations } from '../src/pix.ts';

describe('PIX guardrails', () => {
  it.each([
    'This is a guaranteed win',
    'You should buy now',
    'Double down to win it back',
    'Raise your stake next round',
    'BNB is bound to pump',
    'You lost again',
  ])('blocks: %s', (text) => {
    expect(guardrailViolations(text).length).toBeGreaterThan(0);
  });

  it.each([
    'Momentum is building, but volatility is elevated.',
    'The market reversed shortly after your entry.',
    'Strong momentum can help, but high volatility also increases risk.',
  ])('allows: %s', (text) => {
    expect(guardrailViolations(text)).toEqual([]);
  });
});
