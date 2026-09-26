import type { Address, Hex, LocalAccount } from 'viem';
import type { Config } from 'wagmi';
import { signTypedData } from 'wagmi/actions';
import {
  apiDomain,
  arenaDomain,
  arenaTypes,
  loginTypes,
  type CashOutMessage,
  type LoginMessage,
  type OpenRoundMessage,
  type WithdrawMessage,
} from '@bnbplay/shared/eip712';

export type SignerKind = 'guest' | 'wallet';

export type ArenaDomain = ReturnType<typeof arenaDomain>;

export interface IntentSigner {
  readonly address: Address;
  readonly kind: SignerKind;
  signLogin(message: LoginMessage, chainId: number): Promise<Hex>;
  signOpenRound(message: OpenRoundMessage, domain: ArenaDomain): Promise<Hex>;
  signCashOut(message: CashOutMessage, domain: ArenaDomain): Promise<Hex>;
  signWithdraw(message: WithdrawMessage, domain: ArenaDomain): Promise<Hex>;
}

export function createAccountSigner(account: LocalAccount, kind: SignerKind = 'guest'): IntentSigner {
  return {
    address: account.address,
    kind,
    signLogin: (message, chainId) => account.signTypedData({ domain: apiDomain(chainId), types: loginTypes, primaryType: 'Login', message }),
    signOpenRound: (message, domain) => account.signTypedData({ domain, types: arenaTypes, primaryType: 'OpenRound', message }),
    signCashOut: (message, domain) => account.signTypedData({ domain, types: arenaTypes, primaryType: 'CashOut', message }),
    signWithdraw: (message, domain) => account.signTypedData({ domain, types: arenaTypes, primaryType: 'Withdraw', message }),
  };
}

export function createWagmiSigner(config: Config, address: Address, kind: SignerKind): IntentSigner {
  return {
    address,
    kind,
    signLogin: (message, chainId) =>
      signTypedData(config, { account: address, domain: apiDomain(chainId), types: loginTypes, primaryType: 'Login', message }),
    signOpenRound: (message, domain) => signTypedData(config, { account: address, domain, types: arenaTypes, primaryType: 'OpenRound', message }),
    signCashOut: (message, domain) => signTypedData(config, { account: address, domain, types: arenaTypes, primaryType: 'CashOut', message }),
    signWithdraw: (message, domain) => signTypedData(config, { account: address, domain, types: arenaTypes, primaryType: 'Withdraw', message }),
  };
}
