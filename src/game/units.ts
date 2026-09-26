import { formatUnits } from 'viem';
import { PRICE_DECIMALS, STAKE_DECIMALS } from '@bnbplay/shared/constants';

const PRICE_FRACTION_DIGITS = 9;
const STAKE_FRACTION_DIGITS = 6;
const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS - PRICE_FRACTION_DIGITS);
const STAKE_SCALE = 10n ** BigInt(STAKE_DECIMALS - STAKE_FRACTION_DIGITS);

export function toPrice18(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) throw new RangeError(`price must be a positive finite number, got ${price}`);
  return BigInt(Math.round(price * 10 ** PRICE_FRACTION_DIGITS)) * PRICE_SCALE;
}

export const fromPrice18 = (price18: bigint | string): number => Number(formatUnits(BigInt(price18), PRICE_DECIMALS));

export function usdToStake18(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`stake must be a non-negative finite number, got ${usd}`);
  return BigInt(Math.round(usd * 10 ** STAKE_FRACTION_DIGITS)) * STAKE_SCALE;
}

export const stake18ToUsd = (amount: bigint | string): number => Number(formatUnits(BigInt(amount), STAKE_DECIMALS));

export const roundCents = (usd: number): number => Math.round(usd * 100) / 100;

export function payoutMultiple(payout: bigint, stake: bigint): number {
  if (stake <= 0n) return 0;
  return Number((payout * 10_000n) / stake) / 10_000;
}
