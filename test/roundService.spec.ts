import { INTENT_TTL_SEC } from '@bnbplay/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { RoundApi } from '../src/api/client';
import type { FakeScenario } from '../src/api/env';
import { ApiError } from '../src/api/errors';
import { FakeStream } from '../src/api/fakeStream';
import { createMemoryStorage } from '../src/api/storage';
import { FakeBackend } from '../src/services/fakeBackend';
import {
  CASHOUT_TOO_LATE_COPY,
  FakeRoundService,
  LAST_SEEN_ROUND_KEY,
  LAUNCH_NOT_CONFIRMED_COPY,
  RoundService,
  type RoundEvent,
  type RoundPhase,
} from '../src/services/roundService';
import { createAccountSigner, type IntentSigner } from '../src/web3/signing';

const START = Date.parse('2026-09-26T12:00:00.400Z');
const LAUNCH = { asset: 'BNB', tier: 0, direction: 'LONG', stakeUsd: 10 } as const;

function seeded(seed = 20260926): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type EventOf<T extends RoundEvent['type']> = Extract<RoundEvent, { type: T }>;

function harness(scenario: FakeScenario, storage = createMemoryStorage()) {
  const backend = new FakeBackend({ scenario, random: seeded() });
  const levels: (readonly number[] | null)[] = [];
  const service = new FakeRoundService({ backend, storage, setLevels: (value) => levels.push(value) });
  const events: RoundEvent[] = [];
  service.subscribe((event) => events.push(event));
  const all = <T extends RoundEvent['type']>(type: T) => events.filter((event): event is EventOf<T> => event.type === type);
  const first = <T extends RoundEvent['type']>(type: T): EventOf<T> => {
    const found = all(type)[0];
    if (!found) throw new Error(`no ${type} event; saw ${events.map((event) => event.type).join(', ')}`);
    return found;
  };
  const phases = () => all('phase').map((event) => event.phase);
  return { backend, service, events, levels, storage, all, first, phases, dispose: () => (service.dispose(), backend.dispose()) };
}

const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function launchAndFly(h: ReturnType<typeof harness>, ms = 45_000) {
  await run(10);
  const outcome = await h.service.launch(LAUNCH);
  expect(outcome.ok).toBe(true);
  await run(ms);
}

describe('RoundService against the fake SSE backend', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('win: locking → charging → live → local target touch → settled from chain values', async () => {
    const h = harness('win');
    await launchAndFly(h);
    expect(h.phases()).toEqual(['signing', 'submitting', 'locking', 'charging', 'opened', 'live', 'settling', 'settled']);
    expect(h.all('launch.step').map((event) => event.step)).toEqual(['preparing', 'signing', 'submitted', 'confirmed']);
    const locked = h.first('entry.locked');
    expect(locked.view).toMatchObject({ mode: 'live', asset: 'BNB', direction: 'LONG', stake: 10, tierLabel: 'CRUISE', durationSeconds: 30 });
    expect(locked.view.targetPrice).toBeGreaterThan(locked.entryPrice);
    expect(h.levels[0]).toEqual([locked.view.targetPrice, locked.view.stopLossPrice]);

    const touches = h.all('touch');
    expect(touches).toHaveLength(1);
    expect(touches[0].touch).toMatchObject({ kind: 'target', source: 'local' });
    const marks = h.all('mark');
    expect(marks.length).toBeGreaterThanOrEqual(5);
    expect(marks.at(-1)?.mark.touch).toBe('target');

    const settled = h.first('settled');
    expect(settled.result).toMatchObject({ outcome: 'win', pnl: 5, payout: 15, multiplier: 1.5, mode: 'live', voided: false, tierLabel: 'CRUISE' });
    expect(settled.result.explorerUrl).toMatch(/^https:\/\/testnet\.bscscan\.com\/tx\/0x[0-9a-f]{64}$/);
    expect(settled.result.exitPrice).toBeGreaterThanOrEqual(locked.view.targetPrice);
    expect(h.first('result.updated').result.xpEarned).toBe(35);
    expect(h.first('debrief').debrief.source).toBe('template');
    expect(h.levels.at(-1)).toBeNull();
    expect(h.storage.getItem(LAST_SEEN_ROUND_KEY)).toBe(settled.roundId);
    h.dispose();
  });

  it('loss: stop touch settles at −stake', async () => {
    const h = harness('loss');
    await launchAndFly(h);
    expect(h.first('touch').touch.kind).toBe('stop');
    expect(h.first('settled').result).toMatchObject({ outcome: 'loss', pnl: -10, payout: 0 });
    h.dispose();
  });

  it('timeout: time.up at endSec and an interior payout equal to the shared evaluator', async () => {
    const h = harness('timeout');
    await launchAndFly(h);
    expect(h.all('touch')).toHaveLength(0);
    expect(h.all('time.up')).toHaveLength(1);
    const { result } = h.first('settled');
    expect(result.outcome).toBe('timeout');
    expect(result.durationSec).toBe(30);
    expect(result.pnl).toBeGreaterThan(-10);
    expect(result.pnl).toBeLessThan(5);
    expect(result.pnl).toBeCloseTo((result.payout ?? 0) - 10, 2);
    const lastMark = h.all('mark').at(-1);
    expect(lastMark?.mark.sec).toBe(result.decisionSec);
    expect(lastMark?.mark.pnl).toBe(result.pnl);
    h.dispose();
  });

  it('cash-out: freezes a snapshot, locks the exit and settles as cashed_out', async () => {
    const h = harness('cashout');
    await launchAndFly(h, 8_000);
    expect(h.service.getPhase()).toBe('live');
    await run(4_000);
    const outcome = await h.service.cashOut();
    expect(outcome.ok).toBe(true);
    expect(h.first('cashout.pending').snapshot).not.toBeNull();
    await run(12_000);
    const requested = h.first('cashout.requested');
    const exit = h.first('exit.locked');
    expect(exit.exitSec).toBe(requested.exitSec);
    const { result } = h.first('settled');
    expect(result.outcome).toBe('cashed_out');
    expect(result.decisionSec).toBe(requested.exitSec);
    expect(result.durationSec).toBeLessThan(30);
    expect(result.exitPrice).toBe(exit.exitPrice);
    h.dispose();
  });

  it('cash-out too late: rejected with the F1c copy and the round continues to timeout', async () => {
    const h = harness('timeout');
    await launchAndFly(h, 8_000);
    const remaining = h.service.msUntilEnd() ?? 0;
    await run(remaining - 1_500);
    const outcome = await h.service.cashOut();
    expect(outcome).toEqual({ ok: false, code: 'CASHOUT_TOO_LATE', message: CASHOUT_TOO_LATE_COPY });
    expect(h.first('cashout.rejected').message).toBe(CASHOUT_TOO_LATE_COPY);
    expect(h.service.getPhase()).toBe('live');
    await run(10_000);
    expect(h.first('settled').result.outcome).toBe('timeout');
    h.dispose();
  });

  it('open failure: honest launch failure, stake never taken, selections can relaunch', async () => {
    const h = harness('open_failure');
    await launchAndFly(h, 3_000);
    expect(h.first('launch.failed')).toMatchObject({ code: 'INTERNAL', stakeTaken: false });
    expect(h.service.getPhase()).toBe('idle');
    expect(h.backend.balanceOf(h.service.signer.address)).toBe(100n * 10n ** 18n);
    h.service.setScenario('win');
    expect((await h.service.launch(LAUNCH)).ok).toBe(true);
    h.dispose();
  });

  it('settle failure: shows the failed step, then retries into a settlement', async () => {
    const h = harness('settle_failure');
    await launchAndFly(h, 50_000);
    const phases = h.phases();
    expect(phases).toContain('settle_failed');
    expect(phases.indexOf('settle_failed')).toBeLessThan(phases.indexOf('settled'));
    expect(h.all('settle.step').some((event) => event.step === 'failed' && event.error?.code === 'INTERNAL')).toBe(true);
    expect(h.first('settled').result.outcome).toBe('timeout');
    h.dispose();
  });

  it('void: a voided round returns the stake and is not reported as a loss', async () => {
    const h = harness('void');
    await launchAndFly(h, 50_000);
    const voided = h.first('voided');
    expect(voided.reason).toBe('stalled');
    expect(voided.result).toMatchObject({ voided: true, pnl: 0, payout: 10, voidReason: 'stalled' });
    expect(h.all('settled')).toHaveLength(0);
    expect(h.service.getPhase()).toBe('voided');
    h.dispose();
  });

  it('resume: an active round in hello goes straight to LIVE_TRADE and still settles', async () => {
    const h = harness('resume_live');
    await run(10);
    const resume = h.first('resume');
    expect(resume.target).toBe('LIVE_TRADE');
    expect(resume.snapshot.phase).toBe('live');
    expect(resume.snapshot.view?.entryPrice).toBeGreaterThan(0);
    await run(35_000);
    expect(h.first('settled').result.outcome).toBe('timeout');
    h.dispose();
  });

  it('resume: an active round past endSec goes to SETTLING', async () => {
    const h = harness('resume_settling');
    await run(10);
    expect(h.first('resume').target).toBe('SETTLING');
    expect(h.service.getPhase()).toBe('settling');
    await run(8_000);
    expect(h.first('settled').result.outcome).toBe('timeout');
    h.dispose();
  });

  it('resume: an unseen last settled round goes to RESULT once', async () => {
    const storage = createMemoryStorage();
    const h = harness('resume_result', storage);
    await run(10);
    const resume = h.first('resume');
    expect(resume.target).toBe('RESULT');
    expect(resume.snapshot.result?.outcome).toBe('win');
    expect(storage.getItem(LAST_SEEN_ROUND_KEY)).toBeNull();
    h.service.reset();
    expect(storage.getItem(LAST_SEEN_ROUND_KEY)).toBe(resume.snapshot.roundId);
    expect(h.service.getPhase()).toBe('idle');
    h.dispose();
  });
});

describe('RoundService edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const makeService = async (api: Partial<RoundApi>, signer: IntentSigner = createAccountSigner(privateKeyToAccount(generatePrivateKey()))) => {
    const reference = new FakeBackend({ random: seeded() });
    const config = await reference.api.config();
    const stream = new FakeStream();
    const full: RoundApi = {
      config: vi.fn(async () => config),
      openRound: async () => ({ intentId: 'intent-1', intentHash: `0x${'00'.repeat(32)}` }),
      cashOut: async () => ({ intentId: 'cash-1' }),
      round: async () => {
        throw new ApiError('ROUND_NOT_FOUND', 'missing');
      },
      playerRounds: async () => ({ items: [], nextCursor: null }),
      ...api,
    };
    const service = new RoundService({ stream, api: full, getSigner: () => signer, readNonce: async () => 0n, storage: createMemoryStorage() });
    const events: RoundEvent[] = [];
    service.subscribe((event) => events.push(event));
    return { service, events, stream, api: full };
  };

  it('fails honestly after 8 s without round.opened', async () => {
    const { service, events } = await makeService({});
    expect((await service.launch(LAUNCH)).ok).toBe(true);
    expect(service.getPhase()).toBe('locking');
    await run(7_999);
    expect(events.some((event) => event.type === 'launch.failed')).toBe(false);
    await run(1);
    const failed = events.find((event): event is EventOf<'launch.failed'> => event.type === 'launch.failed');
    expect(failed).toMatchObject({ code: 'LAUNCH_NOT_CONFIRMED', message: LAUNCH_NOT_CONFIRMED_COPY, stakeTaken: false });
    expect(service.getPhase()).toBe('idle');
  });

  it('re-reads the config and re-signs exactly once on LANE_VERSION_MISMATCH', async () => {
    const base = createAccountSigner(privateKeyToAccount(generatePrivateKey()));
    const signOpenRound = vi.fn(base.signOpenRound);
    const signer: IntentSigner = { ...base, signOpenRound };
    let calls = 0;
    const { service, api } = await makeService(
      {
        openRound: async () => {
          calls++;
          if (calls === 1) throw new ApiError('LANE_VERSION_MISMATCH', 'lane changed');
          return { intentId: 'intent-2', intentHash: `0x${'00'.repeat(32)}` };
        },
      },
      signer,
    );
    const outcome = await service.launch(LAUNCH);
    expect(outcome).toEqual({ ok: true, intentId: 'intent-2' });
    expect(signOpenRound).toHaveBeenCalledTimes(2);
    expect(api.config).toHaveBeenCalledTimes(2);
  });

  it('rejects a disabled tier and an out-of-range stake before signing', async () => {
    const { service } = await makeService({});
    expect(await service.launch({ ...LAUNCH, asset: 'BTC', tier: 1 })).toMatchObject({ ok: false, code: 'TIER_DISABLED' });
    expect(await service.launch({ ...LAUNCH, stakeUsd: 500 })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(service.getPhase()).toBe('idle');
  });

  it('refuses to launch without a signer and to cash out when not live', async () => {
    const stream = new FakeStream();
    const reference = new FakeBackend();
    const service = new RoundService({ stream, api: reference.api, getSigner: () => null, readNonce: async () => 0n, storage: createMemoryStorage() });
    expect(await service.launch(LAUNCH)).toMatchObject({ ok: false, code: 'NO_WALLET' });
    expect(await service.cashOut()).toMatchObject({ ok: false, code: 'NOT_LIVE' });
    reference.dispose();
  });

  it('signs the OpenRound intent with the packed nonce and the INTENT_TTL_SEC.open deadline', async () => {
    const signer = createAccountSigner(privateKeyToAccount(generatePrivateKey()));
    let captured: Parameters<RoundApi['openRound']>[0] | null = null;
    const { service } = await makeService(
      {
        openRound: async (request) => {
          captured = request;
          return { intentId: 'intent-3', intentHash: `0x${'00'.repeat(32)}` };
        },
      },
      signer,
    );
    await service.launch({ ...LAUNCH, direction: 'SHORT', tier: 1, stakeUsd: 25 });
    expect(captured).toMatchObject({
      intent: {
        player: signer.address,
        assetId: 0,
        tier: 1,
        direction: 1,
        stake: (25n * 10n ** 18n).toString(),
        laneVersion: 1,
        oracleIdx: 0,
        nonce: '0',
        deadline: Math.floor(START / 1000) + INTENT_TTL_SEC.open,
      },
    });
  });
});
