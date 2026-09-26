import type { Address } from 'viem';
import type { Config } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { CHAIN_ID, NONCE_KEY } from '@bnbplay/shared/constants';

export const arenaReadAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'activeRoundOf',
    stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type NonceReader = (player: Address, arena: Address, key: bigint) => Promise<bigint>;

export const createNonceReader =
  (config: Config): NonceReader =>
  (player, arena, key) =>
    readContract(config, { chainId: CHAIN_ID, address: arena, abi: arenaReadAbi, functionName: 'nonces', args: [player, key] });

export const OPEN_NONCE_KEY = NONCE_KEY.open;
export const WITHDRAW_NONCE_KEY = NONCE_KEY.withdraw;
