import { z } from 'zod';
import {
  getAddress,
  isAddressEqual,
  isHex,
  numberToHex,
  type Address,
  type EIP1193RequestFn,
  type Hex,
  type LocalAccount,
  type TypedDataDefinition,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createConnector } from 'wagmi';
import { CHAIN_ID } from '@bnbplay/shared/constants';
import { browserStorage, readJson, writeJson, type KeyValueStorage } from '../api/storage';

export const GUEST_STORAGE_KEY = 'bnbplay.guest.v1';
export const GUEST_DISCONNECTED_KEY = 'bnbplay.guest.disconnected';
export const GUEST_CONNECTOR_ID = 'guest';

const PrivateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'private key');

const StoredGuestSchema = z.object({
  v: z.literal(1),
  privateKey: PrivateKeySchema,
  createdAtMs: z.number(),
});
export type StoredGuest = z.infer<typeof StoredGuestSchema>;

export const PROVIDER_ERROR = {
  userRejected: 4001,
  unauthorized: 4100,
  unsupportedMethod: 4200,
  disconnected: 4900,
  chainNotAdded: 4902,
  invalidParams: -32602,
} as const;

export class GuestProviderError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'GuestProviderError';
    this.code = code;
  }
}

function toPrivateKey(value: string): Hex {
  if (!isHex(value) || !PrivateKeySchema.safeParse(value).success) throw new Error('invalid guest private key');
  return value;
}

export function loadGuest(storage: KeyValueStorage = browserStorage()): StoredGuest | null {
  return readJson(storage, GUEST_STORAGE_KEY, StoredGuestSchema);
}

export function hasGuestKey(storage: KeyValueStorage = browserStorage()): boolean {
  return loadGuest(storage) !== null;
}

export function loadGuestAccount(storage: KeyValueStorage = browserStorage()): LocalAccount | null {
  const stored = loadGuest(storage);
  return stored ? privateKeyToAccount(toPrivateKey(stored.privateKey)) : null;
}

export function ensureGuestAccount(storage: KeyValueStorage = browserStorage(), now: () => number = Date.now): LocalAccount {
  const existing = loadGuestAccount(storage);
  if (existing) return existing;
  const privateKey = generatePrivateKey();
  const stored: StoredGuest = { v: 1, privateKey, createdAtMs: now() };
  if (!writeJson(storage, GUEST_STORAGE_KEY, stored)) throw new Error('could not persist the guest key');
  return privateKeyToAccount(privateKey);
}

export function importGuestKey(privateKey: string, storage: KeyValueStorage = browserStorage(), now: () => number = Date.now): LocalAccount {
  const key = toPrivateKey(privateKey.trim());
  writeJson(storage, GUEST_STORAGE_KEY, { v: 1, privateKey: key, createdAtMs: now() } satisfies StoredGuest);
  return privateKeyToAccount(key);
}

export function exportGuestKey(storage: KeyValueStorage = browserStorage()): { address: Address; privateKey: Hex } | null {
  const stored = loadGuest(storage);
  if (!stored) return null;
  const privateKey = toPrivateKey(stored.privateKey);
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

export function forgetGuestKey(storage: KeyValueStorage = browserStorage()): void {
  storage.removeItem(GUEST_STORAGE_KEY);
  storage.removeItem(GUEST_DISCONNECTED_KEY);
}

const TypedDataPayloadSchema = z.object({
  domain: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
      chainId: z.union([z.number(), z.string()]).optional(),
      verifyingContract: z.string().optional(),
      salt: z.string().optional(),
    })
    .default({}),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  message: z.record(z.string(), z.unknown()),
});

function parseChainId(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  return value.startsWith('0x') ? Number.parseInt(value, 16) : Number(value);
}

export function parseTypedDataJson(json: string): TypedDataDefinition<Record<string, unknown>, string> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new GuestProviderError(PROVIDER_ERROR.invalidParams, 'typed data is not valid JSON');
  }
  const parsed = TypedDataPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new GuestProviderError(PROVIDER_ERROR.invalidParams, 'typed data is malformed');
  const { EIP712Domain: _domainType, ...types } = parsed.data.types;
  const { chainId, verifyingContract, salt, ...rest } = parsed.data.domain;
  const verifying = verifyingContract ? getAddress(verifyingContract) : undefined;
  const domainSalt = salt && isHex(salt) ? salt : undefined;
  return {
    domain: { ...rest, chainId: parseChainId(chainId), verifyingContract: verifying, salt: domainSalt },
    types,
    primaryType: parsed.data.primaryType,
    message: parsed.data.message,
  };
}

export interface GuestProvider {
  request: EIP1193RequestFn;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface GuestProviderOptions {
  getAccount: () => LocalAccount | null;
  forward?: EIP1193RequestFn;
  chainId?: number;
}

const GASLESS_METHODS = new Set([
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sendRawTransaction',
  'wallet_sendCalls',
  'wallet_sendTransaction',
  'eth_sign',
]);

function paramsArray(params: unknown): unknown[] {
  return Array.isArray(params) ? params : [];
}

export function createGuestProvider({ getAccount, forward, chainId = CHAIN_ID }: GuestProviderOptions): GuestProvider {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const requireAccount = (): LocalAccount => {
    const account = getAccount();
    if (!account) throw new GuestProviderError(PROVIDER_ERROR.unauthorized, 'guest account is not connected');
    return account;
  };

  const assertSigner = (account: LocalAccount, value: unknown) => {
    if (typeof value !== 'string' || !isHex(value) || value.length !== 42 || !isAddressEqual(value, account.address)) {
      throw new GuestProviderError(PROVIDER_ERROR.unauthorized, 'requested signer is not the guest account');
    }
  };

  const handle = async (method: string, params: unknown): Promise<unknown> => {
    if (GASLESS_METHODS.has(method)) {
      throw new GuestProviderError(PROVIDER_ERROR.unsupportedMethod, `${method} is not supported: BNB PLAY guests are gasless`);
    }
    switch (method) {
      case 'eth_chainId':
        return numberToHex(chainId);
      case 'net_version':
        return String(chainId);
      case 'eth_accounts': {
        const account = getAccount();
        return account ? [account.address] : [];
      }
      case 'eth_requestAccounts':
        return [requireAccount().address];
      case 'eth_signTypedData_v4': {
        const account = requireAccount();
        const [address, payload] = paramsArray(params);
        assertSigner(account, address);
        if (typeof payload !== 'string') throw new GuestProviderError(PROVIDER_ERROR.invalidParams, 'typed data must be a JSON string');
        return account.signTypedData(parseTypedDataJson(payload));
      }
      case 'personal_sign': {
        const account = requireAccount();
        const [data, address] = paramsArray(params);
        assertSigner(account, address);
        if (typeof data !== 'string') throw new GuestProviderError(PROVIDER_ERROR.invalidParams, 'message must be a string');
        return account.signMessage({ message: isHex(data) ? { raw: data } : data });
      }
      case 'wallet_switchEthereumChain': {
        const [request] = paramsArray(params);
        const target = typeof request === 'object' && request !== null && 'chainId' in request ? request.chainId : undefined;
        const targetId = typeof target === 'string' || typeof target === 'number' ? parseChainId(target) : undefined;
        if (targetId !== chainId) throw new GuestProviderError(PROVIDER_ERROR.chainNotAdded, `guest accounts only support chain ${chainId}`);
        return null;
      }
      case 'wallet_addEthereumChain':
        return null;
      case 'wallet_requestPermissions':
      case 'wallet_getPermissions':
        return [{ parentCapability: 'eth_accounts' }];
      case 'wallet_revokePermissions':
        return null;
      default:
        if (!forward) throw new GuestProviderError(PROVIDER_ERROR.unsupportedMethod, `${method} is not available offline`);
        return forward({ method, params } as Parameters<EIP1193RequestFn>[0]);
    }
  };

  const request = ((args: { method: string; params?: unknown }) => handle(args.method, args.params)) as EIP1193RequestFn;

  return {
    request,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };
}

export interface GuestConnectorParameters {
  storage?: KeyValueStorage;
  forward?: EIP1193RequestFn;
  now?: () => number;
}

guest.type = 'guest' as const;

export function guest(parameters: GuestConnectorParameters = {}) {
  const storage = () => parameters.storage ?? browserStorage();
  let account: LocalAccount | null = null;
  let provider: GuestProvider | null = null;

  const currentAccount = (): LocalAccount | null => {
    if (!account) account = loadGuestAccount(storage());
    return account;
  };

  return createConnector<GuestProvider>((config) => ({
    id: GUEST_CONNECTOR_ID,
    name: 'Play as Guest',
    type: guest.type,
    async connect({ withCapabilities } = {}) {
      account = ensureGuestAccount(storage(), parameters.now);
      storage().removeItem(GUEST_DISCONNECTED_KEY);
      const chainId = config.chains[0].id;
      const addresses: readonly Address[] = [account.address];
      const accounts = withCapabilities ? addresses.map((address) => ({ address, capabilities: {} })) : addresses;
      return { accounts: accounts as never, chainId };
    },
    async disconnect() {
      storage().setItem(GUEST_DISCONNECTED_KEY, '1');
      account = null;
    },
    async getAccounts() {
      const current = currentAccount();
      return current ? [current.address] : [];
    },
    async getChainId() {
      return config.chains[0].id;
    },
    async getProvider() {
      provider ??= createGuestProvider({ getAccount: currentAccount, forward: parameters.forward, chainId: config.chains[0].id });
      return provider;
    },
    async isAuthorized() {
      return storage().getItem(GUEST_DISCONNECTED_KEY) === null && currentAccount() !== null;
    },
    onAccountsChanged(accounts) {
      if (accounts.length === 0) this.onDisconnect();
      else config.emitter.emit('change', { accounts: accounts.map((value) => getAddress(value)) });
    },
    onChainChanged(chain) {
      config.emitter.emit('change', { chainId: Number(chain) });
    },
    onDisconnect() {
      account = null;
      config.emitter.emit('disconnect');
    },
  }));
}
