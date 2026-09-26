import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { createMarket, decimalToPrice18 } from '../../src/market/index.ts';

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/api/v3/ticker/24hr') {
    const symbols = JSON.parse(url.searchParams.get('symbols') ?? '[]') as string[];
    res.end(JSON.stringify(symbols.map((s) => ({ symbol: s, lastPrice: '612.50000000', openPrice: '600.00000000', highPrice: '620.1', lowPrice: '598', priceChangePercent: '2.083', volume: '1000', quoteVolume: '612000', closeTime: 1 }))));
    return;
  }
  if (url.pathname === '/api/v3/klines') {
    res.end(JSON.stringify(Array.from({ length: 120 }, (_, i) => [i * 60_000, '1', '2', '0.5', '1.5', '10', i * 60_000 + 59_999, String(i < 60 ? 100 : 150), 7])));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('market (Binance data-api)', () => {
  it('parses decimals into 18-decimal integers', () => {
    expect(decimalToPrice18('612.34000000')).toBe(612_340_000_000_000_000_000n);
    expect(decimalToPrice18('0.24512345678901234567')).toBe(245_123_456_789_012_345n);
  });

  it('serves 24 h change, day stats, klines and volume features', async () => {
    const m = createMarket({ baseUrl: base });
    await m.start();
    expect(m.change24hPct('BNB')).toBeCloseTo(2.083);
    expect(m.dayStats('ETH')).toEqual({ open24h: '600000000000000000000', change24hPct: 2.083, high24h: '620100000000000000000', low24h: '598000000000000000000' });
    expect(m.klines('SOL', 5)).toHaveLength(5);
    expect(m.volumeFeatures('DOGE')).toMatchObject({ quoteVolume1h: 9000, quoteVolumePrev1h: 6000, volumeChangePct: 50, trades1h: 420 });
    await m.stop();
  });
});
