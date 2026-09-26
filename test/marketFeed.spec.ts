import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { marketFeed } from '../src/services/marketFeed';
import { SUPPORTED_ASSETS } from '../src/types/market';

describe('MarketFeedService — Streaming and History (PRD §5, §17)', () => {
  beforeEach(() => {
    marketFeed.setAsset('BNB', false); // sandbox/mock mode for test deterministic execution
  });

  afterEach(() => {
    marketFeed.cleanup();
  });

  it('initializes with seed history points for continuous track rendering', () => {
    const history = marketFeed.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(30);
    expect(marketFeed.getCurrentPrice()).toBeGreaterThan(0);
  });

  it('updates current asset and recalibrates base prices', () => {
    marketFeed.setAsset('BTC', false);
    expect(marketFeed.getCurrentAsset()).toBe('BTC');
    expect(marketFeed.getCurrentPrice()).toBeCloseTo(SUPPORTED_ASSETS['BTC'].basePrice, -3);
  });

  it('subscribes to tick updates correctly', async () => {
    let tickReceived = false;
    const unsub = marketFeed.subscribe((tick) => {
      if (tick && tick.price > 0) {
        tickReceived = true;
      }
    });

    expect(tickReceived).toBe(true);
    unsub();
  });
});
