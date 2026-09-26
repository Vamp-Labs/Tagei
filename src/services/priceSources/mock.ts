import type { PriceTick } from '../../types/market';

export const MOCK_TICK_MS = 250;
export const MOCK_SEED_POINTS = 41;
export const MOCK_SEED_SPACING_MS = 400;

export function seedMockHistory(
  startPrice: number,
  volatility: number,
  basePrice24h: number,
  now: number = Date.now(),
  random: () => number = Math.random,
): { history: PriceTick[]; price: number } {
  const history: PriceTick[] = [];
  let p = startPrice;
  for (let i = MOCK_SEED_POINTS - 1; i >= 0; i--) {
    const delta = (random() - 0.49) * (p * volatility * 0.5);
    p = Math.max(1, p + delta);
    history.push({
      price: p,
      timestamp: now - i * MOCK_SEED_SPACING_MS,
      change24h: ((p - basePrice24h) / basePrice24h) * 100,
    });
  }
  return { history, price: p };
}

export class MockRandomWalk {
  private momentum: number;
  private readonly volatility: number;
  private readonly random: () => number;

  constructor(volatility: number, random: () => number = Math.random) {
    this.volatility = volatility;
    this.random = random;
    this.momentum = (random() - 0.48) * 0.001;
  }

  next(currentPrice: number): number {
    this.momentum = this.momentum * 0.94 + (this.random() - 0.495) * (this.volatility * 0.6);
    const delta = currentPrice * this.momentum;
    return Math.max(0.0001, currentPrice + delta);
  }
}
