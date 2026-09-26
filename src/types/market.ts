export type AssetSymbol = 'BNB' | 'BTC' | 'ETH' | 'SOL' | 'DOGE';

export interface AssetInfo {
  symbol: AssetSymbol;
  name: string;
  decimals: number;
  basePrice: number;
  volatility: number; // percentage standard deviation per step
  color: string;
  binancePair: string;
}

export const SUPPORTED_ASSETS: Record<AssetSymbol, AssetInfo> = {
  BNB: {
    symbol: 'BNB',
    name: 'BNB Chain',
    decimals: 2,
    basePrice: 612.34,
    volatility: 0.0018,
    color: '#F0B90B',
    binancePair: 'bnbusdt',
  },
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    decimals: 2,
    basePrice: 95400.0,
    volatility: 0.0015,
    color: '#F7931A',
    binancePair: 'btcusdt',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 2,
    basePrice: 2850.5,
    volatility: 0.0022,
    color: '#627EEA',
    binancePair: 'ethusdt',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    decimals: 2,
    basePrice: 182.2,
    volatility: 0.0032,
    color: '#14F195',
    binancePair: 'solusdt',
  },
  DOGE: {
    symbol: 'DOGE',
    name: 'Dogecoin',
    decimals: 4,
    basePrice: 0.245,
    volatility: 0.0045,
    color: '#C2A633',
    binancePair: 'dogeusdt',
  },
};

export interface PriceTick {
  price: number;
  timestamp: number;
  change24h: number; // e.g. +2.14%
  volume24h?: number;
}

export interface MarketTrackPoint {
  price: number;
  timestamp: number;
  smoothedPrice?: number;
}

export interface MarketInsight {
  headline: string;
  summary: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  factors: {
    label: string;
    value: string;
    positive?: boolean;
  }[];
  learningTip: string;
}
