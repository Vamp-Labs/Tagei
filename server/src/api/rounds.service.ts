// Round open / cash-out / withdraw (F1b §Round open flow): validate everything that
// can be checked off-chain, then enqueue the signed intent on the relayer key.
// A3's sender simulates before spending gas; its failures surface as
// `settlement.step failed` and, for opens, `round.open_failed { stakeTaken: false }`.

import { encodeFunctionData, getAddress, hashTypedData, parseEther, verifyTypedData, type Address, type Hex, type PublicClient } from 'viem';
import type { z } from 'zod';
import { EXIT_DELAY_SEC, NONCE_KEY } from '@bnbplay/shared/constants';
import type { BalanceDTO, CashOutRequestSchema, OpenRoundRequestSchema, WithdrawRequestSchema } from '@bnbplay/shared/dto';
import { arenaDomain, arenaTypes } from '@bnbplay/shared/eip712';
import type { Bus } from '../bus.ts';
import type { PriceHub, RoundBook, TxSender } from '../ports.ts';
import { arenaAbi } from './arena-abi.ts';
import type { LaneSource, LedgerReader } from './deps.ts';
import { ApiError, publicMessage } from './errors.ts';
import type { IntentTracker } from './intents.ts';
import { silentLogger, type Logger } from './log.ts';
import { RateLimiter } from './rate-limit.ts';
import { nowSec } from './time.ts';

type OpenRoundRequest = z.infer<typeof OpenRoundRequestSchema>;
type CashOutRequest = z.infer<typeof CashOutRequestSchema>;
type WithdrawRequest = z.infer<typeof WithdrawRequestSchema>;

/** Signed intents must still be valid for at least this long when they reach us. */
const MIN_DEADLINE_MARGIN_SEC = 1;
/** …and may not be valid for longer than this (limits replay windows). */
const MAX_DEADLINE_AHEAD_SEC = 300;
const RELAYER_QUEUE_MAX = 50;
const RELAYER_BALANCE_TTL_MS = 15_000;

export type TypedDataVerifier = (args: Parameters<typeof verifyTypedData>[0]) => Promise<boolean>;

export function createTypedDataVerifier(publicClient?: PublicClient): TypedDataVerifier {
  return async (args) => {
    try {
      if (await verifyTypedData(args)) return true;
    } catch {
      // not an ECDSA signature; a contract wallet may still accept it
    }
    if (!publicClient) return false;
    try {
      return await publicClient.verifyTypedData(args as Parameters<PublicClient['verifyTypedData']>[0]);
    } catch {
      return false;
    }
  };
}

export interface RoundsServiceDeps {
  chainId: number;
  arena: Address | null;
  relayer?: TxSender;
  roundBook: RoundBook;
  priceHub: PriceHub;
  lanes: LaneSource;
  ledger?: LedgerReader;
  intents: IntentTracker;
  bus: Bus;
  verifyTyped: TypedDataVerifier;
  relayerMinBalanceBnb: number;
  now?: () => number;
  log?: Logger;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class RoundsService {
  private readonly deps: RoundsServiceDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly openCooldown: RateLimiter;
  private readonly openHourly: RateLimiter;
  private readonly relayerMinWei: bigint;
  private relayerBalance: { wei: bigint; atMs: number } | undefined;
  /** Last `balance` event per player (fallback when no chain reader is wired). */
  private readonly lastBalance = new Map<string, BalanceDTO>();

  constructor(deps: RoundsServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
    this.openCooldown = new RateLimiter({ limit: 1, windowMs: 3_000, now: this.now });
    this.openHourly = new RateLimiter({ limit: 60, windowMs: 3_600_000, now: this.now });
    this.relayerMinWei = parseEther(String(deps.relayerMinBalanceBnb));
  }

  /** Caches `balance` player events; returns the unsubscribe function. */
  start(): () => void {
    return this.deps.bus.on('player.event', (e) => {
      if (e.event === 'balance') this.lastBalance.set(e.player.toLowerCase(), e.payload as BalanceDTO);
    });
  }

  private requireArena(): { arena: Address; relayer: TxSender } {
    if (!this.deps.arena || !this.deps.relayer) {
      throw new ApiError('INTERNAL', 'live rounds are not available yet', { status: 503 });
    }
    return { arena: this.deps.arena, relayer: this.deps.relayer };
  }

  private checkDeadline(deadline: number): void {
    const now = nowSec(this.now());
    if (deadline < now + MIN_DEADLINE_MARGIN_SEC) throw new ApiError('INTENT_EXPIRED', 'the signed intent has expired; sign again');
    if (deadline > now + MAX_DEADLINE_AHEAD_SEC) throw new ApiError('VALIDATION', 'intent deadline is too far in the future');
  }

  private async checkRelayerFunded(relayer: TxSender): Promise<void> {
    const now = this.now();
    if (!this.relayerBalance || now - this.relayerBalance.atMs > RELAYER_BALANCE_TTL_MS) {
      try {
        this.relayerBalance = { wei: await relayer.balanceWei(), atMs: now };
      } catch (err) {
        this.log.warn('relayer balance check failed', { err: String(err) });
        return; // do not block on an RPC hiccup; the sender fails safely without gas
      }
    }
    if (this.relayerBalance.wei < this.relayerMinWei) throw new ApiError('RELAYER_UNFUNDED', publicMessage('RELAYER_UNFUNDED'));
  }

  async open(sessionPlayer: Address, req: OpenRoundRequest): Promise<{ intentId: string; intentHash: Hex }> {
    const { intent } = req;
    if (!same(intent.player, sessionPlayer)) throw new ApiError('SESSION_REQUIRED', 'intent player does not match the session', { status: 403 });
    const { arena, relayer } = this.requireArena();

    const message = {
      player: getAddress(intent.player),
      assetId: intent.assetId,
      tier: intent.tier,
      direction: intent.direction,
      stake: BigInt(intent.stake),
      laneVersion: intent.laneVersion,
      oracleIdx: intent.oracleIdx,
      nonce: BigInt(intent.nonce),
      deadline: intent.deadline,
    };
    const typed = {
      domain: arenaDomain(this.deps.chainId, arena),
      types: { OpenRound: arenaTypes.OpenRound },
      primaryType: 'OpenRound' as const,
      message,
    };
    const intentHash = hashTypedData(typed);
    const intentId = `op_${intentHash.slice(2, 26)}`;

    const existing = this.deps.intents.byIntentHash(intentHash);
    if (existing) return { intentId: existing.intentId, intentHash }; // idempotent by intent hash

    this.checkDeadline(intent.deadline);
    if ((message.nonce >> 64n) !== NONCE_KEY.open) throw new ApiError('VALIDATION', 'open intents use nonce key 0');
    if (!(await this.deps.verifyTyped({ address: message.player, signature: req.signature as Hex, ...typed }))) {
      throw new ApiError('BAD_SIGNATURE', publicMessage('BAD_SIGNATURE'));
    }

    if (this.deps.priceHub.status().status !== 'ok') throw new ApiError('ORACLE_UNAVAILABLE', 'the price oracle is not live right now');

    const snap = await this.deps.lanes.snapshot();
    const asset = snap.assets.find((a) => a.assetId === intent.assetId);
    const lane = asset?.tiers.find((t) => t.tier === intent.tier);
    if (!asset || !lane) throw new ApiError('VALIDATION', 'unknown asset or tier');
    if (!asset.enabled || !lane.enabled) throw new ApiError('TIER_DISABLED', publicMessage('TIER_DISABLED'));
    if (lane.laneVersion !== intent.laneVersion) throw new ApiError('LANE_VERSION_MISMATCH', publicMessage('LANE_VERSION_MISMATCH'));
    if (snap.activeOracleIdx !== intent.oracleIdx) throw new ApiError('LANE_VERSION_MISMATCH', 'the oracle changed. Refresh and sign again.');
    if (message.stake < BigInt(lane.minStake) || message.stake > BigInt(lane.maxStake)) {
      throw new ApiError('VALIDATION', 'stake is outside the lane bounds');
    }

    await this.checkRelayerFunded(relayer);
    if (this.deps.intents.inFlight('relayer') >= RELAYER_QUEUE_MAX) throw new ApiError('RELAYER_BUSY', publicMessage('RELAYER_BUSY'), { retryAfterMs: 2_000 });
    if (this.deps.roundBook.activeFor(message.player)) throw new ApiError('ROUND_ALREADY_ACTIVE', publicMessage('ROUND_ALREADY_ACTIVE'));
    if (this.deps.ledger) {
      const available = await this.deps.ledger.balanceOf(message.player).catch((err: unknown) => {
        this.log.warn('ledger read failed', { err: String(err) });
        return undefined;
      });
      if (available !== undefined && available < message.stake) throw new ApiError('INSUFFICIENT_CREDITS', publicMessage('INSUFFICIENT_CREDITS'));
    }

    // Counted only once everything else passed, so a rejected attempt never costs the player a cooldown.
    const key = sessionPlayer.toLowerCase();
    const cooldown = this.openCooldown.hit(key);
    if (!cooldown.ok) throw new ApiError('RATE_LIMITED', 'one launch every 3 seconds', { retryAfterMs: cooldown.retryAfterMs });
    const hourly = this.openHourly.hit(key);
    if (!hourly.ok) throw new ApiError('RATE_LIMITED', 'hourly round limit reached', { retryAfterMs: hourly.retryAfterMs });

    const data = encodeFunctionData({ abi: arenaAbi, functionName: 'openRoundWithSig', args: [message, req.signature as Hex] });
    this.deps.intents.submit(
      relayer,
      { key: 'relayer', kind: 'open', to: arena, data, intentId, priority: 10 },
      { intentId, player: message.player, kind: 'open', intentHash },
      (outcome) => {
        if (outcome.status !== 'failed') return;
        const code = outcome.code ?? 'INTERNAL';
        this.deps.bus.emit('player.event', {
          player: message.player,
          event: 'round.open_failed',
          payload: { intentId, code, message: `${publicMessage(code)} Your stake was not taken.`, stakeTaken: false },
        });
      },
    );
    this.log.info('open enqueued', { intentId, player: message.player, assetId: intent.assetId, tier: intent.tier });
    return { intentId, intentHash };
  }

  async cashOut(sessionPlayer: Address, roundIdParam: string, req: CashOutRequest): Promise<{ intentId: string }> {
    const { intent } = req;
    if (!same(intent.player, sessionPlayer)) throw new ApiError('SESSION_REQUIRED', 'intent player does not match the session', { status: 403 });
    if (intent.roundId !== roundIdParam) throw new ApiError('VALIDATION', 'round id does not match the intent');
    const { arena, relayer } = this.requireArena();

    const message = { player: getAddress(intent.player), roundId: BigInt(intent.roundId), deadline: intent.deadline };
    const typed = {
      domain: arenaDomain(this.deps.chainId, arena),
      types: { CashOut: arenaTypes.CashOut },
      primaryType: 'CashOut' as const,
      message,
    };
    const intentHash = hashTypedData(typed);
    const intentId = `co_${intentHash.slice(2, 26)}`;
    const existing = this.deps.intents.byIntentHash(intentHash);
    if (existing) return { intentId: existing.intentId };

    const round = this.deps.roundBook.get(message.roundId);
    if (!round || !same(round.player, sessionPlayer)) throw new ApiError('ROUND_NOT_FOUND', 'round not found');
    if (round.status !== 'open') throw new ApiError('CASHOUT_TOO_LATE', publicMessage('CASHOUT_TOO_LATE'));
    if (round.terms.cashOutRequested || this.deps.roundBook.toDTO(message.roundId)?.cashOutRequested) {
      throw new ApiError('VALIDATION', 'a cash-out was already requested for this round', { status: 409 });
    }
    this.checkDeadline(intent.deadline);
    const now = nowSec(this.now());
    const exitSec = Math.max(now + EXIT_DELAY_SEC, round.terms.entrySec + 1);
    if (exitSec >= round.terms.endSec) throw new ApiError('CASHOUT_TOO_LATE', publicMessage('CASHOUT_TOO_LATE'));
    if (!(await this.deps.verifyTyped({ address: message.player, signature: req.signature as Hex, ...typed }))) {
      throw new ApiError('BAD_SIGNATURE', publicMessage('BAD_SIGNATURE'));
    }

    // Cash-outs reduce risk: never blocked by the relayer queue cap or the low-balance open switch.
    const data = encodeFunctionData({ abi: arenaAbi, functionName: 'requestCashOutWithSig', args: [message, req.signature as Hex] });
    this.deps.intents.submit(
      relayer,
      { key: 'relayer', kind: 'cashout', to: arena, data, roundId: message.roundId, intentId, priority: 100 },
      { intentId, player: message.player, kind: 'cashout', roundId: message.roundId, intentHash },
    );
    return { intentId };
  }

  async withdraw(sessionPlayer: Address, req: WithdrawRequest): Promise<{ intentId: string }> {
    const { intent } = req;
    if (!same(intent.player, sessionPlayer)) throw new ApiError('SESSION_REQUIRED', 'intent player does not match the session', { status: 403 });
    const { arena, relayer } = this.requireArena();
    const message = {
      player: getAddress(intent.player),
      to: getAddress(intent.to),
      amount: BigInt(intent.amount),
      nonce: BigInt(intent.nonce),
      deadline: intent.deadline,
    };
    const typed = {
      domain: arenaDomain(this.deps.chainId, arena),
      types: { Withdraw: arenaTypes.Withdraw },
      primaryType: 'Withdraw' as const,
      message,
    };
    const intentHash = hashTypedData(typed);
    const intentId = `wd_${intentHash.slice(2, 26)}`;
    const existing = this.deps.intents.byIntentHash(intentHash);
    if (existing) return { intentId: existing.intentId };

    if (message.amount <= 0n) throw new ApiError('VALIDATION', 'amount must be positive');
    if ((message.nonce >> 64n) !== NONCE_KEY.withdraw) throw new ApiError('VALIDATION', 'withdraw intents use nonce key 1');
    this.checkDeadline(intent.deadline);
    if (!(await this.deps.verifyTyped({ address: message.player, signature: req.signature as Hex, ...typed }))) {
      throw new ApiError('BAD_SIGNATURE', publicMessage('BAD_SIGNATURE'));
    }
    if (this.deps.ledger) {
      const available = await this.deps.ledger.balanceOf(message.player).catch(() => undefined);
      if (available !== undefined && available < message.amount) throw new ApiError('INSUFFICIENT_CREDITS', publicMessage('INSUFFICIENT_CREDITS'));
    }
    const data = encodeFunctionData({ abi: arenaAbi, functionName: 'withdrawWithSig', args: [message, req.signature as Hex] });
    this.deps.intents.submit(
      relayer,
      { key: 'relayer', kind: 'withdraw', to: arena, data, intentId, priority: 5 },
      { intentId, player: message.player, kind: 'withdraw', intentHash },
    );
    return { intentId };
  }

  async balance(player: Address): Promise<BalanceDTO> {
    const active = this.deps.roundBook.activeFor(player);
    const locked = active && active.status === 'open' ? active.terms.stake : 0n;
    if (this.deps.ledger) {
      try {
        return { available: (await this.deps.ledger.balanceOf(player)).toString(), locked: locked.toString() };
      } catch (err) {
        this.log.warn('ledger read failed', { err: String(err) });
      }
    }
    return this.lastBalance.get(player.toLowerCase()) ?? { available: '0', locked: locked.toString() };
  }
}
