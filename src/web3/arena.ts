import type { Address } from 'viem';
import type { Config } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { CHAIN_ID, NONCE_KEY } from '@bnbplay/shared/constants';
import { arenaAbi } from '@bnbplay/shared/abi';

export const arenaReadAbi = arenaAbi;

export type NonceReader = (player: Address, arena: Address, key: bigint) => Promise<bigint>;

export const createNonceReader =
  (config: Config): NonceReader =>
  (player, arena, key) =>
    readContract(config, { chainId: CHAIN_ID, address: arena, abi: arenaReadAbi, functionName: 'nonces', args: [player, key] });

export const OPEN_NONCE_KEY = NONCE_KEY.open;
export const WITHDRAW_NONCE_KEY = NONCE_KEY.withdraw;
