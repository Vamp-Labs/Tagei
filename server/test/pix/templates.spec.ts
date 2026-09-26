import { describe, expect, it } from 'vitest';
import { guardrailViolations } from '@bnbplay/shared/pix';
import {
  DEBRIEF_BRANCHES,
  chatTemplate,
  chatTopic,
  debriefBranch,
  debriefTemplate,
  formatPrice18,
  formatUsd18,
  insightTemplate,
  resultLabel,
} from '../../src/pix/templates.ts';

const E18 = 10n ** 18n;
const clean = (...texts: string[]) => expect(guardrailViolations(texts.join(' \n '))).toEqual([]);

describe('debrief templates: 7 branches', () => {
  const cases = [
    { outcome: 'win', payout: 15n * E18 },
    { outcome: 'loss', payout: 0n },
    { outcome: 'timeout', payout: 12n * E18 },
    { outcome: 'timeout', payout: 8n * E18 },
    { outcome: 'cashed_out', payout: 11n * E18 },
    { outcome: 'cashed_out', payout: 6n * E18 },
    { outcome: 'voided', payout: 10n * E18 },
  ] as const;

  it('covers every branch exactly once', () => {
    expect(cases.map((c) => debriefBranch(c.outcome, c.payout - 10n * E18))).toEqual(DEBRIEF_BRANCHES);
  });

  it.each(cases)('$outcome ($payout) is guardrail-clean and labelled correctly for every variant', ({ outcome, payout }) => {
    for (const direction of ['LONG', 'SHORT'] as const) {
      for (let seed = 0; seed < 6; seed++) {
        const d = debriefTemplate({ asset: 'BNB', direction, outcome, stake: 10n * E18, payout, entryPrice: 612n * E18, exitPrice: 608n * E18, elapsedSec: 12, durationSec: 30, seed });
        clean(d.headline, d.analysis, d.coachingTip, ...d.keyFactors.map((f) => `${f.label} ${f.value}`));
        expect(d.keyFactors.length).toBeGreaterThan(0);
        expect(d.keyFactors.length).toBeLessThanOrEqual(3);
        if (outcome !== 'win') expect(`${d.headline} ${d.analysis}`).not.toMatch(/target reached|crossed your target/i);
        if (outcome === 'cashed_out' && payout < 10n * E18) expect(d.analysis).not.toMatch(/locked|gain/i);
        if (outcome === 'timeout' && payout >= 10n * E18) expect(`${d.headline} ${d.analysis}`).not.toMatch(/stop|reversal/i);
        expect(d.analysis).not.toContain('+$-');
      }
    }
  });
});

describe('insight and chat templates', () => {
  it('are guardrail-clean for every sentiment and volatility', () => {
    for (const sentiment of ['bullish', 'bearish', 'neutral'] as const) {
      for (const volatility of ['calm', 'normal', 'elevated', null] as const) {
        for (let seed = 0; seed < 4; seed++) {
          const t = insightTemplate({ asset: 'ETH', sentiment, volatility, seed });
          clean(t.headline, t.summary, t.learningTip);
          expect(t.headline.split(/\s+/).length).toBeLessThanOrEqual(6);
        }
      }
    }
  });

  it.each([
    ["What's the trend for BNB?", 'trend'],
    ['Is it a good time to go long?', 'direction'],
    ['Explain this chart', 'chart'],
    ['Show key support levels', 'levels'],
    ['I keep losing, how do I win it back?', 'responsible'],
    ['how is the oracle fair?', 'oracle'],
    ['what is a cash out', 'cashout'],
    ['qwerty', 'unknown'],
  ])('answers %s safely', (question, topic) => {
    expect(chatTopic(question)).toBe(topic);
    const out = chatTemplate({ question, asset: 'BNB', insight: { headline: 'Momentum is building.', summary: 'Buying pressure has picked up.' } });
    expect(out.length).toBeGreaterThan(0);
    clean(...out);
  });
});

describe('labels and formatting (prototype bug fixes)', () => {
  it('signs P&L correctly', () => {
    expect(formatUsd18(-16n * 10n ** 17n, { signed: true })).toBe('−$1.60');
    expect(formatUsd18(21n * 10n ** 17n, { signed: true })).toBe('+$2.10');
    expect(formatUsd18(-(10n ** 14n), { signed: true })).toBe('$0.00');
    expect(formatPrice18(64_210_554n * 10n ** 15n)).toBe('$64,210.55');
    expect(formatPrice18(1234n * 10n ** 14n, 4)).toBe('$0.1234');
  });

  it('never gives a timeout or cash-out the TARGET HIT label', () => {
    expect(resultLabel('win', 5n * E18)).toMatchObject({ title: 'TARGET HIT', amount: 'WIN +$5.00' });
    expect(resultLabel('timeout', 2n * E18)).toMatchObject({ title: 'ROUND COMPLETE', amount: '+$2.00', subtitle: 'TIME UP' });
    expect(resultLabel('cashed_out', 2n * E18).title).toBe('ROUND COMPLETE');
    expect(resultLabel('loss', -42n * 10n ** 17n)).toMatchObject({ title: 'ROUND COMPLETE', amount: '−$4.20' });
    expect(resultLabel('voided', 0n).title).toBe('ROUND VOIDED');
  });
});
