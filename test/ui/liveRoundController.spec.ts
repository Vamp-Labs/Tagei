import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeScenario } from '../../src/api/env';
import { createMemoryStorage } from '../../src/api/storage';
import { FakeBackend } from '../../src/services/fakeBackend';
import { CASHOUT_TOO_LATE_COPY, FakeRoundService } from '../../src/services/roundService';
import type { GameStage } from '../../src/types/game';
import {
  IMPACT_BEAT_MS,
  LAUNCH_MIN_MS,
  LiveRoundController,
  SETTLE_MIN_MS,
  type LaunchPhase,
  type LiveView,
} from '../../src/components/game/liveRoundController';

const START = Date.parse('2026-09-26T12:00:00.400Z');
const LAUNCH = { asset: 'BNB', tier: 0, direction: 'LONG', stakeUsd: 10 } as const;

function seeded(seed = 20260926): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface Frame {
  at: number;
  stage: GameStage | null;
  phase: LaunchPhase | null;
}

function harness(scenario: FakeScenario) {
  const backend = new FakeBackend({ scenario, random: seeded() });
  const service = new FakeRoundService({ backend, storage: createMemoryStorage() });
  const progressions: number[] = [];
  const resumes: string[] = [];
  const controller = new LiveRoundController(service, {
    onProgression: (progression) => progressions.push(progression.xpAfter),
    onResume: (info) => resumes.push(info.asset),
  });
  const frames: Frame[] = [];
  let last = '';
  controller.subscribe(() => {
    const view = controller.getView();
    const key = `${view.stage}|${view.launch?.phase ?? ''}`;
    if (key === last) return;
    last = key;
    frames.push({ at: Date.now() - START, stage: view.stage, phase: view.launch?.phase ?? null });
  });
  controller.start();
  const stages = () => frames.map((frame) => frame.stage).filter((stage, index, all) => stage !== all[index - 1]);
  const view = (): LiveView => controller.getView();
  const dispose = () => {
    controller.stop();
    service.dispose();
    backend.dispose();
  };
  return { backend, service, controller, frames, stages, view, progressions, resumes, dispose };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function launch(h: ReturnType<typeof harness>) {
  await run(10);
  await h.controller.launch(LAUNCH, 612.34);
}

function waitFor(h: ReturnType<typeof harness>, stage: GameStage | null, limitMs = 60_000) {
  return (async () => {
    for (let spent = 0; spent < limitMs; spent += 50) {
      if (h.view().stage === stage) return;
      await run(50);
    }
    throw new Error(`never reached ${stage}; saw ${h.stages().join(' → ')}`);
  })();
}

describe('LiveRoundController drives F1c from roundService events', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('win: launch phases honour their minimum durations, then impact beat, settle and chain result', async () => {
    const h = harness('win');
    await launch(h);
    expect(h.view().launch).toMatchObject({ phase: 'locking', predictedEntry: 612.34, entryPrice: null });
    await waitFor(h, 'LIVE_TRADE');
    const launchFrames = h.frames.filter((frame) => frame.stage === 'LAUNCHING');
    expect(launchFrames.map((frame) => frame.phase)).toEqual(['locking', 'charging', 'liftoff']);
    const [locking, charging, liftoff] = launchFrames;
    expect(charging.at - locking.at).toBeGreaterThanOrEqual(LAUNCH_MIN_MS.locking);
    expect(liftoff.at - charging.at).toBeGreaterThanOrEqual(LAUNCH_MIN_MS.charging);
    const live = h.frames.find((frame) => frame.stage === 'LIVE_TRADE');
    expect((live?.at ?? 0) - liftoff.at).toBeGreaterThanOrEqual(LAUNCH_MIN_MS.liftoff);
    expect(h.view().round).toMatchObject({ mode: 'live', tierLabel: 'CRUISE' });

    await waitFor(h, 'TARGET_HIT');
    const hitAt = Date.now();
    expect(h.view().round?.currentPnl).toBe(5);
    await waitFor(h, 'SETTLING');
    expect(Date.now() - hitAt).toBeGreaterThanOrEqual(IMPACT_BEAT_MS.target);
    const settlingAt = Date.now();
    await waitFor(h, 'RESULT');
    expect(Date.now() - settlingAt).toBeGreaterThanOrEqual(SETTLE_MIN_MS);
    expect(h.view().result).toMatchObject({ outcome: 'win', pnl: 5, mode: 'live', voided: false });
    expect(h.view().settlement.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    await run(2_000);
    expect(h.view().xp).toMatchObject({ gained: 35, leveledUp: false });
    expect(h.view().xpPending).toBe(false);
    expect(h.view().result?.xpEarned).toBe(35);
    expect(h.progressions).toHaveLength(1);
    expect(h.stages()).toEqual(['LAUNCHING', 'LIVE_TRADE', 'TARGET_HIT', 'SETTLING', 'RESULT']);

    h.controller.acknowledge();
    expect(h.view().stage).toBeNull();
    expect(h.service.getPhase()).toBe('idle');
    h.dispose();
  });

  it('loss: stop touch plays the 700 ms beat and settles at −stake', async () => {
    const h = harness('loss');
    await launch(h);
    await waitFor(h, 'LOSS_HIT');
    const hitAt = Date.now();
    expect(h.view().round?.currentPnl).toBe(-10);
    await waitFor(h, 'SETTLING');
    expect(Date.now() - hitAt).toBeGreaterThanOrEqual(IMPACT_BEAT_MS.stop);
    await waitFor(h, 'RESULT');
    expect(h.view().result).toMatchObject({ outcome: 'loss', pnl: -10 });
    h.dispose();
  });

  it('timeout: time up goes to SETTLING with the time reason and the result matches the last exact mark', async () => {
    const h = harness('timeout');
    await launch(h);
    await waitFor(h, 'SETTLING');
    expect(h.view().settlement.reason).toBe('time');
    await waitFor(h, 'RESULT');
    const { result, round } = h.view();
    expect(result?.outcome).toBe('timeout');
    expect(result?.pnl).toBe(round?.currentPnl);
    expect(result?.exitPrice).toBeCloseTo(round?.currentPrice ?? 0, 6);
    h.dispose();
  });

  it('cash-out: freezes a ≈ snapshot, shows EXIT LOCKED with the real exit, then settles as cashed_out', async () => {
    const h = harness('cashout');
    await launch(h);
    await waitFor(h, 'LIVE_TRADE');
    await run(4_000);
    const cashing = h.controller.cashOut();
    expect(h.view().cashOut.phase).toBe('pending');
    const snapshot = h.view().cashOut.snapshotPnl;
    expect(snapshot).not.toBeNull();
    await cashing;
    for (let i = 0; i < 100 && h.view().cashOut.phase !== 'locked'; i++) await run(50);
    expect(h.view().cashOut.phase).toBe('locked');
    expect(h.view().cashOut.snapshotPnl).toBe(snapshot);
    const exitPrice = h.view().cashOut.exitPrice;
    expect(exitPrice).toBeGreaterThan(0);
    expect(h.view().stage).toBe('LIVE_TRADE');
    await waitFor(h, 'SETTLING');
    expect(h.view().settlement.reason).toBe('exit');
    await waitFor(h, 'RESULT');
    expect(h.view().result).toMatchObject({ outcome: 'cashed_out', exitPrice });
    h.dispose();
  });

  it('cash-out too late: shows the service copy and keeps flying to the timeout', async () => {
    const h = harness('timeout');
    await launch(h);
    await waitFor(h, 'LIVE_TRADE');
    const endMs = (h.view().round?.endSec ?? 0) * 1000;
    await run(endMs - 1_500 - Date.now());
    expect(h.view().stage).toBe('LIVE_TRADE');
    await h.controller.cashOut();
    expect(h.view().notice?.body).toBe(CASHOUT_TOO_LATE_COPY);
    expect(h.view().cashOut.phase).toBe('none');
    expect(h.view().stage).toBe('LIVE_TRADE');
    await waitFor(h, 'RESULT');
    expect(h.view().result?.outcome).toBe('timeout');
    h.dispose();
  });

  it('open failure: back to idle with the honest notice, no round kept', async () => {
    const h = harness('open_failure');
    await launch(h);
    await waitFor(h, null);
    expect(h.view().notice).toMatchObject({ title: 'LAUNCH NOT CONFIRMED' });
    expect(h.view().notice?.body).toBe('Simulated relayer failure. Your stake was not taken.');
    expect(h.view().round).toBeNull();
    expect(h.stages()).toEqual(['LAUNCHING', null]);
    h.dispose();
  });

  it('settle failure: the failed step is surfaced, then the retry settles', async () => {
    const h = harness('settle_failure');
    await launch(h);
    await waitFor(h, 'SETTLING');
    for (let i = 0; i < 200 && !h.view().settlement.failed; i++) await run(50);
    expect(h.view().settlement).toMatchObject({ step: 'failed', failed: true });
    expect(h.view().stage).toBe('SETTLING');
    await waitFor(h, 'RESULT');
    expect(h.view().settlement.failed).toBe(false);
    expect(h.view().result?.voided).toBe(false);
    h.dispose();
  });

  it('void: the round ends in a voided result with the stake returned', async () => {
    const h = harness('void');
    await launch(h);
    await waitFor(h, 'RESULT', 90_000);
    expect(h.view().result).toMatchObject({ voided: true, pnl: 0, payout: 10 });
    expect(h.view().xpPending).toBe(true);
    await run(4_100);
    expect(h.view().xpPending).toBe(false);
    h.dispose();
  });

  it.each([
    ['resume_live', 'LIVE_TRADE'],
    ['resume_settling', 'SETTLING'],
    ['resume_result', 'RESULT'],
  ] as const)('%s: hello resumes straight into %s', async (scenario, stage) => {
    const h = harness(scenario);
    await run(10);
    expect(h.view().stage).toBe(stage);
    expect(h.resumes).toEqual(['BNB']);
    expect(h.stages()[0]).toBe(stage);
    if (stage !== 'RESULT') {
      await waitFor(h, 'RESULT', 60_000);
      expect(h.view().result?.mode).toBe('live');
    } else {
      expect(h.view().result?.outcome).toBe('win');
    }
    h.dispose();
  });
});
