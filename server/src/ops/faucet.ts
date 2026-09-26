// Faucet drips through TestUSDFaucet with the ops key. Policy (cooldown, IP caps) lives in A4;
// this only builds and sends the transaction and reports `settlement.step` (kind faucet).

import { encodeFunctionData, type Address } from 'viem';
import { faucetAbi } from '../recorder/abi.ts';
import type { ChainTxSender, SenderHandle } from '../relayer/sender.ts';

export class FaucetDripper {
  private readonly faucet: Address;
  private readonly sender: ChainTxSender;
  private readonly amountUsd: number;

  constructor(
    faucet: Address,
    sender: ChainTxSender,
    amountUsd: number,
  ) {
    this.faucet = faucet;
    this.sender = sender;
    this.amountUsd = amountUsd;
    if (sender.key !== 'ops') throw new Error('faucet drips must use the ops key');
  }

  /** Default amount = FAUCET_AMOUNT_USD tUSD (18 decimals). */
  drip(player: Address, opts: { intentId?: string; amountWei?: bigint } = {}): SenderHandle {
    const amount = opts.amountWei ?? BigInt(Math.round(this.amountUsd * 100)) * 10n ** 16n;
    return this.sender.enqueue({
      key: 'ops',
      kind: 'faucet',
      to: this.faucet,
      data: encodeFunctionData({ abi: faucetAbi, functionName: 'drip', args: [player, amount] }),
      intentId: opts.intentId,
      priority: 50,
      playerSteps: { kind: 'faucet', intentId: opts.intentId, targets: [{ player }] },
    });
  }
}
