// Canonical asset registry. `assetId` is the on-chain Arena id; `supraPairId`
// is the Supra DORA-2 pair index (all pairs are quoted in USDT).

export type AssetSymbol = 'BNB' | 'BTC' | 'ETH' | 'SOL' | 'DOGE';

export interface AssetDef {
  assetId: number;
  symbol: AssetSymbol;
  name: string;
  supraPairId: number;
  quote: 'USDT';
  displayDecimals: number;
  color: string;
  binanceSymbol: string;
}

export const ASSETS: readonly AssetDef[] = [
  { assetId: 0, symbol: 'BNB', name: 'BNB', supraPairId: 49, quote: 'USDT', displayDecimals: 2, color: '#F0B90B', binanceSymbol: 'BNBUSDT' },
  { assetId: 1, symbol: 'BTC', name: 'Bitcoin', supraPairId: 0, quote: 'USDT', displayDecimals: 2, color: '#F7931A', binanceSymbol: 'BTCUSDT' },
  { assetId: 2, symbol: 'ETH', name: 'Ethereum', supraPairId: 1, quote: 'USDT', displayDecimals: 2, color: '#627EEA', binanceSymbol: 'ETHUSDT' },
  { assetId: 3, symbol: 'SOL', name: 'Solana', supraPairId: 10, quote: 'USDT', displayDecimals: 2, color: '#14F195', binanceSymbol: 'SOLUSDT' },
  { assetId: 4, symbol: 'DOGE', name: 'Dogecoin', supraPairId: 3, quote: 'USDT', displayDecimals: 4, color: '#C2A633', binanceSymbol: 'DOGEUSDT' },
];

/** Pair order used in every 5-pair `/get_proof` request. */
export const SUPRA_PAIR_IDS = [0, 1, 3, 10, 49] as const;

export function assetBySymbol(symbol: AssetSymbol): AssetDef {
  const a = ASSETS.find((x) => x.symbol === symbol);
  if (!a) throw new Error(`unknown asset ${symbol}`);
  return a;
}

export function assetById(assetId: number): AssetDef {
  const a = ASSETS.find((x) => x.assetId === assetId);
  if (!a) throw new Error(`unknown assetId ${assetId}`);
  return a;
}

export function assetByPair(pairId: number): AssetDef {
  const a = ASSETS.find((x) => x.supraPairId === pairId);
  if (!a) throw new Error(`unknown Supra pair ${pairId}`);
  return a;
}
