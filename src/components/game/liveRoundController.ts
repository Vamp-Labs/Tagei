import type { AssetSymbol } from '../../types/market';
import type { ActiveTradeRound, GameStage, PositionDirection, TradeResult } from '../../types/game';
import type { SettlementStep } from '../../services/web3Service';
import {
  LAUNCH_NOT_CONFIRMED_COPY,
  type LaunchParams,
  type ProgressionPayload,
  type RoundEvent,
  type RoundPhase,
  type RoundService,
  type RoundSnapshot,
  type TouchInfo,
} from '../../services/roundService';
import { splitNotice, targetPayout } from './roundDisplay';

export type LaunchPhase = 'locking' | 'charging' | 'liftoff';

export const LAUNCH_MIN_MS: Record<LaunchPhase, number> = { locking: 280, charging: 270, liftoff: 230 };
export const IMPACT_BEAT_MS = { target: 1_100, stop: 700 } as const;
export const SETTLE_MIN_MS = 600;
export const EXIT_LOCK_HOLD_MS = 700;
export const XP_WAIT_MS = 4_000;

const sentence = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

const PHASE_ORDER: Record<LaunchPhase, number> = { locking: 0, charging: 1, liftoff: 2 };

export interface LaunchView {
  phase: LaunchPhase;
  asset: AssetSymbol;
  direction: PositionDirection;
  predictedEntry: number | null;
  entryPrice: number | null;
  opened: boolean;
  startedAtMs: number;
}

export type SettleReason = 'target' | 'stop' | 'time' | 'exit' | null;

export interface SettlementView {
  step: SettlementStep;
  txHash: string;
  failed: boolean;
  reason: SettleReason;
}

export type CashOutPhase = 'none' | 'pending' | 'requested' | 'locked';

export interface CashOutView {
  phase: CashOutPhase;
  snapshotPnl: number | null;
  snapshotPrice: number | null;
  exitPrice: number | null;
}

export interface XpView {
  before: number;
  after: number;
  gained: number;
  leveledUp: boolean;
}

export interface Notice {
  id: number;
  title: string;
  body: string;
}

export interface LiveView {
  stage: GameStage | null;
  launch: LaunchView | null;
  round: ActiveTradeRound | null;
  progressPct: number;
  cashOut: CashOutView;
  settlement: SettlementView;
  result: TradeResult | null;
  xp: XpView | null;
  xpPending: boolean;
  notice: Notice | null;
}

const NO_CASH_OUT: CashOutView = { phase: 'none', snapshotPnl: null, snapshotPrice: null, exitPrice: null };
const NO_SETTLEMENT: SettlementView = { step: 'idle', txHash: '', failed: false, reason: null };

export const IDLE_LIVE_VIEW: LiveView = {
  stage: null,
  launch: null,
  round: null,
  progressPct: 0,
  cashOut: NO_CASH_OUT,
  settlement: NO_SETTLEMENT,
  result: null,
  xp: null,
  xpPending: false,
  notice: null,
};

export type RoundServiceLike = Pick<RoundService, 'subscribe' | 'launch' | 'cashOut' | 'reset'>;

export interface ResumeInfo {
  asset: AssetSymbol;
  direction: PositionDirection | null;
}

export interface LiveRoundControllerOptions {
  now?: () => number;
  onProgression?: (progression: ProgressionPayload) => void;
  onResume?: (info: ResumeInfo) => void;
}

type Timer = ReturnType<typeof setTimeout>;
type DeferredEvent = Extract<RoundEvent, { type: 'touch' | 'time.up' | 'exit.locked' }>;

export class LiveRoundController {
  private readonly service: RoundServiceLike;
  private readonly now: () => number;
  private readonly onProgression?: (progression: ProgressionPayload) => void;
  private readonly onResume?: (info: ResumeInfo) => void;
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Set<Timer>();
  private view: LiveView = IDLE_LIVE_VIEW;
  private off: (() => void) | null = null;
  private launchTimer: Timer | null = null;
  private targetPhase: LaunchPhase = 'locking';
  private phaseSince = 0;
  private stageSince = 0;
  private lockedRound: ActiveTradeRound | null = null;
  private lockedProgress = 0;
  private deferred: DeferredEvent[] = [];
  private pendingResult: TradeResult | null = null;
  private readonly xpByRound = new Map<string, XpView>();
  private noticeId = 0;

  constructor(service: RoundServiceLike, options: LiveRoundControllerOptions = {}) {
    this.service = service;
    this.now = options.now ?? (() => Date.now());
    this.onProgression = options.onProgression;
    this.onResume = options.onResume;
  }

  start(): void {
    this.off ??= this.service.subscribe((event) => this.handle(event));
  }

  stop(): void {
    this.off?.();
    this.off = null;
    this.clearTimers();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getView = (): LiveView => this.view;

  isBusy(): boolean {
    return this.view.stage !== null;
  }

  async launch(params: LaunchParams, predictedEntry: number | null): Promise<void> {
    if (this.view.stage !== null) return;
    this.clearTimers();
    this.resetRoundState();
    const now = this.now();
    this.phaseSince = now;
    this.stageSince = now;
    this.targetPhase = 'locking';
    this.set({
      ...IDLE_LIVE_VIEW,
      stage: 'LAUNCHING',
      launch: {
        phase: 'locking',
        asset: params.asset,
        direction: params.direction,
        predictedEntry,
        entryPrice: null,
        opened: false,
        startedAtMs: now,
      },
    });
    const outcome = await this.service.launch(params);
    if (!outcome.ok && this.view.stage === 'LAUNCHING' && this.view.launch && !this.view.launch.opened) {
      this.failLaunch(outcome.message);
    }
  }

  async cashOut(): Promise<void> {
    if (this.view.stage !== 'LIVE_TRADE' || this.view.cashOut.phase !== 'none') return;
    const outcome = await this.service.cashOut();
    if (!outcome.ok && this.view.cashOut.phase === 'none' && this.view.stage === 'LIVE_TRADE') {
      this.notify('CASH-OUT NOT SENT', outcome.message);
    }
  }

  acknowledge(): void {
    if (this.view.stage !== 'RESULT') return;
    this.clearTimers();
    this.service.reset();
    this.resetRoundState();
    this.set({ ...IDLE_LIVE_VIEW });
  }

  dismissNotice(id: number): void {
    if (this.view.notice?.id === id) this.set({ ...this.view, notice: null });
  }

  private handle(event: RoundEvent): void {
    switch (event.type) {
      case 'phase':
        this.onPhase(event.phase);
        return;
      case 'launch.failed':
        if (this.view.stage === 'LAUNCHING') this.failLaunch(event.message);
        return;
      case 'round.opened':
        this.patchLaunch({ opened: true });
        this.requestLaunchPhase('charging');
        return;
      case 'entry.locked':
        this.onEntryLocked(event.view, event.entryPrice);
        return;
      case 'mark':
        this.onMark(event.view, event.mark.progressPct);
        return;
      case 'touch':
      case 'time.up':
      case 'exit.locked':
        if (this.view.stage === 'LAUNCHING') this.deferred.push(event);
        else this.applyRoundEvent(event);
        return;
      case 'cashout.pending': {
        const round = this.view.round;
        this.set({
          ...this.view,
          cashOut: {
            phase: 'pending',
            snapshotPnl: event.snapshot?.pnl ?? round?.currentPnl ?? null,
            snapshotPrice: event.snapshot?.price ?? round?.currentPrice ?? null,
            exitPrice: null,
          },
        });
        return;
      }
      case 'cashout.requested': {
        const round = this.view.round;
        this.set({
          ...this.view,
          round: round ? { ...round, endSec: event.exitSec, exitSec: event.exitSec, cashOutRequested: true } : round,
          cashOut: { ...this.view.cashOut, phase: 'requested' },
        });
        return;
      }
      case 'cashout.rejected':
        this.set({ ...this.view, cashOut: NO_CASH_OUT });
        this.notify('CASH-OUT NOT TAKEN', event.message);
        return;
      case 'settle.step': {
        const failed = event.step === 'failed';
        this.set({
          ...this.view,
          settlement: { ...this.view.settlement, step: event.step, txHash: event.txHash ?? this.view.settlement.txHash, failed },
        });
        return;
      }
      case 'settled':
      case 'voided':
        if (this.view.stage === null || this.view.stage === 'RESULT') return;
        this.pendingResult = event.result;
        this.tryFinish();
        return;
      case 'result.updated':
        this.onResultUpdated(event.result);
        return;
      case 'progression':
        this.onProgressionEvent(event.roundId, event.progression);
        return;
      case 'resume':
        this.onResumeEvent(event.target, event.snapshot);
        return;
      default:
        return;
    }
  }

  private onPhase(phase: RoundPhase): void {
    if (phase === 'charging' || phase === 'opened') {
      if (phase === 'opened') this.patchLaunch({ opened: true });
      this.requestLaunchPhase('charging');
      return;
    }
    if (phase === 'settle_failed') {
      this.set({ ...this.view, settlement: { ...this.view.settlement, failed: true } });
      return;
    }
    if (phase === 'settling') {
      if (this.view.stage === 'LAUNCHING') return;
      if (this.view.stage === 'LIVE_TRADE' && this.view.cashOut.phase === 'none') this.enterSettling(this.view.settlement.reason);
    }
  }

  private onEntryLocked(round: ActiveTradeRound, entryPrice: number): void {
    this.lockedRound = round;
    this.lockedProgress = 0;
    if (this.view.stage === 'LAUNCHING') {
      this.patchLaunch({ entryPrice });
      this.requestLaunchPhase('liftoff');
      return;
    }
    if (this.view.stage === null) this.goLive(round, 0);
  }

  private onMark(round: ActiveTradeRound, progressPct: number): void {
    if (this.view.stage === 'LAUNCHING') {
      this.lockedRound = round;
      this.lockedProgress = progressPct;
      return;
    }
    const stage = this.view.stage;
    if ((stage !== 'LIVE_TRADE' && stage !== 'SETTLING') || !this.view.round || this.view.round.roundId !== round.roundId) return;
    const current = this.view.round;
    this.set({
      ...this.view,
      round: { ...round, endSec: current.endSec, exitSec: current.exitSec, cashOutRequested: current.cashOutRequested },
      progressPct,
    });
  }

  private applyRoundEvent(event: DeferredEvent): void {
    if (event.type === 'touch') this.onTouch(event.touch);
    else if (event.type === 'time.up') {
      if (this.view.cashOut.phase === 'none') this.enterSettling('time');
    }
    else this.onExitLocked(event.exitPrice);
  }

  private onTouch(touch: TouchInfo): void {
    const round = this.view.round;
    if (!round || this.view.stage !== 'LIVE_TRADE') return;
    const hitTarget = touch.kind === 'target';
    const payout = hitTarget ? targetPayout(round) : 0;
    const pnl = Math.round((payout - round.stake) * 100) / 100;
    this.set({
      ...this.view,
      stage: hitTarget ? 'TARGET_HIT' : 'LOSS_HIT',
      round: {
        ...round,
        currentPrice: touch.price,
        currentPnl: pnl,
        currentMultiplier: round.stake > 0 ? Math.round((payout / round.stake) * 100) / 100 : 0,
      },
      progressPct: hitTarget ? 100 : 0,
      settlement: { ...this.view.settlement, reason: hitTarget ? 'target' : 'stop' },
    });
    this.stageSince = this.now();
    this.after(hitTarget ? IMPACT_BEAT_MS.target : IMPACT_BEAT_MS.stop, () => this.enterSettling(hitTarget ? 'target' : 'stop'));
  }

  private onExitLocked(exitPrice: number): void {
    if (this.view.stage === 'SETTLING') {
      this.set({ ...this.view, cashOut: { ...this.view.cashOut, phase: 'locked', exitPrice } });
      return;
    }
    if (this.view.stage !== 'LIVE_TRADE') return;
    this.set({ ...this.view, cashOut: { ...this.view.cashOut, phase: 'locked', exitPrice } });
    this.after(EXIT_LOCK_HOLD_MS, () => this.enterSettling('exit'));
  }

  private enterSettling(reason: SettleReason): void {
    const stage = this.view.stage;
    if (stage === 'SETTLING' || stage === 'RESULT') return;
    this.stageSince = this.now();
    this.set({ ...this.view, stage: 'SETTLING', launch: null, settlement: { ...this.view.settlement, reason } });
    this.tryFinish();
  }

  private tryFinish(): void {
    const result = this.pendingResult;
    if (!result) return;
    const stage = this.view.stage;
    if (stage === 'TARGET_HIT' || stage === 'LOSS_HIT') return;
    if (stage === 'LAUNCHING') {
      if (this.view.launch?.phase === 'liftoff') return;
      this.clearLaunchTimer();
      this.enterSettling(null);
      return;
    }
    if (stage !== 'SETTLING') {
      this.enterSettling(this.view.settlement.reason);
      return;
    }
    const wait = SETTLE_MIN_MS - (this.now() - this.stageSince);
    if (wait > 0) {
      this.after(wait, () => this.tryFinish());
      return;
    }
    this.pendingResult = null;
    const xp = result.roundId ? this.xpByRound.get(result.roundId) ?? null : null;
    this.stageSince = this.now();
    this.set({
      ...this.view,
      stage: 'RESULT',
      result: xp ? { ...result, xpEarned: xp.gained } : result,
      xp,
      xpPending: xp === null && result.mode === 'live',
    });
    if (xp === null) {
      const roundId = result.roundId;
      this.after(XP_WAIT_MS, () => {
        if (this.view.xpPending && this.view.result?.roundId === roundId) this.set({ ...this.view, xpPending: false });
      });
    }
  }

  private onResultUpdated(result: TradeResult): void {
    if (this.pendingResult?.roundId === result.roundId) this.pendingResult = result;
    const current = this.view.result;
    if (current && current.roundId === result.roundId) this.set({ ...this.view, result: { ...current, xpEarned: result.xpEarned } });
  }

  private onProgressionEvent(roundId: string | null, progression: ProgressionPayload): void {
    this.onProgression?.(progression);
    if (roundId === null) return;
    const gained = progression.gained.reduce((sum, entry) => sum + entry.amount, 0);
    const xp: XpView = { before: progression.xpBefore, after: progression.xpAfter, gained, leveledUp: progression.leveledUp };
    this.xpByRound.set(roundId, xp);
    const current = this.view.result;
    if (current && current.roundId === roundId) this.set({ ...this.view, xp, xpPending: false, result: { ...current, xpEarned: gained } });
  }

  private onResumeEvent(target: 'LIVE_TRADE' | 'SETTLING' | 'RESULT', snapshot: RoundSnapshot): void {
    if (this.view.stage === 'LAUNCHING') return;
    this.clearTimers();
    this.resetRoundState();
    const asset = snapshot.asset ?? snapshot.view?.asset ?? snapshot.result?.asset;
    const direction = snapshot.view?.direction ?? snapshot.result?.direction ?? null;
    if (asset) this.onResume?.({ asset, direction });
    this.stageSince = this.now();
    if (target === 'RESULT' && snapshot.result) {
      this.set({ ...IDLE_LIVE_VIEW, stage: 'RESULT', result: snapshot.result, round: snapshot.view, xp: null, xpPending: false });
      return;
    }
    if (!snapshot.view) return;
    const settleStep = snapshot.settleStep;
    const cashOut: CashOutView =
      snapshot.cashOut === 'requested' ? { ...NO_CASH_OUT, phase: 'requested', snapshotPnl: snapshot.view.currentPnl, snapshotPrice: snapshot.view.currentPrice } : NO_CASH_OUT;
    this.set({
      ...IDLE_LIVE_VIEW,
      stage: target,
      round: snapshot.view,
      progressPct: snapshot.mark?.progressPct ?? 0,
      cashOut,
      settlement: settleStep
        ? { step: settleStep.step, txHash: settleStep.txHash ?? '', failed: settleStep.step === 'failed', reason: null }
        : NO_SETTLEMENT,
    });
  }

  private requestLaunchPhase(next: LaunchPhase): void {
    if (!this.view.launch || PHASE_ORDER[next] <= PHASE_ORDER[this.targetPhase]) return;
    this.targetPhase = next;
    this.advanceLaunch();
  }

  private advanceLaunch(): void {
    const launch = this.view.launch;
    if (!launch || this.launchTimer !== null || launch.phase === this.targetPhase) return;
    const wait = LAUNCH_MIN_MS[launch.phase] - (this.now() - this.phaseSince);
    if (wait > 0) {
      this.launchTimer = setTimeout(() => {
        this.launchTimer = null;
        this.advanceLaunch();
      }, wait);
      return;
    }
    const phase: LaunchPhase = launch.phase === 'locking' ? 'charging' : 'liftoff';
    this.phaseSince = this.now();
    this.patchLaunch({ phase });
    if (phase === 'liftoff') {
      this.launchTimer = setTimeout(() => {
        this.launchTimer = null;
        this.liftoff();
      }, LAUNCH_MIN_MS.liftoff);
      return;
    }
    this.advanceLaunch();
  }

  private liftoff(): void {
    const round = this.lockedRound;
    if (!round || this.view.stage !== 'LAUNCHING') return;
    this.goLive(round, this.lockedProgress);
    const deferred = this.deferred;
    this.deferred = [];
    deferred.forEach((event) => this.applyRoundEvent(event));
    this.tryFinish();
  }

  private goLive(round: ActiveTradeRound, progressPct: number): void {
    this.stageSince = this.now();
    this.set({ ...this.view, stage: 'LIVE_TRADE', launch: null, round, progressPct });
  }

  private failLaunch(message: string): void {
    this.clearTimers();
    this.resetRoundState();
    const copy = message === LAUNCH_NOT_CONFIRMED_COPY ? splitNotice(message) : { title: 'LAUNCH NOT CONFIRMED', body: `${sentence(message)} Your stake was not taken.` };
    this.set({ ...IDLE_LIVE_VIEW, notice: { id: ++this.noticeId, ...copy } });
  }

  private notify(title: string, body: string): void {
    this.set({ ...this.view, notice: { id: ++this.noticeId, title, body } });
  }

  private patchLaunch(patch: Partial<LaunchView>): void {
    if (!this.view.launch) return;
    this.set({ ...this.view, launch: { ...this.view.launch, ...patch } });
  }

  private after(ms: number, task: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      task();
    }, ms);
    this.timers.add(timer);
  }

  private clearLaunchTimer(): void {
    if (this.launchTimer !== null) clearTimeout(this.launchTimer);
    this.launchTimer = null;
  }

  private clearTimers(): void {
    this.clearLaunchTimer();
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }

  private resetRoundState(): void {
    this.targetPhase = 'locking';
    this.lockedRound = null;
    this.lockedProgress = 0;
    this.deferred = [];
    this.pendingResult = null;
  }

  private set(view: LiveView): void {
    this.view = view;
    this.listeners.forEach((listener) => listener());
  }
}
