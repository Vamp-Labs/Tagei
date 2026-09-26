// Faucet drips through TestUSDFaucet with the ops key. Policy (cooldown, IP caps) lives in A4;
// this only builds and sends the transaction and reports `settlement.step` (kind faucet).

import { encodeFunctionData, type Address } from 'viem';
import { faucetAbi } from '../recorder/abi.ts';
import type { ChainTxSender, SenderHandle } from '../relayer/sender.ts';

export class FaucetDripper {
  private readonly faucet: Address;
  private readonly sender: ChainTxSender;

  constructor(
    faucet: Address,
    sender: ChainTxSender,
    amountUsd: number,
  ) {
    this.faucet = faucet;
    this.sender = sender;
    void amountUsd; // amount is set on-chain (TestUSDFaucet.dripAmount)
    if (sender.key !== 'ops') throw new Error('faucet drips must use the ops key');
  }

  /** The drip amount is the faucet's on-chain `dripAmount` (100 tUSD by default). */
  drip(player: Address, opts: { intentId?: string } = {}): SenderHandle {
    return this.sender.enqueue({
      key: 'ops',
      kind: 'faucet',
      to: this.faucet,
      data: encodeFunctionData({ abi: faucetAbi, functionName: 'drip', args: [player] }),
      intentId: opts.intentId,
      priority: 50,
      playerSteps: { kind: 'faucet', intentId: opts.intentId, targets: [{ player }] },
    });
  }
}
