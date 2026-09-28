import { describe, expect, it } from 'vitest';
import type { AssetSymbol } from '../../types/market';
import { shareText, shareTweetUrl } from './roundDisplay';

const base = { asset: 'BNB' as AssetSymbol, pnl: 4.2, outcome: 'win' as const, voided: false };

describe('shareText', () => {
  it('describes a target hit calmly, with the P&L and asset', () => {
    expect(shareText(base)).toBe(
      'Target hit on BNB — +4.20 USDT, settled on-chain. Playing Tagei, a market game settled on BNB Chain.'
    );
  });

  it('describes a cashed-out round', () => {
    expect(shareText({ ...base, outcome: 'cashed_out', pnl: 2.5 })).toContain('Cashed out +2.50 USDT on BNB');
  });

  it('describes a loss as "round complete", never "lost"', () => {
    const text = shareText({ ...base, outcome: 'loss', pnl: -3.1 });
    expect(text).toContain('Round complete on BNB, −3.10 USDT');
    expect(text.toLowerCase()).not.toContain('lost');
  });

  it('describes a timeout the same way as a loss', () => {
    expect(shareText({ ...base, outcome: 'timeout', pnl: -1 })).toContain('Round complete on BNB');
  });

  it('describes a voided round as a stake return, not an outcome', () => {
    const text = shareText({ ...base, voided: true, pnl: 0 });
    expect(text).toContain('Round voided on BNB — stake returned, settled on-chain.');
  });

  it('never uses an exclamation point or hype language', () => {
    for (const outcome of ['win', 'cashed_out', 'loss', 'timeout'] as const) {
      expect(shareText({ ...base, outcome })).not.toContain('!');
    }
  });
});

describe('shareTweetUrl', () => {
  it('builds a twitter intent URL with the app link and encoded text', () => {
    const url = shareTweetUrl(base);
    expect(url.startsWith('https://twitter.com/intent/tweet?')).toBe(true);
    expect(url).toContain('url=https%3A%2F%2Fbnb-play.vercel.app');
    expect(url).toContain('Target+hit+on+BNB');
  });
});
