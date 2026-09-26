import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { apiDomain, loginTypes } from '@bnbplay/shared/eip712';
import { signSession, verifySession } from '../../src/auth/jwt.ts';
import { makeHarness, tick } from '../api/helpers.ts';

describe('EIP-712 login', () => {
  it('issues a 24 h JWT for a valid Login signature', async () => {
    const h = makeHarness();
    const { token, account } = await h.login();
    expect(token.split('.')).toHaveLength(3);
    const claims = await verifySession('test-secret', token, Math.floor(h.clock.t / 1000));
    expect(claims?.player).toBe(account.address);
    expect(claims?.exp).toBe(Math.floor(h.clock.t / 1000) + 86_400);
    const bal = await h.request('/v1/me/balance', { token });
    expect(bal.status).toBe(200);
  });

  it('rejects replayed salts, wrong signers, expired challenges and missing tokens', async () => {
    const h = makeHarness();
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const challenge = async () =>
      (await (await h.request('/v1/auth/challenge', { method: 'POST', body: JSON.stringify({ address: account.address }) })).json()) as {
        salt: `0x${string}`;
        expiresAt: number;
      };
    const sign = (who: typeof account, ch: { salt: `0x${string}`; expiresAt: number }) =>
      who.signTypedData({ domain: apiDomain(97), types: loginTypes, primaryType: 'Login', message: { player: account.address, salt: ch.salt, expiresAt: ch.expiresAt } });
    const session = (ch: { salt: string; expiresAt: number }, signature: string) =>
      h.request('/v1/auth/session', { method: 'POST', body: JSON.stringify({ address: account.address, ...ch, signature, kind: 'wallet' }) });

    const ch = await challenge();
    const bad = await session(ch, await sign(other, ch));
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('BAD_SIGNATURE');

    const sig = await sign(account, ch);
    expect((await session(ch, sig)).status).toBe(200);
    expect((await session(ch, sig)).status).toBe(401); // single-use salt

    const late = await challenge();
    h.clock.t += 301_000;
    expect((await session(late, await sign(account, late))).status).toBe(401);

    const noToken = await h.request('/v1/me/balance');
    expect(noToken.status).toBe(401);
    expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe('SESSION_REQUIRED');
  });

  it('expires sessions against the clock', async () => {
    const token = await signSession('s', { player: '0x1111111111111111111111111111111111111111', kind: 'guest', iat: 100, exp: 200 });
    expect(await verifySession('s', token, 150)).not.toBeNull();
    expect(await verifySession('s', token, 200)).toBeNull();
    expect(await verifySession('other', token, 150)).toBeNull();
  });

  it("auto-drips the faucet on a guest's first session only", async () => {
    const h = makeHarness();
    const { account } = await h.login(undefined, 'guest');
    await tick(5);
    expect(h.ops.jobs).toHaveLength(1);
    expect(h.ops.jobs[0]).toMatchObject({ key: 'ops', kind: 'faucet' });
    await h.login(account, 'guest');
    await tick(5);
    expect(h.ops.jobs).toHaveLength(1);
    await h.login(undefined, 'wallet');
    await tick(5);
    expect(h.ops.jobs).toHaveLength(1);
  });
});
