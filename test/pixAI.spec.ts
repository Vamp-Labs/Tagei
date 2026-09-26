import { describe, it, expect } from 'vitest';
import { PixAIService } from '../src/services/pixAI';
import { TradeResult } from '../src/types/game';

describe('PixAIService — Contextual Commentary (PRD §11, §28)', () => {
  it('generates bullish insight when 24h change is positive', () => {
    const insight = PixAIService.getPreTradeInsight('BNB', 2.14);
    expect(insight.sentiment).toBe('bullish');
    expect(insight.headline).toContain('Momentum');
    expect(insight.factors.length).toBeGreaterThanOrEqual(3);
    // Never makes guaranteed win promises
    expect(insight.summary).not.toMatch(/guarantee|definite|100%/i);
  });

  it('generates bearish insight when 24h change is negative', () => {
    const insight = PixAIService.getPreTradeInsight('BTC', -1.85);
    expect(insight.sentiment).toBe('bearish');
    expect(insight.summary).not.toMatch(/guarantee|definite|100%/i);
  });

  it('generates accurate coaching debrief for a winning round', () => {
    const mockWin: TradeResult = {
      id: 'round_test_1',
      asset: 'BNB',
      direction: 'LONG',
      stake: 10,
      entryPrice: 610,
      exitPrice: 618,
      pnl: 18.4,
      multiplier: 2.84,
      outcome: 'win',
      timestamp: Date.now(),
      txHash: '0x123',
      xpEarned: 50,
    };

    const debrief = PixAIService.getPostTradeDebrief(mockWin);
    expect(debrief.headline).toContain('Target Achieved');
    expect(debrief.keyFactors.some((k) => k.label.includes('Volume'))).toBe(true);
    expect(debrief.coachingTip).toBeTruthy();
  });

  it('generates constructive non-punitive debrief for a loss round (PRD §22)', () => {
    const mockLoss: TradeResult = {
      id: 'round_test_2',
      asset: 'BNB',
      direction: 'LONG',
      stake: 10,
      entryPrice: 610,
      exitPrice: 604,
      pnl: -4.2,
      multiplier: 0.58,
      outcome: 'loss',
      timestamp: Date.now(),
      txHash: '0x456',
      xpEarned: 25,
    };

    const debrief = PixAIService.getPostTradeDebrief(mockLoss);
    // Never insults or encourages reckless revenge trading
    expect(debrief.headline).not.toMatch(/YOU LOST|YOU FAILED|DOUBLE DOWN/i);
    expect(debrief.coachingTip).not.toMatch(/DOUBLE DOWN|WIN IT BACK/i);
  });
});
