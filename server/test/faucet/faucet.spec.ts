import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import { faucetAbi } from '../../src/api/arena-abi.ts';
import { E18, makeHarness, roundDto, tick } from '../api/helpers.ts';

type Err = { error: { code: string; retryAfterMs?: number } };

describe('POST /v1/faucet/claim', () => {
  it('drips $100 on the ops key, then enforces the 24 h cooldown', async () => {
    const h = makeHarness();
    const { token, account } = await h.login(undefined, 'wallet');
    const res = await h.request('/v1/faucet/claim', { method: 'POST', token });
    expect(res.status).toBe(202);
    const { claimId } = (await res.json()) as { claimId: string };
    const job = h.ops.jobs[0];
    expect(job).toMatchObject({ key: 'ops', kind: 'faucet', to: '0x2222222222222222222222222222222222222222', intentId: claimId });
    const call = decodeFunctionData({ abi: faucetAbi, data: job?.data ?? '0x' });
    expect(call.args).toEqual([account.address, 100n * E18]);

    const again = await h.request('/v1/faucet/claim', { method: 'POST', token });
    expect(again.status).toBe(429);
    const body = (await again.json()) as Err;
    expect(body.error.code).toBe('FAUCET_COOLDOWN');
    expect(body.error.retryAfterMs).toBeGreaterThan(23 * 3_600_000);

    h.clock.t += 24 * 3_600_000 + 1;
    const fresh = await h.login(account, 'wallet'); // the 24 h session expired too
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token: fresh.token })).status).toBe(202);
  });

  it('streams faucet settlement steps and frees the cooldown when the drip fails', async () => {
    const h = makeHarness();
    const { token, account } = await h.login(undefined, 'wallet');
    await h.request('/v1/faucet/claim', { method: 'POST', token });
    const job = h.ops.jobs[0];
    if (!job) throw new Error('no job');
    h.bus.emit('tx.step', { id: job.handleId, kind: 'faucet', step: 'failed', intentId: job.intentId, error: 'boom' });
    h.ops.finish(job.handleId, { status: 'failed', error: 'boom' });
    await tick(5);
    const step = h.events.find((e) => e.event === 'settlement.step');
    expect(step).toMatchObject({ player: account.address, payload: { kind: 'faucet', step: 'failed', intentId: job.intentId } });
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token })).status).toBe(202);
  });

  it('caps claims at 3 per IP hash per day', async () => {
    const h = makeHarness();
    for (let i = 0; i < 3; i++) {
      const { token } = await h.login(undefined, 'wallet', '10.2.2.2');
      expect((await h.request('/v1/faucet/claim', { method: 'POST', token, ip: '10.2.2.2' })).status).toBe(202);
    }
    const { token } = await h.login(undefined, 'wallet', '10.2.2.2');
    const res = await h.request('/v1/faucet/claim', { method: 'POST', token, ip: '10.2.2.2' });
    expect(((await res.json()) as Err).error.code).toBe('FAUCET_COOLDOWN');
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token, ip: '10.2.2.3' })).status).toBe(202);
  });

  it('only refills below a $5 balance (available + locked)', async () => {
    let available = 20n * E18;
    const h = makeHarness({ deps: { ledger: { balanceOf: async () => available } } });
    const { token, account } = await h.login(undefined, 'wallet');
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token })).status).toBe(429);
    available = 1n * E18;
    h.roundBook.put(roundDto({ roundId: 1n, player: account.address, entrySec: 1, status: 'open', stake: 5n * E18 }));
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token })).status).toBe(429);
    h.roundBook.states.clear();
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token })).status).toBe(202);
  });

  it('is unavailable without a faucet address and requires a session', async () => {
    const h = makeHarness({ deps: { contracts: null } });
    const { token } = await h.login(undefined, 'wallet');
    expect((await h.request('/v1/faucet/claim', { method: 'POST', token })).status).toBe(503);
    expect((await h.request('/v1/faucet/claim', { method: 'POST' })).status).toBe(401);
  });
});
