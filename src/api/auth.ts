import { z } from 'zod';
import { getAddress, isAddressEqual, isHex, type Address } from 'viem';
import { CHAIN_ID } from '@bnbplay/shared/constants';
import type { IntentSigner, SignerKind } from '../web3/signing';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { readJson, writeJson, type KeyValueStorage } from './storage';

export const SESSION_STORAGE_KEY = 'bnbplay.session.v1';

const StoredSessionSchema = z.object({
  token: z.string(),
  player: z.string(),
  kind: z.enum(['guest', 'wallet']),
  expiresAtMs: z.number(),
});
export type StoredSession = z.infer<typeof StoredSessionSchema>;

const REFRESH_MARGIN_MS = 60_000;
const MS_THRESHOLD = 10_000_000_000;

export const toExpiryMs = (expiresAt: number): number => (expiresAt > MS_THRESHOLD ? expiresAt : expiresAt * 1000);

export type AuthApi = Pick<ApiClient, 'authChallenge' | 'authSession'>;

export interface AuthSessionOptions {
  api: AuthApi;
  storage: KeyValueStorage;
  now?: () => number;
}

export class AuthSession {
  private readonly api: AuthApi;
  private readonly storage: KeyValueStorage;
  private readonly now: () => number;
  private session: StoredSession | null;
  private pending: { player: string; promise: Promise<string> } | null = null;
  private readonly listeners = new Set<(session: StoredSession | null) => void>();

  constructor(options: AuthSessionOptions) {
    this.api = options.api;
    this.storage = options.storage;
    this.now = options.now ?? (() => Date.now());
    this.session = readJson(this.storage, SESSION_STORAGE_KEY, StoredSessionSchema);
  }

  current(): StoredSession | null {
    return this.session && this.isFresh(this.session) ? this.session : null;
  }

  token(player?: Address | null): string | null {
    const session = this.current();
    if (!session) return null;
    if (player && !isAddressEqual(getAddress(session.player), player)) return null;
    return session.token;
  }

  subscribe(listener: (session: StoredSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ensure(signer: IntentSigner): Promise<string> {
    const existing = this.token(signer.address);
    if (existing) return Promise.resolve(existing);
    const player = signer.address.toLowerCase();
    if (this.pending && this.pending.player === player) return this.pending.promise;
    const promise = this.login(signer).finally(() => {
      if (this.pending?.promise === promise) this.pending = null;
    });
    this.pending = { player, promise };
    return promise;
  }

  clear(): void {
    this.session = null;
    this.storage.removeItem(SESSION_STORAGE_KEY);
    this.notify();
  }

  private async login(signer: IntentSigner): Promise<string> {
    const challenge = await this.api.authChallenge(signer.address);
    if (challenge.chainId !== CHAIN_ID) throw new ApiError('VALIDATION', `The API expects chain ${challenge.chainId}, the app runs on ${CHAIN_ID}.`);
    const salt = challenge.salt;
    if (!isHex(salt)) throw new ApiError('BAD_RESPONSE', 'The login challenge salt is not hex.');
    const signature = await signer.signLogin({ player: signer.address, salt, expiresAt: challenge.expiresAt }, challenge.chainId);
    const kind: SignerKind = signer.kind;
    const response = await this.api.authSession({ address: signer.address, salt, expiresAt: challenge.expiresAt, signature, kind });
    this.session = { token: response.token, player: response.player, kind, expiresAtMs: toExpiryMs(response.expiresAt) };
    writeJson(this.storage, SESSION_STORAGE_KEY, this.session);
    this.notify();
    return response.token;
  }

  private isFresh(session: StoredSession): boolean {
    return session.expiresAtMs - REFRESH_MARGIN_MS > this.now();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this.session);
  }
}
