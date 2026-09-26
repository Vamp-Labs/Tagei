import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { ASSETS, assetBySymbol, type AssetSymbol } from '@bnbplay/shared/assets';
import { bscTestnet } from '@bnbplay/shared/chain';
import { CHAIN_ID, ENTRY_DELAY_SEC, EXIT_DELAY_SEC, PPM, STALL_AFTER_SEC } from '@bnbplay/shared/constants';
import type { ConfigDTO, RoundDTO } from '@bnbplay/shared/dto';
import { Direction, Outcome, outcomeLabel } from '@bnbplay/shared/enums';
import { packKeyedNonce } from '@bnbplay/shared/eip712';
import { barrierPrices, maxPayout as laneMaxPayout } from '@bnbplay/shared/lane';
import type { RoundTerms } from '@bnbplay/shared/path';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { CashOutRequest, OpenRoundRequest, RoundApi } from '../api/client';
import { ServerClock } from '../api/clock';
import type { FakeScenario } from '../api/env';
import { ApiError } from '../api/errors';
import { FakeStream } from '../api/fakeStream';
import { BASE_LANES, LANE_FEE_BPS, LANE_MAX_STAKE, LANE_MIN_STAKE, tierLabel } from '../game/lanes';
import { RecordedPath } from '../game/roundMath';
import { toPrice18 } from '../game/units';
import { SUPPORTED_ASSETS } from '../types/market';

export const FAKE_ARENA: Address = '0x00000000000000000000000000000000000A4e7a';
const FAKE_ORACLE: Address = '0x00000000000000000000000000000000000C4ec0';
const FAKE_TEST_USD: Address = '0x0000000000000000000000000000000000007e57';
const FAKE_FAUCET: Address = '0x000000000000000000000000000000000000fa0c';
const FAKE_LANE_VERSION = 1;
const FAKE_HISTORY = 120;
const STARTING_BALANCE = 100n * 10n ** 18n;
const FAKE_STALL_MS = 2_500;

export const FAKE_TIMINGS = {
  openPreparing: 100,
  openSigning: 250,
  openSubmitted: 700,
  openFailed: 1_600,
  openConfirmed: 1_500,
  roundOpened: 1_550,
  entryLocked: 1_200,
  touchNotice: 600,
  settleStart: 700,
  settleSubmitted: 900,
  settleConfirmed: 1_500,
  settled: 1_600,
  retryAfterFailure: 2_500,
  balance: 100,
  progression: 600,
  debrief: 1_000,
  cashoutRequested: 1_000,
  exitLocked: 1_200,
  timeoutSettle: EXIT_DELAY_SEC * 1_000,
} as const;

interface FakeRound {
  id: bigint;
  player: Address;
  asset: AssetSymbol;
  tier: number;
  terms: RoundTerms;
  originalEndSec: number;
  pairId: number;
  entryPrice: bigint | null;
  path: RecordedPath;
  status: 'open' | 'settled';
  exitSec: number | null;
  outcome: Outcome;
  payout: bigint | null;
  exitPrice: bigint | null;
  decisionSec: number | null;
  voidReason: RoundDTO['voidReason'];
  openTx: Hex;
  settleTx: Hex | null;
  openedAtMs: number;
  settledAtMs: number | null;
  scenario: FakeScenario;
  deciding: boolean;
}

export interface FakeBackendOptions {
  scenario?: FakeScenario;
  clock?: ServerClock;
  random?: () => number;
  now?: () => number;
  autoPrices?: boolean;
}

export class FakeBackend {
  readonly stream: FakeStream;
  readonly api: RoundApi;
  private scenario: FakeScenario;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly autoPrices: boolean;
  private readonly prices = new Map<AssetSymbol, bigint>();
  private readonly history = new Map<AssetSymbol, [string, number, string][]>();
  private readonly rounds = new Map<string, FakeRound>();
  private readonly balances = new Map<string, bigint>();
  private readonly nonces = new Map<string, bigint>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private priceTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private lastSec = 0;
  private resumed = new Set<string>();
  private xp = 120;

  constructor(options: FakeBackendOptions = {}) {
    this.scenario = options.scenario ?? 'win';
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.autoPrices = options.autoPrices ?? true;
    this.stream = new FakeStream({
      clock: options.clock,
      onRetain: () => this.connect(),
      onRelease: () => this.stopPrices(),
      onPlayer: () => {
        if (this.stream.refCount() > 0) this.sendHello();
      },
    });
    for (const asset of ASSETS) this.prices.set(asset.symbol, toPrice18(SUPPORTED_ASSETS[asset.symbol].basePrice));
    this.seedHistory();
    this.api = {
      config: async () => this.config(),
      openRound: async (request) => this.openRound(request),
      cashOut: async (roundId, request) => this.cashOut(roundId, request),
      round: async (roundId) => this.roundDTO(this.requireRound(roundId)),
      playerRounds: async (address) => ({
        items: [...this.rounds.values()].filter((round) => sameAddress(round.player, address)).map((round) => this.roundDTO(round)).reverse(),
        nextCursor: null,
      }),
    };
  }

  setScenario(scenario: FakeScenario): void {
    this.scenario = scenario;
  }

  getScenario(): FakeScenario {
    return this.scenario;
  }

  readNonce = async (player: Address): Promise<bigint> => this.nonces.get(player.toLowerCase()) ?? packKeyedNonce(0n, 0n);

  balanceOf(player: string): bigint {
    return this.balances.get(player.toLowerCase()) ?? STARTING_BALANCE;
  }

  priceOf(asset: AssetSymbol): bigint {
    return this.prices.get(asset) ?? 0n;
  }

  dispose(): void {
    this.stopPrices();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  tickSecond(sec: number = Math.floor(this.now() / 1000)): void {
    if (sec <= this.lastSec) return;
    this.lastSec = sec;
    for (const asset of ASSETS) {
      const active = [...this.rounds.values()].find((round) => round.asset === asset.symbol && round.status === 'open');
      const price = active ? this.scriptedPrice(active, sec) : this.walk(asset.symbol);
      this.prices.set(asset.symbol, price);
      const tuple: [string, number, string] = [String(sec * 1000), sec * 1000 + 300, price.toString()];
      const series = this.history.get(asset.symbol) ?? [];
      series.push(tuple);
      if (series.length > FAKE_HISTORY) series.shift();
      this.history.set(asset.symbol, series);
      this.stream.emit('price', { asset: asset.symbol, pairId: asset.supraPairId, round: tuple[0], tsMs: tuple[1], price: tuple[2], lagMs: 300 });
      if (active) this.onRecorded(active, sec, price);
    }
  }

  private connect(): void {
    this.sendHello();
    this.stream.emit('prices.snapshot', {
      assets: Object.fromEntries(
        ASSETS.map((asset) => [asset.symbol, { pairId: asset.supraPairId, rounds: this.history.get(asset.symbol) ?? [] }]),
      ),
      stats: Object.fromEntries(
        ASSETS.map((asset) => [asset.symbol, { open24h: null, change24hPct: Math.round((this.random() * 6 - 3) * 100) / 100, high24h: null, low24h: null }]),
      ),
    });
    if (this.autoPrices) this.schedulePrices();
  }

  private schedulePrices(): void {
    if (this.priceTimer !== null) return;
    const delay = 1000 - (this.now() % 1000) + 5;
    this.priceTimer = setTimeout(() => {
      this.priceTimer = null;
      this.tickSecond();
      if (this.stream.refCount() > 0) this.schedulePrices();
    }, delay);
  }

  private stopPrices(): void {
    if (this.priceTimer !== null) clearTimeout(this.priceTimer);
    this.priceTimer = null;
  }

  private sendHello(): void {
    const player = this.stream.player();
    this.stream.emit('hello', {
      v: 1,
      serverTimeMs: this.now(),
      oracle: { source: 'supra-dora2', status: 'ok', lagMsP50: 450 },
      player: player ? this.playerState(getAddress(player)) : null,
    });
  }

  private playerState(player: Address): NonNullable<SsePayload<'hello'>['player']> {
    const key = player.toLowerCase();
    if (!this.resumed.has(key)) {
      this.resumed.add(key);
      this.createResumeRound(player);
    }
    const mine = [...this.rounds.values()].filter((round) => sameAddress(round.player, player));
    const active = mine.find((round) => round.status === 'open') ?? null;
    const settled = mine.filter((round) => round.status === 'settled').sort((a, b) => (b.settledAtMs ?? 0) - (a.settledAtMs ?? 0))[0] ?? null;
    return { activeRound: active ? this.roundDTO(active) : null, lastSettled: settled ? this.roundDTO(settled) : null };
  }

  private createResumeRound(player: Address): void {
    const nowSec = Math.floor(this.now() / 1000);
    if (this.scenario === 'resume_live') {
      this.createOpenRound(player, 'BNB', 0, Direction.Long, 10n * 10n ** 18n, nowSec - 8, 'timeout', true);
    } else if (this.scenario === 'resume_settling') {
      const round = this.createOpenRound(player, 'BNB', 0, Direction.Long, 10n * 10n ** 18n, nowSec - 33, 'timeout', true);
      this.later(1_500, () => this.decide(round, round.terms.endSec));
    } else if (this.scenario === 'resume_result') {
      const round = this.createOpenRound(player, 'BNB', 0, Direction.Long, 10n * 10n ** 18n, nowSec - 120, 'win', true);
      const evaluation = round.path.evaluate(round.terms, nowSec);
      if (evaluation.decidable) this.applyEvaluation(round, evaluation.outcome, evaluation.payout, evaluation.decisionSec, evaluation.exitPrice);
      round.settleTx = this.hash('settle', round.id);
      round.settledAtMs = this.now() - 60_000;
    }
  }

  private createOpenRound(
    player: Address,
    asset: AssetSymbol,
    tier: number,
    direction: Direction,
    stake: bigint,
    entrySec: number,
    scenario: FakeScenario,
    backfill: boolean,
  ): FakeRound {
    const lane = BASE_LANES[asset].tiers.find((entry) => entry.tier === tier);
    if (!lane || !lane.enabled) throw new ApiError('TIER_DISABLED', `${asset} ${tierLabel(tier)} is not enabled.`);
    const id = BigInt(++this.sequence);
    const terms: RoundTerms = {
      direction,
      stake,
      maxPayout: laneMaxPayout(stake, lane.multiplierBps),
      entrySec,
      endSec: entrySec + 30,
      targetPpm: lane.targetPpm,
      stopPpm: lane.stopPpm,
      multiplierBps: lane.multiplierBps,
      feeBps: LANE_FEE_BPS,
      maxJumpPpm: BASE_LANES[asset].maxJumpPpm,
      cashOutRequested: false,
    };
    const round: FakeRound = {
      id,
      player,
      asset,
      tier,
      terms,
      originalEndSec: terms.endSec,
      pairId: assetBySymbol(asset).supraPairId,
      entryPrice: null,
      path: new RecordedPath(),
      status: 'open',
      exitSec: null,
      outcome: Outcome.None,
      payout: null,
      exitPrice: null,
      decisionSec: null,
      voidReason: null,
      openTx: this.hash('open', id),
      settleTx: null,
      openedAtMs: (entrySec - ENTRY_DELAY_SEC) * 1000,
      settledAtMs: null,
      scenario,
      deciding: false,
    };
    this.rounds.set(id.toString(), round);
    if (backfill) {
      const nowSec = Math.floor(this.now() / 1000);
      const p0 = this.priceOf(asset);
      round.entryPrice = p0;
      round.path.set(entrySec, p0);
      for (let sec = entrySec + 1; sec <= Math.min(nowSec, terms.endSec); sec++) round.path.set(sec, this.scriptedPrice(round, sec));
      this.lastSec = Math.max(this.lastSec, nowSec);
    }
    return round;
  }

  private config(): ConfigDTO {
    return {
      chainId: CHAIN_ID,
      explorer: bscTestnet.explorer,
      contracts: { arena: FAKE_ARENA, checkpointOracle: FAKE_ORACLE, testUsd: FAKE_TEST_USD, faucet: FAKE_FAUCET },
      activeOracleIdx: 0,
      oracleTrusted: false,
      stakeDecimals: 18,
      priceDecimals: 18,
      entryDelaySec: ENTRY_DELAY_SEC,
      exitDelaySec: EXIT_DELAY_SEC,
      stallAfterSec: STALL_AFTER_SEC,
      assets: ASSETS.map((asset) => ({
        assetId: asset.assetId,
        symbol: asset.symbol,
        pairId: asset.supraPairId,
        maxJumpPpm: BASE_LANES[asset.symbol].maxJumpPpm,
        gapMarginPpm: BASE_LANES[asset.symbol].gapMarginPpm,
        enabled: true,
        tiers: BASE_LANES[asset.symbol].tiers.map((lane) => ({
          tier: lane.tier,
          label: tierLabel(lane.tier),
          laneVersion: FAKE_LANE_VERSION,
          multiplierBps: lane.multiplierBps,
          targetPpm: lane.targetPpm,
          stopPpm: lane.stopPpm,
          feeBps: LANE_FEE_BPS,
          durationSec: 30,
          minStake: LANE_MIN_STAKE.toString(),
          maxStake: LANE_MAX_STAKE.toString(),
          enabled: lane.enabled,
        })),
      })),
      features: { pixLlm: false, faucet: true, walletConnect: false },
    };
  }

  private openRound(request: OpenRoundRequest): { intentId: string; intentHash: string } {
    const { intent } = request;
    const player = getAddress(intent.player);
    const stream = this.stream.player();
    if (stream && !sameAddress(stream, player)) throw new ApiError('BAD_SIGNATURE', 'The intent player does not match the session.');
    if ([...this.rounds.values()].some((round) => sameAddress(round.player, player) && round.status === 'open')) {
      throw new ApiError('ROUND_ALREADY_ACTIVE', 'You already have a round in flight.');
    }
    if (intent.laneVersion !== FAKE_LANE_VERSION) throw new ApiError('LANE_VERSION_MISMATCH', 'Lane parameters changed. Refresh and sign again.');
    const stake = BigInt(intent.stake);
    if (stake < LANE_MIN_STAKE || stake > LANE_MAX_STAKE) throw new ApiError('VALIDATION', 'Stake is outside the lane bounds.');
    if (stake > this.balanceOf(player)) throw new ApiError('INSUFFICIENT_CREDITS', 'Not enough test credits.');
    const asset = ASSETS.find((entry) => entry.assetId === intent.assetId);
    if (!asset) throw new ApiError('VALIDATION', 'Unknown asset.');
    const lane = BASE_LANES[asset.symbol].tiers.find((entry) => entry.tier === intent.tier);
    if (!lane || !lane.enabled) throw new ApiError('TIER_DISABLED', 'This tier is not enabled yet.');

    const intentId = `fake-intent-${++this.sequence}`;
    const scenario = this.scenario;
    const openStep = (step: SsePayload<'settlement.step'>['step'], txHash: Hex | null, error: SsePayload<'settlement.step'>['error'] = null) =>
      this.stream.emit('settlement.step', { kind: 'open', intentId, roundId: null, step, txHash, error });
    const openTx = this.hash('open-tx', BigInt(this.sequence));

    this.later(FAKE_TIMINGS.openPreparing, () => openStep('preparing', null));
    this.later(FAKE_TIMINGS.openSigning, () => openStep('signing', null));
    this.later(FAKE_TIMINGS.openSubmitted, () => openStep('submitted', openTx));
    if (scenario === 'open_failure') {
      this.later(FAKE_TIMINGS.openFailed, () => {
        openStep('failed', openTx, { code: 'INTERNAL', message: 'Simulated relayer failure' });
        this.stream.emit('round.open_failed', { intentId, code: 'INTERNAL', message: 'Simulated relayer failure', stakeTaken: false });
      });
      return { intentId, intentHash: this.hash('intent', BigInt(this.sequence)) };
    }
    this.later(FAKE_TIMINGS.openConfirmed, () => openStep('confirmed', openTx));
    this.later(FAKE_TIMINGS.roundOpened, () => {
      const entrySec = Math.floor(this.now() / 1000) + ENTRY_DELAY_SEC - 1;
      const round = this.createOpenRound(player, asset.symbol, intent.tier, intent.direction === 0 ? Direction.Long : Direction.Short, stake, entrySec, scenario, false);
      round.openTx = openTx;
      round.openedAtMs = this.now();
      this.nonces.set(player.toLowerCase(), BigInt(intent.nonce) + 1n);
      this.balances.set(player.toLowerCase(), this.balanceOf(player) - stake);
      this.stream.emit('round.opened', this.roundDTO(round));
      this.emitBalance(player);
    });
    return { intentId, intentHash: this.hash('intent', BigInt(this.sequence)) };
  }

  private cashOut(roundId: string, request: CashOutRequest): { intentId: string } {
    const round = this.requireRound(roundId);
    if (!sameAddress(round.player, request.intent.player)) throw new ApiError('BAD_SIGNATURE', 'Only the round player can cash out.');
    if (round.status !== 'open' || round.entryPrice === null) throw new ApiError('ROUND_NOT_FOUND', 'The round is not live.');
    if (round.terms.cashOutRequested) throw new ApiError('VALIDATION', 'Cash-out already requested.');
    const nowSec = Math.floor(this.now() / 1000);
    const exitSec = Math.max(nowSec + EXIT_DELAY_SEC, round.terms.entrySec + 1);
    if (exitSec >= round.terms.endSec || round.deciding) throw new ApiError('CASHOUT_TOO_LATE', 'Round ending — settling at the final price.');
    const intentId = `fake-cashout-${++this.sequence}`;
    const txHash = this.hash('cashout', round.id);
    this.later(200, () => this.stream.emit('settlement.step', { kind: 'cashout', intentId, roundId, step: 'submitted', txHash, error: null }));
    this.later(FAKE_TIMINGS.cashoutRequested, () => {
      if (round.status !== 'open' || round.deciding) return;
      round.terms = { ...round.terms, endSec: exitSec, cashOutRequested: true };
      round.exitSec = exitSec;
      this.stream.emit('settlement.step', { kind: 'cashout', intentId, roundId, step: 'confirmed', txHash, error: null });
      this.stream.emit('round.cashout_requested', { roundId, exitSec, txHash });
    });
    return { intentId };
  }

  private onRecorded(round: FakeRound, sec: number, price: bigint): void {
    if (sec < round.terms.entrySec || round.deciding) return;
    if (!round.path.set(sec, price)) return;
    const roundId = round.id.toString();
    if (sec === round.terms.entrySec) {
      round.entryPrice = price;
      this.later(FAKE_TIMINGS.entryLocked, () => this.stream.emit('round.entry_locked', { roundId, entrySec: sec, entryPrice: price.toString() }));
      return;
    }
    if (round.exitSec !== null && sec === round.exitSec) {
      this.later(FAKE_TIMINGS.exitLocked, () => this.stream.emit('round.exit_locked', { roundId, exitSec: sec, exitPrice: price.toString() }));
    }
    if (round.scenario === 'void' && sec >= round.terms.endSec) {
      round.deciding = true;
      this.later(FAKE_STALL_MS, () => this.voidRound(round));
      return;
    }
    const evaluation = round.path.evaluate(round.terms, sec);
    if (evaluation.decidable) this.decide(round, sec);
  }

  private decide(round: FakeRound, sec: number): void {
    if (round.deciding) return;
    const evaluation = round.path.evaluate(round.terms, sec);
    if (!evaluation.decidable) return;
    round.deciding = true;
    const roundId = round.id.toString();
    const touched = evaluation.outcome === Outcome.TargetHit || evaluation.outcome === Outcome.StopHit;
    if (touched && round.entryPrice !== null && evaluation.exitPrice !== null) {
      const barriers = barrierPrices(round.terms.direction, round.entryPrice, round.terms.targetPpm, round.terms.stopPpm);
      const kind = evaluation.outcome === Outcome.TargetHit ? 'target' : 'stop';
      const exitPrice = evaluation.exitPrice;
      this.later(FAKE_TIMINGS.touchNotice, () =>
        this.stream.emit('round.touch', {
          roundId,
          kind,
          sec: evaluation.decisionSec,
          price: exitPrice.toString(),
          thresholdPrice: (kind === 'target' ? barriers.target : barriers.stop).toString(),
        }),
      );
    }
    const base = touched ? FAKE_TIMINGS.touchNotice : round.terms.cashOutRequested ? FAKE_TIMINGS.exitLocked : FAKE_TIMINGS.timeoutSettle;
    const settle = () => this.settleSequence(round, base, () => this.applyEvaluation(round, evaluation.outcome, evaluation.payout, evaluation.decisionSec, evaluation.exitPrice));
    if (round.scenario === 'settle_failure') {
      const txHash = this.hash('settle-failed', round.id);
      this.later(base + FAKE_TIMINGS.settleStart, () => this.settleStep(round, 'preparing', null));
      this.later(base + FAKE_TIMINGS.settleSubmitted, () => this.settleStep(round, 'submitted', txHash));
      this.later(base + FAKE_TIMINGS.settleConfirmed, () =>
        this.settleStep(round, 'failed', txHash, { code: 'INTERNAL', message: 'Simulated settlement revert' }),
      );
      this.later(base + FAKE_TIMINGS.settleConfirmed + FAKE_TIMINGS.retryAfterFailure, () => {
        round.scenario = 'timeout';
        settle();
      });
      return;
    }
    settle();
  }

  private settleSequence(round: FakeRound, offset: number, apply: () => void): void {
    const txHash = this.hash('settle', round.id);
    this.later(offset + FAKE_TIMINGS.settleStart, () => this.settleStep(round, 'preparing', null));
    this.later(offset + FAKE_TIMINGS.settleSubmitted, () => this.settleStep(round, 'submitted', txHash));
    this.later(offset + FAKE_TIMINGS.settleConfirmed, () => this.settleStep(round, 'confirmed', txHash));
    this.later(offset + FAKE_TIMINGS.settled, () => {
      apply();
      round.settleTx = txHash;
      round.settledAtMs = this.now();
      this.stream.emit('round.settled', this.roundDTO(round));
      this.later(FAKE_TIMINGS.balance, () => this.emitBalance(round.player));
      this.later(FAKE_TIMINGS.progression, () => this.emitProgression(round));
      this.later(FAKE_TIMINGS.debrief, () => this.emitDebrief(round));
    });
  }

  private voidRound(round: FakeRound): void {
    const roundId = round.id.toString();
    const txHash = this.hash('void', round.id);
    this.stream.emit('settlement.step', { kind: 'void', intentId: null, roundId, step: 'submitted', txHash, error: null });
    this.later(FAKE_TIMINGS.settleConfirmed, () => {
      round.status = 'settled';
      round.outcome = Outcome.Voided;
      round.voidReason = 'stalled';
      round.payout = round.terms.stake;
      round.exitPrice = null;
      round.decisionSec = round.terms.endSec;
      round.settleTx = txHash;
      round.settledAtMs = this.now();
      this.balances.set(round.player.toLowerCase(), this.balanceOf(round.player) + round.terms.stake);
      this.stream.emit('settlement.step', { kind: 'void', intentId: null, roundId, step: 'confirmed', txHash, error: null });
      this.stream.emit('round.voided', { roundId, reason: 'stalled', payout: round.terms.stake.toString() });
      this.stream.emit('round.settled', this.roundDTO(round));
      this.later(FAKE_TIMINGS.balance, () => this.emitBalance(round.player));
    });
  }

  private applyEvaluation(round: FakeRound, outcome: Outcome, payout: bigint, decisionSec: number, exitPrice: bigint | null): void {
    round.status = 'settled';
    round.outcome = outcome;
    round.payout = payout;
    round.decisionSec = decisionSec;
    round.exitPrice = exitPrice;
    this.balances.set(round.player.toLowerCase(), this.balanceOf(round.player) + payout);
  }

  private settleStep(round: FakeRound, step: SsePayload<'settlement.step'>['step'], txHash: Hex | null, error: SsePayload<'settlement.step'>['error'] = null): void {
    this.stream.emit('settlement.step', { kind: 'settle', intentId: null, roundId: round.id.toString(), step, txHash, error });
  }

  private emitBalance(player: Address): void {
    this.stream.emit('balance', { available: this.balanceOf(player).toString(), locked: this.lockedOf(player).toString() });
  }

  private lockedOf(player: Address): bigint {
    return [...this.rounds.values()]
      .filter((round) => sameAddress(round.player, player) && round.status === 'open')
      .reduce((sum, round) => sum + round.terms.stake, 0n);
  }

  private emitProgression(round: FakeRound): void {
    const gained = [{ reason: 'round_complete', amount: 20 }, ...(round.outcome === Outcome.TargetHit ? [{ reason: 'target_hit', amount: 15 }] : [])];
    const xpBefore = this.xp;
    this.xp += gained.reduce((sum, entry) => sum + entry.amount, 0);
    this.stream.emit('progression.updated', {
      roundId: round.id.toString(),
      xpBefore,
      xpAfter: this.xp,
      gained,
      level: 3,
      title: 'NAVIGATOR',
      levelStartXp: 100,
      nextLevelXp: 180,
      leveledUp: xpBefore < 180 && this.xp >= 180,
      missions: [{ id: 'fly_3', title: 'Fly 3 rounds', progress: 1, goal: 3, xp: 50, completed: false }],
      missionJustCompleted: null,
      streakDays: 1,
      badgesUnlocked: [],
    });
  }

  private emitDebrief(round: FakeRound): void {
    const label = outcomeLabel(round.outcome) ?? 'timeout';
    this.stream.emit('pix.debrief', {
      roundId: round.id.toString(),
      debrief: {
        headline: label === 'win' ? 'Target reached cleanly' : 'Round complete',
        analysis: 'Scripted practice debrief from the fake backend.',
        keyFactors: [{ label: 'Outcome', value: label }],
        coachingTip: 'Size every round the same and review the path, not just the result.',
        source: 'template',
      },
    });
  }

  private scriptedPrice(round: FakeRound, sec: number): bigint {
    const p0 = round.entryPrice ?? this.priceOf(round.asset);
    if (sec <= round.terms.entrySec) return this.walk(round.asset);
    const k = sec - round.terms.entrySec;
    const { targetPpm, stopPpm } = round.terms;
    const noise = (this.random() - 0.5) * 0.08;
    let favourablePpm: number;
    switch (round.scenario) {
      case 'win':
        favourablePpm = targetPpm * Math.min(1.2, k / 8 + noise);
        break;
      case 'loss':
        favourablePpm = -stopPpm * Math.min(1.2, k / 9 + noise);
        break;
      case 'cashout':
        favourablePpm = targetPpm * Math.min(0.6, 0.06 * k + noise);
        break;
      default:
        favourablePpm = targetPpm * (0.35 * Math.sin(k / 3) + noise);
        break;
    }
    const signed = round.terms.direction === Direction.Long ? favourablePpm : -favourablePpm;
    return (p0 * (PPM + BigInt(Math.round(signed)))) / PPM;
  }

  private walk(asset: AssetSymbol): bigint {
    const price = this.priceOf(asset);
    const sigma = BASE_LANES[asset].sigma1sPpm;
    const stepPpm = Math.round((this.random() - 0.5) * 2 * sigma * 1.7);
    return (price * (PPM + BigInt(stepPpm))) / PPM;
  }

  private seedHistory(): void {
    const nowSec = Math.floor(this.now() / 1000);
    for (const asset of ASSETS) {
      const series: [string, number, string][] = [];
      for (let sec = nowSec - FAKE_HISTORY + 1; sec <= nowSec; sec++) {
        const price = this.walk(asset.symbol);
        this.prices.set(asset.symbol, price);
        series.push([String(sec * 1000), sec * 1000 + 300, price.toString()]);
      }
      this.history.set(asset.symbol, series);
    }
    this.lastSec = nowSec;
  }

  private roundDTO(round: FakeRound): RoundDTO {
    const terms = round.terms;
    const payout = round.payout;
    return {
      roundId: round.id.toString(),
      player: round.player,
      assetId: assetBySymbol(round.asset).assetId,
      asset: round.asset,
      status: round.status,
      terms: {
        tier: round.tier,
        direction: terms.direction === Direction.Long ? 'LONG' : 'SHORT',
        stake: terms.stake.toString(),
        maxPayout: terms.maxPayout.toString(),
        entrySec: terms.entrySec,
        endSec: round.originalEndSec,
        laneVersion: FAKE_LANE_VERSION,
        oracleIdx: 0,
        pairId: round.pairId,
        targetPpm: terms.targetPpm,
        stopPpm: terms.stopPpm,
        multiplierBps: terms.multiplierBps,
        feeBps: terms.feeBps,
        maxJumpPpm: terms.maxJumpPpm,
      },
      entryPrice: round.entryPrice?.toString() ?? null,
      cashOutRequested: terms.cashOutRequested,
      exitSec: round.exitSec,
      outcome: outcomeLabel(round.outcome),
      voidReason: round.voidReason,
      payout: payout?.toString() ?? null,
      pnl: payout === null ? null : (payout - terms.stake).toString(),
      exitPrice: round.exitPrice?.toString() ?? null,
      decisionSec: round.decisionSec,
      openTx: round.openTx,
      settleTx: round.settleTx,
      openedAtMs: round.openedAtMs,
      settledAtMs: round.settledAtMs,
    };
  }

  private requireRound(roundId: string): FakeRound {
    const round = this.rounds.get(roundId);
    if (!round) throw new ApiError('ROUND_NOT_FOUND', `Round ${roundId} not found.`, { status: 404 });
    return round;
  }

  private later(ms: number, task: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      task();
    }, ms);
    this.timers.add(timer);
  }

  private hash(label: string, id: bigint): Hex {
    return keccak256(stringToHex(`bnbplay-fake:${label}:${id}:${this.sequence}`));
  }
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
