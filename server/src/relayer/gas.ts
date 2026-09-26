// Legacy gas policy (A3 handoff): price = min(max(rpc, floor) × premium, max);
// limit = estimateGas × 1.25 (or a caller floor for multi-round settles); RBF bumps ≥ 12.5 %.

export const gweiToWei = (gwei: number): bigint => BigInt(Math.round(gwei * 1e9));

export function policyGasPrice(rpcGasPriceWei: bigint, floorWei: bigint, maxWei: bigint, premium: number): bigint {
  const base = rpcGasPriceWei > floorWei ? rpcGasPriceWei : floorWei;
  const scaled = (base * BigInt(Math.round(premium * 10_000))) / 10_000n;
  return scaled > maxWei ? maxWei : scaled;
}

/** Replacement price: at least +12.5 % over the previous attempt (geth needs +10 %), never above max. */
export function bumpGasPrice(previousWei: bigint, policyWei: bigint, maxWei: bigint): bigint {
  const bumped = (previousWei * 1125n) / 1000n + 1n;
  const next = bumped > policyWei ? bumped : policyWei;
  return next > maxWei ? maxWei : next;
}

export function gasLimitFor(estimate: bigint, floor?: bigint): bigint {
  const padded = (estimate * 125n) / 100n;
  return floor !== undefined && floor > padded ? floor : padded;
}
