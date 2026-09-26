// Faucet (F1b §Rate limits): $100 per claim, 24 h cooldown per player, ≤ 3 claims
// per IP hash per day, ≤ 300 per hour globally; drips go out on the ops key.
// Manual refills are only granted below a $5 balance (the UI offers them from the
// Profile only — never from a loss screen). A guest's first session auto-drips.

import { randomBytes } from 'node:crypto';
import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import type { RoundBook, TxSender } from '../ports.ts';
import { faucetAbi } from '../api/arena-abi.ts';
import type { LedgerReader } from '../api/deps.ts';
import { ApiError } from '../api/errors.ts';
import type { IntentTracker } from '../api/intents.ts';
import { silentLogger, type Logger } from '../api/log.ts';
import type { FaucetStore } from './store.ts';

export const FAUCET_COOLDOWN_MS = 24 * 3_600_000;
export const FAUCET_IP_DAILY_CAP = 3;
export const FAUCET_GLOBAL_HOURLY_CAP = 300;
export const REFILL_BELOW = 5n * 10n ** 18n;

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type DripEncoder = (player: Address, amount: bigint) => Hex;

// The on-chain faucet drips its configured `dripAmount`; `amount` is only used for off-chain accounting.
export const encodeDrip: DripEncoder = (player, _amount) =>
  encodeFunctionData({ abi: faucetAbi, functionName: 'drip', args: [player] });

export interface FaucetServiceDeps {
  store: FaucetStore;
  intents: IntentTracker;
  roundBook: RoundBook;
  ops?: TxSender;
  faucetAddress: Address | null;
  enabled: boolean;
  amountUsd: number;
  ledger?: LedgerReader;
  encodeDrip?: DripEncoder;
  /** Cloudflare Turnstile for manual claims (TURNSTILE_SECRET_KEY); skipped when unset. */
  turnstileSecret?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: Logger;
}

export class FaucetService {
  private readonly deps: FaucetServiceDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly amount: bigint;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(deps: FaucetServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
    this.amount = BigInt(Math.round(deps.amountUsd * 100)) * 10n ** 16n;
  }

  available(): boolean {
    return this.deps.enabled && this.deps.faucetAddress !== null && this.deps.ops !== undefined;
  }

  /** Manual refill from the Profile screen. */
  async claim(player: Address, opts: { ipHash: string; turnstileToken?: string }): Promise<{ claimId: string }> {
    this.requireAvailable();
    if (this.deps.turnstileSecret && !(await this.verifyTurnstile(opts.turnstileToken))) {
      throw new ApiError('VALIDATION', 'complete the human check to claim credits');
    }
    if (this.deps.ledger) {
      const available = await this.deps.ledger.balanceOf(player).catch(() => undefined);
      const active = this.deps.roundBook.activeFor(player);
      const locked = active && active.status === 'open' ? active.terms.stake : 0n;
      if (available !== undefined && available + locked >= REFILL_BELOW) {
        throw new ApiError('FAUCET_COOLDOWN', 'Refills unlock when your balance is below $5.');
      }
    }
    return this.drip(player, opts.ipHash, 'claim');
  }

  /** Automatic drip on a guest's first session; limits still apply, failures are silent. */
  async autoDrip(player: Address, ipHash: string): Promise<{ claimId: string } | null> {
    if (!this.available()) return null;
    try {
      return await this.drip(player, ipHash, 'auto');
    } catch (err) {
      this.log.info('guest auto-drip skipped', { player, reason: err instanceof ApiError ? err.code : String(err) });
      return null;
    }
  }

  private requireAvailable(): void {
    if (!this.available()) throw new ApiError('INTERNAL', 'the faucet is not available right now', { status: 503 });
  }

  private async drip(playerIn: Address, ipHash: string, source: 'auto' | 'claim'): Promise<{ claimId: string }> {
    const player = getAddress(playerIn);
    const key = player.toLowerCase();
    return this.withLock(key, async () => {
      const now = this.now();
      const last = await this.deps.store.lastActiveClaim(key);
      if (last && last.createdAtMs + FAUCET_COOLDOWN_MS > now) {
        throw new ApiError('FAUCET_COOLDOWN', 'You can claim again 24 hours after your last claim.', {
          retryAfterMs: last.createdAtMs + FAUCET_COOLDOWN_MS - now,
        });
      }
      if ((await this.deps.store.countByIpSince(ipHash, now - FAUCET_COOLDOWN_MS)) >= FAUCET_IP_DAILY_CAP) {
        throw new ApiError('FAUCET_COOLDOWN', 'Daily claim limit reached for this network.', { retryAfterMs: 3_600_000 });
      }
      if ((await this.deps.store.countSince(now - 3_600_000)) >= FAUCET_GLOBAL_HOURLY_CAP) {
        throw new ApiError('FAUCET_COOLDOWN', 'The faucet is busy. Try again shortly.', { retryAfterMs: 60_000 });
      }

      const claimId = `fc_${randomBytes(8).toString('hex')}`;
      await this.deps.store.insert({
        id: claimId,
        player: key,
        ipHash,
        amount: this.amount,
        source,
        status: 'queued',
        txHash: null,
        error: null,
        createdAtMs: now,
      });
      const ops = this.deps.ops as TxSender;
      const to = this.deps.faucetAddress as Address;
      const data = (this.deps.encodeDrip ?? encodeDrip)(player, this.amount);
      try {
        this.deps.intents.submit(ops, { key: 'ops', kind: 'faucet', to, data, intentId: claimId, priority: 1 }, { intentId: claimId, player, kind: 'faucet' }, async (outcome) => {
          await this.deps.store.update(claimId, { status: outcome.status, txHash: outcome.txHash ?? null, error: outcome.error ?? null });
        });
      } catch (err) {
        await this.deps.store.update(claimId, { status: 'failed', error: String(err) });
        throw err;
      }
      this.log.info('faucet drip enqueued', { claimId, player, source });
      return { claimId };
    });
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  private async verifyTurnstile(token: string | undefined): Promise<boolean> {
    if (!token || !this.deps.turnstileSecret) return false;
    try {
      const res = await (this.deps.fetch ?? fetch)(TURNSTILE_URL, {
        method: 'POST',
        body: new URLSearchParams({ secret: this.deps.turnstileSecret, response: token }),
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    } catch (err) {
      this.log.warn('turnstile verification failed', { err: String(err) });
      return false;
    }
  }
}
