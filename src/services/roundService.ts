import { getAddress, isAddressEqual, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ASSETS, type AssetSymbol } from '@bnbplay/shared/assets';
import { INTENT_TTL_SEC } from '@bnbplay/shared/constants';
import { Hash32, type ConfigDTO, type DebriefDTO, type RoundDTO, type TierDTO } from '@bnbplay/shared/dto';
import { Direction, Outcome } from '@bnbplay/shared/enums';
import { arenaDomain, type OpenRoundMessage } from '@bnbplay/shared/eip712';
import { barrierPrices } from '@bnbplay/shared/lane';
import type { RoundTerms } from '@bnbplay/shared/path';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { OpenRoundRequest, RoundApi } from '../api/client';
import type { FakeScenario } from '../api/env';
import { ApiError, toApiError, type AppErrorCode } from '../api/errors';
import { apiClient, getFakeBackend, getStream, isFakeMode } from '../api/runtime';
import { browserStorage, createMemoryStorage, type KeyValueStorage } from '../api/storage';
import type { StreamLike } from '../api/stream';
import { RecordedPath, activeRoundView, markRound, roundTerms, tradeResultFromRound, type RoundMark } from '../game/roundMath';
import { fromPrice18, stake18ToUsd, usdToStake18 } from '../game/units';
import type { ActiveTradeRound, PositionDirection, TradeResult, VoidReasonLabel } from '../types/game';
import { createAccountSigner, type IntentSigner } from '../web3/signing';
import { FakeBackend } from './fakeBackend';
import { marketFeed } from './marketFeed';
import type { SettlementStep } from './web3Service';
import { web3Service } from './web3Service';

export const LAST_SEEN_ROUND_KEY = 'bnbplay.lastSeenRound';
export const LAUNCH_TIMEOUT_MS = 8_000;
export const CASHOUT_TOO_LATE_COPY = 'Round ending — settling at the final price.';
export const LAUNCH_NOT_CONFIRMED_COPY = 'LAUNCH NOT CONFIRMED · Your stake was not taken.';

const PRICE_RING_SECONDS = 180;
const ENTRY_POLL_MS = 1_500;
const ENTRY_POLL_ATTEMPTS = 6;

export type RoundPhase =
  | 'idle'
  | 'signing'
  | 'submitting'
  | 'locking'
  | 'charging'
  | 'opened'
  | 'live'
  | 'cashing_out'
  | 'settling'
  | 'settle_failed'
  | 'settled'
  | 'voided';

export type CashOutState = 'none' | 'pending' | 'requested' | 'rejected';

export type ResumeTarget = 'LIVE_TRADE' | 'SETTLING' | 'RESULT';

export interface LaunchParams {
  asset: AssetSymbol;
  tier: number;
  direction: PositionDirection;
  stakeUsd: number;
}

export type LaunchOutcome = { ok: true; intentId: string } | { ok: false; code: AppErrorCode; message: string };

export type CashOutOutcome = { ok: true; intentId: string } | { ok: false; code: AppErrorCode; message: string };

export interface TouchInfo {
  kind: 'target' | 'stop';
  sec: number;
  price: number;
  source: 'local' | 'server';
}

export interface StepInfo {
  step: SettlementStep;
  txHash: string | null;
  error: { code: string; message: string } | null;
}

export interface RoundSnapshot {
  phase: RoundPhase;
  intentId: string | null;
  roundId: string | null;
  asset: AssetSymbol | null;
  round: RoundDTO | null;
  view: ActiveTradeRound | null;
  mark: RoundMark | null;
  entryPrice: number | null;
  endSec: number | null;
  openStep: StepInfo | null;
  settleStep: StepInfo | null;
  cashOut: CashOutState;
  cashOutSnapshot: RoundMark | null;
  exitPrice: number | null;
  touch: TouchInfo | null;
  result: TradeResult | null;
  error: { code: AppErrorCode; message: string } | null;
}

export type ProgressionPayload = SsePayload<'progression.updated'>;

export type RoundEvent =
  | { type: 'phase'; phase: RoundPhase; snapshot: RoundSnapshot }
  | { type: 'launch.step'; step: SettlementStep; txHash: string | null }
  | { type: 'launch.failed'; code: AppErrorCode; message: string; stakeTaken: false }
  | { type: 'round.opened'; roundId: string; round: RoundDTO }
  | { type: 'entry.locked'; roundId: string; entrySec: number; entryPrice: number; view: ActiveTradeRound }
  | { type: 'mark'; roundId: string; mark: RoundMark; view: ActiveTradeRound }
  | { type: 'touch'; roundId: string; touch: TouchInfo }
  | { type: 'time.up'; roundId: string }
  | { type: 'cashout.pending'; roundId: string; snapshot: RoundMark | null }
  | { type: 'cashout.requested'; roundId: string; exitSec: number; txHash: string }
  | { type: 'cashout.rejected'; roundId: string; code: AppErrorCode; message: string }
  | { type: 'exit.locked'; roundId: string; exitSec: number; exitPrice: number }
  | { type: 'settle.step'; roundId: string; step: SettlementStep; txHash: string | null; error: { code: string; message: string } | null }
  | { type: 'settled'; roundId: string; result: TradeResult; round: RoundDTO }
  | { type: 'voided'; roundId: string; result: TradeResult; reason: VoidReasonLabel }
  | { type: 'result.updated'; roundId: string; result: TradeResult }
  | { type: 'progression'; roundId: string | null; progression: ProgressionPayload }
  | { type: 'debrief'; roundId: string; debrief: DebriefDTO }
  | { type: 'balance'; available: number; locked: number }
  | { type: 'resume'; target: ResumeTarget; snapshot: RoundSnapshot };

export type RoundEventListener = (event: RoundEvent) => void;

export interface RoundServiceDeps {
  stream: StreamLike;
  api: RoundApi;
  getSigner: () => IntentSigner | null;
  readNonce: (player: Address, arena: Address) => Promise<bigint>;
  storage: KeyValueStorage;
  ensureSession?: (signer: IntentSigner) => Promise<void>;
  setLevels?: (levels: readonly number[] | null) => void;
  launchTimeoutMs?: number;
}

const ACTIVE_PHASES: readonly RoundPhase[] = ['signing', 'submitting', 'locking', 'charging', 'opened', 'live', 'cashing_out', 'settling', 'settle_failed'];
const AWAITING_OPEN: readonly RoundPhase[] = ['submitting', 'locking', 'charging'];

const emptySnapshot = (): RoundSnapshot => ({
  phase: 'idle',
  intentId: null,
  roundId: null,
  asset: null,
  round: null,
  view: null,
  mark: null,
  entryPrice: null,
  endSec: null,
  openStep: null,
  settleStep: null,
  cashOut: 'none',
  cashOutSnapshot: null,
  exitPrice: null,
  touch: null,
  result: null,
  error: null,
});

export class RoundService {
  private readonly deps: RoundServiceDeps;
  private readonly listeners = new Set<RoundEventListener>();
  private readonly launchTimeoutMs: number;
  private state: RoundSnapshot = emptySnapshot();
  private terms: RoundTerms | null = null;
  private entryPrice18: bigint | null = null;
  private path = new RecordedPath();
  private readonly priceRing = new Map<AssetSymbol, Map<number, bigint>>();
  private readonly xpByRound = new Map<string, number>();
  private readonly finished = new Set<string>();
  private configCache: ConfigDTO | null = null;
  private launchTimer: ReturnType<typeof setTimeout> | null = null;
  private timeUpTimer: ReturnType<typeof setTimeout> | null = null;
  private entryPoll: ReturnType<typeof setTimeout> | null = null;
  private launchStartedAtMs = 0;
  private releaseStream: (() => void) | null = null;
  private readonly offs: (() => void)[];

  constructor(deps: RoundServiceDeps) {
    this.deps = deps;
    this.launchTimeoutMs = deps.launchTimeoutMs ?? LAUNCH_TIMEOUT_MS;
    const { stream } = deps;
    this.offs = [
      stream.on('hello', (hello) => this.onHello(hello)),
      stream.on('prices.snapshot', (snapshot) => this.onSnapshot(snapshot)),
      stream.on('price', (price) => this.onPrice(price)),
      stream.on('settlement.step', (step) => this.onSettlementStep(step)),
      stream.on('round.opened', (round) => this.onOpened(round)),
      stream.on('round.open_failed', (failure) => this.onOpenFailed(failure)),
      stream.on('round.entry_locked', (lock) => this.onEntryLocked(lock.roundId, lock.entrySec, BigInt(lock.entryPrice))),
      stream.on('round.touch', (touch) => this.onServerTouch(touch)),
      stream.on('round.cashout_requested', (request) => this.onCashOutRequested(request)),
      stream.on('round.exit_locked', (lock) => this.onExitLocked(lock)),
      stream.on('round.settled', (round) => this.onSettled(round)),
      stream.on('round.voided', (voided) => this.onVoided(voided)),
      stream.on('balance', (balance) => this.emit({ type: 'balance', available: stake18ToUsd(balance.available), locked: stake18ToUsd(balance.locked) })),
      stream.on('progression.updated', (progression) => this.onProgression(progression)),
      stream.on('pix.debrief', (debrief) => this.emit({ type: 'debrief', roundId: debrief.roundId, debrief: debrief.debrief })),
    ];
  }

  subscribe(listener: RoundEventListener): () => void {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    this.releaseStream ??= this.deps.stream.retain();
  }

  stop(): void {
    this.releaseStream?.();
    this.releaseStream = null;
  }

  dispose(): void {
    this.stop();
    this.clearTimers();
    this.offs.forEach((off) => off());
    this.listeners.clear();
  }

  getSnapshot(): RoundSnapshot {
    return { ...this.state };
  }

  getPhase(): RoundPhase {
    return this.state.phase;
  }

  isActive(): boolean {
    return ACTIVE_PHASES.includes(this.state.phase);
  }

  serverNow(): number {
    return this.deps.stream.serverNow();
  }

  msUntilEnd(): number | null {
    return this.state.endSec === null ? null : this.state.endSec * 1000 - this.serverNow();
  }

  async getConfig(refresh = false): Promise<ConfigDTO> {
    if (!this.configCache || refresh) this.configCache = await this.deps.api.config();
    return this.configCache;
  }

  async launch(params: LaunchParams): Promise<LaunchOutcome> {
    if (this.isActive()) return { ok: false, code: 'ROUND_ALREADY_ACTIVE', message: 'A round is already in flight.' };
    const signer = this.deps.getSigner();
    if (!signer) return this.failLaunch('NO_WALLET', 'Connect or play as a guest first.');
    this.start();
    this.resetState();
    this.launchStartedAtMs = this.serverNow();
    this.state.asset = params.asset;
    this.setPhase('signing');
    try {
      await this.deps.ensureSession?.(signer);
      let config = await this.getConfig();
      let request = await this.buildOpenRequest(signer, config, params);
      this.setPhase('submitting');
      let response: { intentId: string };
      try {
        response = await this.deps.api.openRound(request);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'LANE_VERSION_MISMATCH') throw error;
        config = await this.getConfig(true);
        this.setPhase('signing');
        request = await this.buildOpenRequest(signer, config, params);
        this.setPhase('submitting');
        response = await this.deps.api.openRound(request);
      }
      if (this.state.phase !== 'submitting') return { ok: true, intentId: response.intentId };
      this.state.intentId = response.intentId;
      this.setPhase('locking');
      this.armLaunchTimeout(signer.address);
      return { ok: true, intentId: response.intentId };
    } catch (error) {
      const apiError = toApiError(error, 'INTERNAL');
      return this.failLaunch(apiError.code, apiError.message);
    }
  }

  async cashOut(): Promise<CashOutOutcome> {
    const { roundId } = this.state;
    if (this.state.phase !== 'live' || roundId === null || !this.terms) {
      return { ok: false, code: 'NOT_LIVE', message: 'There is no live round to cash out.' };
    }
    const signer = this.deps.getSigner();
    if (!signer) return { ok: false, code: 'NO_WALLET', message: 'Wallet disconnected.' };
    this.state.cashOut = 'pending';
    this.state.cashOutSnapshot = this.state.mark;
    this.emit({ type: 'cashout.pending', roundId, snapshot: this.state.mark });
    this.setPhase('cashing_out');
    try {
      await this.deps.ensureSession?.(signer);
      const config = await this.getConfig();
      if (!config.contracts) throw new ApiError('CONTRACTS_NOT_DEPLOYED', 'Contracts are not deployed yet.');
      const deadline = Math.floor(this.serverNow() / 1000) + INTENT_TTL_SEC.cashOut;
      const message = { player: signer.address, roundId: BigInt(roundId), deadline };
      const signature = await signer.signCashOut(message, arenaDomain(config.chainId, getAddress(config.contracts.arena)));
      const response = await this.deps.api.cashOut(roundId, {
        intent: { player: signer.address, roundId, deadline },
        signature,
      });
      return { ok: true, intentId: response.intentId };
    } catch (error) {
      const apiError = toApiError(error, 'INTERNAL');
      const message = apiError.code === 'CASHOUT_TOO_LATE' ? CASHOUT_TOO_LATE_COPY : apiError.message;
      if (this.state.roundId === roundId && this.state.cashOut === 'pending') {
        this.state.cashOut = 'rejected';
        this.state.cashOutSnapshot = null;
        this.emit({ type: 'cashout.rejected', roundId, code: apiError.code, message });
        if (this.getPhase() === 'cashing_out') this.setPhase(this.isPastEnd() ? 'settling' : 'live');
      }
      return { ok: false, code: apiError.code, message };
    }
  }

  async watch(roundId: string): Promise<RoundSnapshot> {
    this.start();
    const round = await this.deps.api.round(roundId);
    if (round.status === 'settled') this.finishFromRound(round, false);
    else this.adopt(round);
    return this.getSnapshot();
  }

  reset(): void {
    if (this.isActive()) return;
    if (this.state.roundId && (this.state.phase === 'settled' || this.state.phase === 'voided')) this.markResultSeen(this.state.roundId);
    this.resetState();
    this.setPhase('idle');
  }

  markResultSeen(roundId: string): void {
    this.deps.storage.setItem(LAST_SEEN_ROUND_KEY, roundId);
  }

  lastSeenRound(): string | null {
    return this.deps.storage.getItem(LAST_SEEN_ROUND_KEY);
  }

  private async buildOpenRequest(signer: IntentSigner, config: ConfigDTO, params: LaunchParams): Promise<OpenRoundRequest> {
    if (!config.contracts) throw new ApiError('CONTRACTS_NOT_DEPLOYED', 'Contracts are not deployed yet.');
    const assetConfig = config.assets.find((entry) => entry.symbol === params.asset);
    if (!assetConfig || !assetConfig.enabled) throw new ApiError('TIER_DISABLED', `${params.asset} is not available right now.`);
    const tier: TierDTO | undefined = assetConfig.tiers.find((entry) => entry.tier === params.tier);
    if (!tier || !tier.enabled) throw new ApiError('TIER_DISABLED', 'This tier is not enabled yet.');
    const stake = usdToStake18(params.stakeUsd);
    if (stake < BigInt(tier.minStake) || stake > BigInt(tier.maxStake)) {
      throw new ApiError('VALIDATION', `Stake must be between $${stake18ToUsd(tier.minStake)} and $${stake18ToUsd(tier.maxStake)}.`);
    }
    const arena = getAddress(config.contracts.arena);
    const nonce = await this.deps.readNonce(signer.address, arena);
    const message: OpenRoundMessage = {
      player: signer.address,
      assetId: assetConfig.assetId,
      tier: tier.tier,
      direction: params.direction === 'LONG' ? Direction.Long : Direction.Short,
      stake,
      laneVersion: tier.laneVersion,
      oracleIdx: config.activeOracleIdx,
      nonce,
      deadline: Math.floor(this.serverNow() / 1000) + INTENT_TTL_SEC.open,
    };
    const signature = await signer.signOpenRound(message, arenaDomain(config.chainId, arena));
    return {
      intent: {
        player: message.player,
        assetId: message.assetId,
        tier: message.tier,
        direction: message.direction,
        stake: message.stake.toString(),
        laneVersion: message.laneVersion,
        oracleIdx: message.oracleIdx,
        nonce: message.nonce.toString(),
        deadline: message.deadline,
      },
      signature,
    };
  }

  private failLaunch(code: AppErrorCode, message: string): LaunchOutcome {
    this.clearLaunchTimer();
    const copy = code === 'LAUNCH_NOT_CONFIRMED' ? LAUNCH_NOT_CONFIRMED_COPY : message;
    this.state.error = { code, message: copy };
    this.emit({ type: 'launch.failed', code, message: copy, stakeTaken: false });
    this.resetState();
    this.setPhase('idle');
    return { ok: false, code, message: copy };
  }

  private armLaunchTimeout(player: Address): void {
    this.clearLaunchTimer();
    this.launchTimer = setTimeout(() => {
      this.launchTimer = null;
      void this.confirmLaunch(player);
    }, this.launchTimeoutMs);
  }

  private async confirmLaunch(player: Address): Promise<void> {
    if (!AWAITING_OPEN.includes(this.state.phase)) return;
    try {
      const page = await this.deps.api.playerRounds(player);
      const opened = page.items.find((round) => round.status === 'open' && round.openedAtMs >= this.launchStartedAtMs - 5_000);
      if (opened && AWAITING_OPEN.includes(this.state.phase)) {
        this.onOpened(opened);
        return;
      }
    } catch {
      if (!AWAITING_OPEN.includes(this.state.phase)) return;
    }
    if (AWAITING_OPEN.includes(this.state.phase)) this.failLaunch('LAUNCH_NOT_CONFIRMED', LAUNCH_NOT_CONFIRMED_COPY);
  }

  private onHello(hello: SsePayload<'hello'>): void {
    const player = hello.player;
    if (!player) return;
    if (this.isActive()) {
      const ours = this.state.roundId;
      if (ours && player.activeRound?.roundId !== ours && player.lastSettled?.roundId === ours) this.onSettled(player.lastSettled);
      return;
    }
    if (player.activeRound) {
      if (this.finished.has(player.activeRound.roundId)) return;
      this.resetState();
      this.adopt(player.activeRound);
      const target: ResumeTarget = this.isPastEnd() ? 'SETTLING' : 'LIVE_TRADE';
      this.emit({ type: 'resume', target, snapshot: this.getSnapshot() });
      return;
    }
    const last = player.lastSettled;
    if (last && last.roundId !== this.lastSeenRound() && !this.finished.has(last.roundId)) {
      this.resetState();
      this.finishFromRound(last, false);
      this.emit({ type: 'resume', target: 'RESULT', snapshot: this.getSnapshot() });
    }
  }

  private adopt(round: RoundDTO, pollEntry = true): void {
    this.state.roundId = round.roundId;
    this.state.round = round;
    this.state.asset = round.asset;
    this.terms = roundTerms(round);
    this.state.endSec = this.terms.endSec;
    this.state.cashOut = round.cashOutRequested ? 'requested' : 'none';
    this.backfillPath(round.asset);
    if (round.entryPrice !== null) {
      this.onEntryLocked(round.roundId, round.terms.entrySec, BigInt(round.entryPrice), true);
      if (this.isPastEnd()) this.setPhase('settling');
    } else {
      this.setPhase('opened');
      if (pollEntry) this.pollEntry(round.roundId, ENTRY_POLL_ATTEMPTS);
    }
  }

  private pollEntry(roundId: string, attempts: number): void {
    if (attempts <= 0) return;
    this.entryPoll = setTimeout(() => {
      this.entryPoll = null;
      if (this.state.roundId !== roundId || this.entryPrice18 !== null) return;
      this.deps.api
        .round(roundId)
        .then((round) => {
          if (this.state.roundId !== roundId || this.entryPrice18 !== null) return;
          if (round.entryPrice !== null) this.onEntryLocked(roundId, round.terms.entrySec, BigInt(round.entryPrice));
          else this.pollEntry(roundId, attempts - 1);
        })
        .catch(() => this.pollEntry(roundId, attempts - 1));
    }, ENTRY_POLL_MS);
  }

  private onSnapshot(snapshot: SsePayload<'prices.snapshot'>): void {
    for (const { symbol } of ASSETS) {
      const entry = snapshot.assets[symbol];
      if (!entry) continue;
      for (const [round, , price] of entry.rounds) this.remember(symbol, Math.floor(Number(round) / 1000), BigInt(price));
    }
    if (this.state.asset && this.terms) this.backfillPath(this.state.asset);
  }

  private onPrice(event: SsePayload<'price'>): void {
    const sec = Math.floor(Number(event.round) / 1000);
    const price18 = BigInt(event.price);
    this.remember(event.asset, sec, price18);
    if (this.state.asset !== event.asset || !this.terms) return;
    this.path.set(sec, price18);
    if (this.entryPrice18 !== null) this.evaluateSecond(sec, price18);
  }

  private remember(asset: AssetSymbol, sec: number, price18: bigint): void {
    const ring = this.priceRing.get(asset) ?? new Map<number, bigint>();
    ring.set(sec, price18);
    if (ring.size > PRICE_RING_SECONDS) {
      const oldest = Math.min(...ring.keys());
      ring.delete(oldest);
    }
    this.priceRing.set(asset, ring);
  }

  private backfillPath(asset: AssetSymbol): void {
    const ring = this.priceRing.get(asset);
    if (!ring || !this.terms) return;
    for (const [sec, price18] of [...ring.entries()].sort((a, b) => a[0] - b[0])) {
      if (sec >= this.terms.entrySec) this.path.set(sec, price18);
    }
  }

  private onSettlementStep(event: SsePayload<'settlement.step'>): void {
    const info: StepInfo = { step: event.step, txHash: event.txHash, error: event.error };
    if (event.kind === 'open' && event.intentId !== null && event.intentId === this.state.intentId) {
      this.state.openStep = info;
      this.emit({ type: 'launch.step', step: event.step, txHash: event.txHash });
      if (event.step === 'submitted' && this.state.phase === 'locking') this.setPhase('charging');
      return;
    }
    if ((event.kind === 'settle' || event.kind === 'void') && event.roundId !== null && event.roundId === this.state.roundId) {
      this.state.settleStep = info;
      this.emit({ type: 'settle.step', roundId: event.roundId, step: event.step, txHash: event.txHash, error: event.error });
      if (event.step === 'failed') this.setPhase('settle_failed');
      else if (this.state.phase === 'settle_failed' || this.state.phase === 'live' || this.state.phase === 'cashing_out') this.setPhase('settling');
    }
  }

  private onOpened(round: RoundDTO): void {
    const signer = this.deps.getSigner();
    if (!signer || !isAddressEqual(getAddress(round.player), signer.address)) return;
    if (this.finished.has(round.roundId) || this.state.roundId === round.roundId) return;
    if (AWAITING_OPEN.includes(this.state.phase)) {
      this.clearLaunchTimer();
      this.adopt(round, false);
      this.emit({ type: 'round.opened', roundId: round.roundId, round });
      return;
    }
    if (!this.isActive()) {
      this.resetState();
      this.adopt(round);
      this.emit({ type: 'round.opened', roundId: round.roundId, round });
      this.emit({ type: 'resume', target: this.isPastEnd() ? 'SETTLING' : 'LIVE_TRADE', snapshot: this.getSnapshot() });
    }
  }

  private onOpenFailed(failure: SsePayload<'round.open_failed'>): void {
    if (failure.intentId !== this.state.intentId || !AWAITING_OPEN.includes(this.state.phase)) return;
    this.failLaunch(failure.code, failure.message);
  }

  private onEntryLocked(roundId: string, entrySec: number, entryPrice18: bigint, silent = false): void {
    if (roundId !== this.state.roundId || !this.terms || !this.state.round || this.entryPrice18 !== null) return;
    this.entryPrice18 = entryPrice18;
    this.path.set(entrySec, entryPrice18);
    this.state.entryPrice = fromPrice18(entryPrice18);
    const barriers = barrierPrices(this.terms.direction, entryPrice18, this.terms.targetPpm, this.terms.stopPpm);
    this.deps.setLevels?.([fromPrice18(barriers.target), fromPrice18(barriers.stop)]);
    this.state.view = activeRoundView(this.state.round, entryPrice18, null, this.terms.endSec);
    this.setPhase('live');
    if (!silent) this.emit({ type: 'entry.locked', roundId, entrySec, entryPrice: this.state.entryPrice, view: this.state.view });
    this.armTimeUp();
    for (let sec = entrySec + 1; sec <= this.terms.endSec; sec++) {
      const checkpoint = this.path.get(sec);
      if (!checkpoint) break;
      this.evaluateSecond(sec, checkpoint.price18);
      if (this.state.touch) break;
    }
  }

  private evaluateSecond(sec: number, price18: bigint): void {
    const terms = this.terms;
    const round = this.state.round;
    const p0 = this.entryPrice18;
    const roundId = this.state.roundId;
    if (!terms || !round || p0 === null || roundId === null) return;
    if (sec <= terms.entrySec || sec > terms.endSec || this.state.touch) return;
    if (this.state.phase !== 'live' && this.state.phase !== 'cashing_out' && this.state.phase !== 'settling') return;

    const mark = markRound(terms, p0, price18, sec);
    this.state.mark = mark;
    this.state.view = activeRoundView(round, p0, mark, terms.endSec);
    this.emit({ type: 'mark', roundId, mark, view: this.state.view });

    const evaluation = this.path.evaluate(terms, Math.floor(this.serverNow() / 1000));
    if (!evaluation.decidable) return;
    if (evaluation.outcome === Outcome.TargetHit || evaluation.outcome === Outcome.StopHit) {
      const exit = evaluation.exitPrice ?? price18;
      this.recordTouch({
        kind: evaluation.outcome === Outcome.TargetHit ? 'target' : 'stop',
        sec: evaluation.decisionSec,
        price: fromPrice18(exit),
        source: 'local',
      });
    } else if (this.state.phase === 'live' || this.state.phase === 'cashing_out') {
      this.setPhase('settling');
    }
  }

  private recordTouch(touch: TouchInfo): void {
    const roundId = this.state.roundId;
    if (!roundId || this.state.touch) return;
    this.state.touch = touch;
    this.clearTimeUp();
    this.emit({ type: 'touch', roundId, touch });
    if (this.state.phase === 'live' || this.state.phase === 'cashing_out') this.setPhase('settling');
  }

  private onServerTouch(touch: SsePayload<'round.touch'>): void {
    if (touch.roundId !== this.state.roundId) return;
    this.recordTouch({ kind: touch.kind, sec: touch.sec, price: fromPrice18(touch.price), source: 'server' });
  }

  private onCashOutRequested(request: SsePayload<'round.cashout_requested'>): void {
    if (request.roundId !== this.state.roundId || !this.terms) return;
    this.terms = { ...this.terms, endSec: request.exitSec, cashOutRequested: true };
    this.state.endSec = request.exitSec;
    this.state.cashOut = 'requested';
    if (this.state.round) this.state.round = { ...this.state.round, cashOutRequested: true, exitSec: request.exitSec };
    if (this.state.view) this.state.view = { ...this.state.view, endSec: request.exitSec, cashOutRequested: true, exitSec: request.exitSec };
    this.emit({ type: 'cashout.requested', roundId: request.roundId, exitSec: request.exitSec, txHash: request.txHash });
    this.armTimeUp();
  }

  private onExitLocked(lock: SsePayload<'round.exit_locked'>): void {
    if (lock.roundId !== this.state.roundId) return;
    this.state.exitPrice = fromPrice18(lock.exitPrice);
    this.emit({ type: 'exit.locked', roundId: lock.roundId, exitSec: lock.exitSec, exitPrice: this.state.exitPrice });
    if (this.state.phase === 'live' || this.state.phase === 'cashing_out') this.setPhase('settling');
  }

  private onSettled(round: RoundDTO): void {
    if (this.finished.has(round.roundId)) return;
    if (round.roundId !== this.state.roundId) return;
    this.finishFromRound(round, true);
  }

  private onVoided(voided: SsePayload<'round.voided'>): void {
    if (this.finished.has(voided.roundId) || voided.roundId !== this.state.roundId || !this.state.round) return;
    const round: RoundDTO = {
      ...this.state.round,
      status: 'settled',
      outcome: 'voided',
      voidReason: voided.reason,
      payout: voided.payout,
      pnl: '0',
      exitPrice: null,
      settleTx: Hash32.safeParse(this.state.settleStep?.txHash).data ?? null,
      settledAtMs: this.serverNow(),
    };
    this.finishFromRound(round, true);
  }

  private finishFromRound(round: RoundDTO, markSeen: boolean): void {
    this.finished.add(round.roundId);
    this.clearTimers();
    this.deps.setLevels?.(null);
    const result = tradeResultFromRound(round, this.xpByRound.get(round.roundId) ?? 0);
    this.state.roundId = round.roundId;
    this.state.asset = round.asset;
    this.state.round = round;
    this.state.result = result;
    this.state.exitPrice = result.exitPrice;
    if (markSeen) this.markResultSeen(round.roundId);
    if (round.outcome === 'voided') {
      this.setPhase('voided');
      this.emit({ type: 'voided', roundId: round.roundId, result, reason: round.voidReason ?? 'stalled' });
    } else {
      this.setPhase('settled');
      this.emit({ type: 'settled', roundId: round.roundId, result, round });
    }
  }

  private onProgression(progression: ProgressionPayload): void {
    const roundId = progression.roundId;
    if (roundId !== null) {
      const xp = progression.gained.reduce((sum, entry) => sum + entry.amount, 0);
      this.xpByRound.set(roundId, xp);
      if (this.state.result && this.state.roundId === roundId) {
        this.state.result = { ...this.state.result, xpEarned: xp };
        this.emit({ type: 'result.updated', roundId, result: this.state.result });
      }
    }
    this.emit({ type: 'progression', roundId, progression });
  }

  private isPastEnd(): boolean {
    return this.state.endSec !== null && this.serverNow() >= this.state.endSec * 1000;
  }

  private armTimeUp(): void {
    this.clearTimeUp();
    const remaining = this.msUntilEnd();
    const roundId = this.state.roundId;
    if (remaining === null || roundId === null) return;
    this.timeUpTimer = setTimeout(() => {
      this.timeUpTimer = null;
      if (this.state.roundId !== roundId || this.state.touch) return;
      if (this.state.phase === 'live' || this.state.phase === 'cashing_out') {
        this.emit({ type: 'time.up', roundId });
        this.setPhase('settling');
      }
    }, Math.max(0, remaining));
  }

  private clearTimeUp(): void {
    if (this.timeUpTimer !== null) clearTimeout(this.timeUpTimer);
    this.timeUpTimer = null;
  }

  private clearLaunchTimer(): void {
    if (this.launchTimer !== null) clearTimeout(this.launchTimer);
    this.launchTimer = null;
  }

  private clearTimers(): void {
    this.clearLaunchTimer();
    this.clearTimeUp();
    if (this.entryPoll !== null) clearTimeout(this.entryPoll);
    this.entryPoll = null;
  }

  private resetState(): void {
    this.clearTimers();
    this.state = emptySnapshot();
    this.terms = null;
    this.entryPrice18 = null;
    this.path = new RecordedPath();
  }

  private setPhase(phase: RoundPhase): void {
    if (this.state.phase === phase) return;
    this.state.phase = phase;
    this.emit({ type: 'phase', phase, snapshot: this.getSnapshot() });
  }

  private emit(event: RoundEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

export interface FakeRoundServiceOptions {
  scenario?: FakeScenario;
  backend?: FakeBackend;
  signer?: IntentSigner;
  storage?: KeyValueStorage;
  setLevels?: (levels: readonly number[] | null) => void;
  launchTimeoutMs?: number;
}

export class FakeRoundService extends RoundService {
  readonly backend: FakeBackend;
  readonly signer: IntentSigner;

  constructor(options: FakeRoundServiceOptions = {}) {
    const backend = options.backend ?? new FakeBackend({ scenario: options.scenario });
    const signer = options.signer ?? createAccountSigner(privateKeyToAccount(generatePrivateKey()), 'guest');
    super({
      stream: backend.stream,
      api: backend.api,
      getSigner: () => signer,
      readNonce: backend.readNonce,
      storage: options.storage ?? createMemoryStorage(),
      setLevels: options.setLevels,
      launchTimeoutMs: options.launchTimeoutMs,
    });
    this.backend = backend;
    this.signer = signer;
    backend.stream.setPlayer(signer.address);
  }

  setScenario(scenario: FakeScenario): void {
    this.backend.setScenario(scenario);
  }
}

function createDefaultRoundService(): RoundService {
  const setLevels = (levels: readonly number[] | null) => marketFeed.setLevels(levels);
  if (isFakeMode()) {
    const backend = getFakeBackend();
    return new RoundService({
      stream: backend.stream,
      api: backend.api,
      getSigner: () => web3Service.getSigner(),
      readNonce: backend.readNonce,
      storage: browserStorage(),
      setLevels,
    });
  }
  return new RoundService({
    stream: getStream(),
    api: apiClient,
    getSigner: () => web3Service.getSigner(),
    ensureSession: (signer) => web3Service.ensureSession(signer),
    readNonce: (player, arena) => web3Service.readOpenNonce(player, arena),
    storage: browserStorage(),
    setLevels,
  });
}

export const roundService: RoundService = createDefaultRoundService();
