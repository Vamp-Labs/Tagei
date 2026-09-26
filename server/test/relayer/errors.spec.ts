import { describe, expect, it } from 'vitest';
import { BaseError, encodeErrorResult, HttpRequestError, RpcRequestError } from 'viem';
import { arenaErrorsAbi } from '../../src/recorder/abi.ts';
import { apiErrorCode, classifySendError, decodeRevert, describeRevert, extractRevertData } from '../../src/relayer/errors.ts';
import { bumpGasPrice, gasLimitFor, gweiToWei, policyGasPrice } from '../../src/relayer/gas.ts';

const rpcErr = (message: string) => new RpcRequestError({ body: {}, url: 'http://x', error: { code: -32000, message } });

describe('broadcast error classification', () => {
  it.each([
    ['nonce too low: next nonce 5, tx nonce 3', 'nonce_too_low'],
    ['already known', 'already_known'],
    ['replacement transaction underpriced', 'replacement_underpriced'],
    ['transaction underpriced: gas tip cap 1', 'underpriced'],
    ['insufficient funds for gas * price + value', 'insufficient_funds'],
    ['intrinsic gas too low', 'rejected'],
  ])('%s → %s', (msg, kind) => {
    expect(classifySendError(rpcErr(msg))).toBe(kind);
  });

  it('treats transport failures as ambiguous (the tx may have landed)', () => {
    expect(classifySendError(new HttpRequestError({ url: 'http://x', details: 'fetch failed' }))).toBe('ambiguous');
  });
});

describe('revert decoding', () => {
  const data = encodeErrorResult({ abi: arenaErrorsAbi, errorName: 'LaneVersionMismatch', args: [2, 1] });

  it('finds revert data anywhere in a viem error chain and decodes custom errors', () => {
    const inner = Object.assign(new Error('execution reverted'), { data });
    const outer = new BaseError('call failed', { cause: inner });
    expect(extractRevertData(outer)).toBe(data);
    expect(describeRevert(outer)).toMatchObject({ name: 'LaneVersionMismatch', args: [2, 1] });
  });

  it('maps F1b revert names to API codes', () => {
    expect(apiErrorCode('InsufficientBalance')).toBe('INSUFFICIENT_CREDITS');
    expect(apiErrorCode('LaneDisabled')).toBe('TIER_DISABLED');
    expect(apiErrorCode('AssetDisabled')).toBe('TIER_DISABLED');
    expect(apiErrorCode('CashOutTooLate')).toBe('CASHOUT_TOO_LATE');
    expect(apiErrorCode('NotDecidable')).toBe('INTERNAL');
    expect(decodeRevert('0xdeadbeef')?.name).toBe('unknown(0xdeadbeef)');
  });
});

describe('gas policy', () => {
  it('applies floor, premium and cap', () => {
    const floor = gweiToWei(0.1);
    const max = gweiToWei(3);
    expect(policyGasPrice(gweiToWei(0.05), floor, max, 2)).toBe(gweiToWei(0.2));
    expect(policyGasPrice(gweiToWei(1), floor, max, 1)).toBe(gweiToWei(1));
    expect(policyGasPrice(gweiToWei(2), floor, max, 2)).toBe(max);
    expect(bumpGasPrice(gweiToWei(0.2), floor, max)).toBeGreaterThanOrEqual((gweiToWei(0.2) * 11n) / 10n);
    expect(bumpGasPrice(max, floor, max)).toBe(max);
    expect(gasLimitFor(100_000n)).toBe(125_000n);
    expect(gasLimitFor(100_000n, 900_000n)).toBe(900_000n);
  });
});
