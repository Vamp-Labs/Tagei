// EIP-712 login (F1b §Auth): single-use salt (TTL 5 min) → `Login{player,salt,expiresAt}`
// signed with apiDomain(chainId) → HS256 JWT for 24 h. A guest's first session
// triggers the faucet auto-drip.

import { randomBytes } from 'node:crypto';
import { getAddress, verifyTypedData, type Address, type Hex, type PublicClient } from 'viem';
import { apiDomain, loginTypes } from '@bnbplay/shared/eip712';
import { ApiError } from '../api/errors.ts';
import { silentLogger, type Logger } from '../api/log.ts';
import { nowSec } from '../api/time.ts';
import { SESSION_TTL_SEC, signSession } from './jwt.ts';
import type { AuthStore, PlayerKind } from './store.ts';

export const CHALLENGE_TTL_SEC = 300;

export type LoginVerifier = (args: {
  address: Address;
  message: { player: Address; salt: Hex; expiresAt: number };
  signature: Hex;
  chainId: number;
}) => Promise<boolean>;

/** ECDSA first; with a public client, ERC-1271 / ERC-6492 smart accounts too. */
export function createLoginVerifier(publicClient?: PublicClient): LoginVerifier {
  return async ({ address, message, signature, chainId }) => {
    const typed = { domain: apiDomain(chainId), types: loginTypes, primaryType: 'Login' as const, message };
    try {
      if (await verifyTypedData({ address, signature, ...typed })) return true;
    } catch {
      // malformed signature for ECDSA; a contract wallet may still accept it
    }
    if (!publicClient) return false;
    try {
      return await publicClient.verifyTypedData({ address, signature, ...typed });
    } catch {
      return false;
    }
  };
}

export const displayNameFor = (address: Address, kind: PlayerKind): string =>
  kind === 'guest' ? `Pilot ${address.slice(-4).toUpperCase()}` : `${address.slice(0, 6)}…${address.slice(-4)}`;

export interface AuthServiceDeps {
  store: AuthStore;
  chainId: number;
  jwtSecret: string;
  now: () => number;
  verifyLogin: LoginVerifier;
  /** Fire-and-forget hook for the guest auto-drip. */
  onFirstGuestSession?: (player: Address, ipHash: string) => Promise<unknown> | void;
  log?: Logger;
}

export class AuthService {
  private readonly deps: AuthServiceDeps;
  private readonly log: Logger;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
    this.log = deps.log ?? silentLogger;
  }

  async challenge(address: string): Promise<{ salt: Hex; expiresAt: number; chainId: number }> {
    const salt = `0x${randomBytes(32).toString('hex')}` as Hex;
    const expiresAt = nowSec(this.deps.now()) + CHALLENGE_TTL_SEC;
    await this.deps.store.createChallenge({ salt, address: address.toLowerCase(), expiresAt });
    return { salt, expiresAt, chainId: this.deps.chainId };
  }

  async session(
    req: { address: string; salt: string; expiresAt: number; signature: string; kind: PlayerKind },
    ipHash: string,
  ): Promise<{ token: string; player: Address; expiresAt: number }> {
    const address = getAddress(req.address);
    const lower = address.toLowerCase();
    const now = nowSec(this.deps.now());
    const challenge = await this.deps.store.getChallenge(req.salt);
    if (!challenge || challenge.used || challenge.address !== lower || challenge.expiresAt !== req.expiresAt || challenge.expiresAt < now) {
      throw new ApiError('BAD_SIGNATURE', 'login challenge is unknown, expired or already used');
    }
    const ok = await this.deps.verifyLogin({
      address,
      message: { player: address, salt: req.salt as Hex, expiresAt: req.expiresAt },
      signature: req.signature as Hex,
      chainId: this.deps.chainId,
    });
    if (!ok) throw new ApiError('BAD_SIGNATURE', 'login signature does not match the address');
    if (!(await this.deps.store.consumeChallenge(req.salt, lower, now))) {
      throw new ApiError('BAD_SIGNATURE', 'login challenge was already used');
    }

    const { player, firstSession } = await this.deps.store.recordSession({
      address: lower,
      kind: req.kind,
      displayName: displayNameFor(address, req.kind),
    });
    const exp = now + SESSION_TTL_SEC;
    const token = await signSession(this.deps.jwtSecret, { player: address, kind: player.kind, iat: now, exp });

    if (firstSession && player.kind === 'guest' && this.deps.onFirstGuestSession) {
      Promise.resolve()
        .then(() => this.deps.onFirstGuestSession?.(address, ipHash))
        .catch((err: unknown) => this.log.warn('guest auto-drip failed', { player: address, err: String(err) }));
    }
    return { token, player: address, expiresAt: exp };
  }
}
