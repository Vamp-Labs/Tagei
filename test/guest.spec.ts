import { describe, expect, it } from 'vitest';
import { custom, getAddress, getTypesForEIP712Domain, recoverTypedDataAddress, serializeTypedData, verifyMessage, verifyTypedData, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createConfig, createStorage } from 'wagmi';
import { connect, disconnect, getAccount, reconnect, signTypedData } from 'wagmi/actions';
import { arenaDomain, arenaTypes, apiDomain, loginTypes, type OpenRoundMessage } from '@bnbplay/shared/eip712';
import { createMemoryStorage } from '../src/api/storage';
import { bnbPlayChain } from '../src/web3/config';
import {
  GUEST_STORAGE_KEY,
  PROVIDER_ERROR,
  createGuestProvider,
  ensureGuestAccount,
  exportGuestKey,
  forgetGuestKey,
  guest,
  hasGuestKey,
  importGuestKey,
  loadGuestAccount,
} from '../src/web3/guest';
import { createAccountSigner, createWagmiSigner } from '../src/web3/signing';

const ARENA: Address = getAddress('0x00000000000000000000000000000000000a4e7a');
const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const openRound = (player: Address): OpenRoundMessage => ({
  player,
  assetId: 0,
  tier: 1,
  direction: 1,
  stake: 10n * 10n ** 18n,
  laneVersion: 3,
  oracleIdx: 0,
  nonce: 5n,
  deadline: 1_790_000_005,
});

describe('guest key storage', () => {
  it('creates one burner key under bnbplay.guest.v1 and reloads it', () => {
    const storage = createMemoryStorage();
    expect(hasGuestKey(storage)).toBe(false);
    const account = ensureGuestAccount(storage, () => 42);
    const stored = JSON.parse(storage.getItem(GUEST_STORAGE_KEY) ?? '{}');
    expect(stored).toMatchObject({ v: 1, createdAtMs: 42 });
    expect(ensureGuestAccount(storage).address).toBe(account.address);
    expect(loadGuestAccount(storage)?.address).toBe(account.address);
  });

  it('exports, imports and forgets the key', () => {
    const storage = createMemoryStorage();
    const imported = importGuestKey(PRIVATE_KEY, storage);
    expect(exportGuestKey(storage)).toEqual({ address: imported.address, privateKey: PRIVATE_KEY });
    forgetGuestKey(storage);
    expect(exportGuestKey(storage)).toBeNull();
    expect(() => importGuestKey('0x1234', storage)).toThrow();
  });

  it('ignores a corrupted record instead of crashing', () => {
    const storage = createMemoryStorage({ [GUEST_STORAGE_KEY]: '{"v":1,"privateKey":"nope"}' });
    expect(loadGuestAccount(storage)).toBeNull();
  });
});

describe('guest EIP-1193 provider', () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const provider = createGuestProvider({ getAccount: () => account });

  it('answers chain and account queries for BSC testnet', async () => {
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x61');
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([account.address]);
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([account.address]);
  });

  it('signs eth_signTypedData_v4 exactly like a direct account signature', async () => {
    const typedData = { domain: arenaDomain(97, ARENA), types: arenaTypes, primaryType: 'OpenRound' as const, message: openRound(account.address) };
    const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [account.address, serializeTypedData({ ...typedData, types: { EIP712Domain: getTypesForEIP712Domain({ domain: typedData.domain }), ...typedData.types } })] });
    expect(signature).toBe(await account.signTypedData(typedData));
    expect(await verifyTypedData({ address: account.address, ...typedData, signature: signature as `0x${string}` })).toBe(true);
  });

  it('signs personal_sign locally', async () => {
    const signature = await provider.request({ method: 'personal_sign', params: ['0x68656c6c6f', account.address] });
    expect(await verifyMessage({ address: account.address, message: 'hello', signature: signature as `0x${string}` })).toBe(true);
  });

  it('rejects transactions (gasless) and foreign signers', async () => {
    await expect(provider.request({ method: 'eth_sendTransaction', params: [{ from: account.address }] })).rejects.toMatchObject({
      code: PROVIDER_ERROR.unsupportedMethod,
    });
    await expect(provider.request({ method: 'eth_sign', params: [account.address, '0x00'] })).rejects.toMatchObject({
      code: PROVIDER_ERROR.unsupportedMethod,
    });
    await expect(
      provider.request({ method: 'personal_sign', params: ['0x00', '0x0000000000000000000000000000000000000001'] }),
    ).rejects.toMatchObject({ code: PROVIDER_ERROR.unauthorized });
    await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] })).rejects.toMatchObject({
      code: PROVIDER_ERROR.chainNotAdded,
    });
  });

  it('forwards reads to the RPC and refuses them offline', async () => {
    const forwarded = createGuestProvider({ getAccount: () => account, forward: async ({ method }) => `forwarded:${method}` });
    expect(await forwarded.request({ method: 'eth_blockNumber' })).toBe('forwarded:eth_blockNumber');
    await expect(provider.request({ method: 'eth_blockNumber' })).rejects.toMatchObject({ code: PROVIDER_ERROR.unsupportedMethod });
  });
});

describe('guest wagmi connector', () => {
  const setup = () => {
    const storage = createMemoryStorage();
    const chain = bnbPlayChain(['https://rpc.invalid']);
    const config = createConfig({
      chains: [chain],
      connectors: [guest({ storage })],
      transports: { [chain.id]: custom({ request: async () => Promise.reject(new Error('offline')) }) },
      storage: createStorage({ storage }),
    });
    return { storage, config };
  };

  it('connects without prompts and signs arena intents silently', async () => {
    const { storage, config } = setup();
    const result = await connect(config, { connector: config.connectors[0] });
    const address = result.accounts[0];
    expect(result.chainId).toBe(97);
    expect(loadGuestAccount(storage)?.address).toBe(address);

    const typedData = { domain: arenaDomain(97, ARENA), types: arenaTypes, primaryType: 'OpenRound' as const, message: openRound(address) };
    const signature = await signTypedData(config, { account: address, ...typedData });
    expect(await recoverTypedDataAddress({ ...typedData, signature })).toBe(address);

    const signer = createWagmiSigner(config, address, 'guest');
    const login = { player: address, salt: `0x${'11'.repeat(32)}` as const, expiresAt: 1_790_000_300 };
    const loginSignature = await signer.signLogin(login, 97);
    expect(await verifyTypedData({ address, domain: apiDomain(97), types: loginTypes, primaryType: 'Login', message: login, signature: loginSignature })).toBe(true);
    const accountSigner = createAccountSigner(privateKeyToAccount(exportGuestKey(storage)?.privateKey ?? PRIVATE_KEY));
    expect(await accountSigner.signLogin(login, 97)).toBe(loginSignature);
  });

  it('reconnects automatically after reload and stays disconnected after an explicit disconnect', async () => {
    const first = setup();
    const { accounts } = await connect(first.config, { connector: first.config.connectors[0] });

    const reloaded = createConfig({
      chains: [bnbPlayChain(['https://rpc.invalid'])],
      connectors: [guest({ storage: first.storage })],
      transports: { 97: custom({ request: async () => Promise.reject(new Error('offline')) }) },
      storage: createStorage({ storage: first.storage }),
    });
    await reconnect(reloaded);
    expect(getAccount(reloaded).address).toBe(accounts[0]);

    await disconnect(reloaded);
    const again = createConfig({
      chains: [bnbPlayChain(['https://rpc.invalid'])],
      connectors: [guest({ storage: first.storage })],
      transports: { 97: custom({ request: async () => Promise.reject(new Error('offline')) }) },
      storage: createStorage({ storage: first.storage }),
    });
    await reconnect(again);
    expect(getAccount(again).status).toBe('disconnected');
    expect(hasGuestKey(first.storage)).toBe(true);
  });
});
