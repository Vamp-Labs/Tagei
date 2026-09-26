import { describe, expect, it, vi } from 'vitest';
import { verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { apiDomain, loginTypes } from '@bnbplay/shared/eip712';
import { AuthSession, SESSION_STORAGE_KEY, toExpiryMs } from '../src/api/auth';
import { ApiClient, type FetchLike } from '../src/api/client';
import { readEnv } from '../src/api/env';
import { ApiError, isUserRejection } from '../src/api/errors';
import { createMemoryStorage } from '../src/api/storage';
import { FakeBackend } from '../src/services/fakeBackend';
import { PixAIService, type PixApi } from '../src/services/pixAI';
import { createAccountSigner } from '../src/web3/signing';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function recordingFetch(responder: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
  return { fetch, calls };
}

describe('ApiClient', () => {
  it('validates responses with the shared zod schemas', async () => {
    const config = await new FakeBackend().api.config();
    const { fetch, calls } = recordingFetch(() => json(config));
    const client = new ApiClient({ baseUrl: 'https://api.test', fetch });
    expect(await client.config()).toEqual(config);
    expect(calls[0].url).toBe('https://api.test/v1/config');
  });

  it('rejects a response that does not match the schema', async () => {
    const { fetch } = recordingFetch(() => json({ chainId: 'ninety-seven' }));
    const client = new ApiClient({ baseUrl: 'https://api.test', fetch });
    await expect(client.config()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('maps API error bodies to typed errors with status and retryAfterMs', async () => {
    const { fetch } = recordingFetch(() => json({ error: { code: 'RELAYER_BUSY', message: 'busy', retryAfterMs: 1500 } }, 503));
    const client = new ApiClient({ baseUrl: 'https://api.test', fetch, getToken: () => 'jwt' });
    const error = await client.balance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RELAYER_BUSY', status: 503, retryAfterMs: 1500 });
  });

  it('sends the bearer token on JWT routes and refuses them without one', async () => {
    const { fetch, calls } = recordingFetch(() => json({ available: '1', locked: '0' }));
    let token: string | null = null;
    const client = new ApiClient({ baseUrl: 'https://api.test', fetch, getToken: () => token });
    await expect(client.balance()).rejects.toMatchObject({ code: 'SESSION_REQUIRED' });
    token = 'abc';
    await client.balance();
    expect(new Headers(calls[0].init?.headers).get('Authorization')).toBe('Bearer abc');
  });

  it('reports API_DISABLED when no base URL is configured and TIMEOUT on a hung request', async () => {
    await expect(new ApiClient({ baseUrl: null }).config()).rejects.toMatchObject({ code: 'API_DISABLED' });
    vi.useFakeTimers();
    const hung: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const pending = new ApiClient({ baseUrl: 'https://api.test', fetch: hung, timeoutMs: 1000 }).config().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ code: 'TIMEOUT' });
    vi.useRealTimers();
  });

  it('builds query strings and streams PIX chat deltas until done', async () => {
    const sse = 'event: pix.delta\ndata: {"text":"Momentum "}\n\nevent: pix.delta\ndata: {"text":"is mixed."}\n\nevent: pix.done\ndata: {"usage":{"in":3}}\n\n';
    const { fetch, calls } = recordingFetch((url) =>
      url.endsWith('/v1/pix/chat') ? new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }) : json([]),
    );
    const client = new ApiClient({ baseUrl: 'https://api.test', fetch, getToken: () => 't' });
    await client.leaderboard('all');
    expect(calls[0].url).toBe('https://api.test/v1/leaderboard?period=all');
    const events = [];
    for await (const event of client.pixChat([{ role: 'user', content: 'trend?' }])) events.push(event);
    expect(events).toEqual([
      { type: 'pix.delta', text: 'Momentum ' },
      { type: 'pix.delta', text: 'is mixed.' },
      { type: 'pix.done', usage: { in: 3 } },
    ]);
  });
});

describe('AuthSession (EIP-712 login → JWT)', () => {
  it('signs Login with the API domain, stores the JWT and reuses it', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = createAccountSigner(account, 'guest');
    const salt = `0x${'ab'.repeat(32)}` as const;
    const sessions: { signature: `0x${string}`; kind: string }[] = [];
    const api = {
      authChallenge: vi.fn(async () => ({ salt, expiresAt: 1_790_000_300, chainId: 97 })),
      authSession: vi.fn(async (body: { signature: string; kind: 'guest' | 'wallet'; address: string }) => {
        sessions.push({ signature: body.signature as `0x${string}`, kind: body.kind });
        return { token: 'jwt-1', player: body.address, expiresAt: 1_790_086_400 };
      }),
    };
    const storage = createMemoryStorage();
    const auth = new AuthSession({ api, storage, now: () => 1_790_000_000_000 });
    const [a, b] = await Promise.all([auth.ensure(signer), auth.ensure(signer)]);
    expect(a).toBe('jwt-1');
    expect(b).toBe('jwt-1');
    expect(api.authChallenge).toHaveBeenCalledTimes(1);
    expect(sessions[0].kind).toBe('guest');
    const valid = await verifyTypedData({
      address: account.address,
      domain: apiDomain(97),
      types: loginTypes,
      primaryType: 'Login',
      message: { player: account.address, salt, expiresAt: 1_790_000_300 },
      signature: sessions[0].signature,
    });
    expect(valid).toBe(true);
    expect(JSON.parse(storage.getItem(SESSION_STORAGE_KEY) ?? '{}')).toMatchObject({ token: 'jwt-1', expiresAtMs: 1_790_086_400_000 });
    expect(auth.token(account.address)).toBe('jwt-1');
    expect(auth.token(privateKeyToAccount(generatePrivateKey()).address)).toBeNull();

    const reloaded = new AuthSession({ api, storage, now: () => 1_790_086_400_000 });
    expect(reloaded.token()).toBeNull();
  });

  it('refuses a challenge for another chain', async () => {
    const signer = createAccountSigner(privateKeyToAccount(generatePrivateKey()));
    const api = {
      authChallenge: async () => ({ salt: `0x${'00'.repeat(32)}`, expiresAt: 1, chainId: 56 }),
      authSession: vi.fn(),
    };
    const auth = new AuthSession({ api, storage: createMemoryStorage() });
    await expect(auth.ensure(signer)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(api.authSession).not.toHaveBeenCalled();
  });

  it('normalises seconds and milliseconds expiries', () => {
    expect(toExpiryMs(1_790_000_000)).toBe(1_790_000_000_000);
    expect(toExpiryMs(1_790_000_000_000)).toBe(1_790_000_000_000);
  });
});

describe('env and errors', () => {
  it('reads typed env values with safe defaults', () => {
    expect(readEnv({})).toEqual({ apiUrl: null, wcProjectId: null, rpcUrls: [], roundSource: 'api', fakeScenario: 'win', dev: false });
    expect(
      readEnv({ VITE_API_URL: 'https://api.test///', VITE_RPC_URLS: 'https://a, https://b', VITE_ROUND_SOURCE: 'fake', VITE_FAKE_SCENARIO: 'void', DEV: true }),
    ).toEqual({ apiUrl: 'https://api.test', wcProjectId: null, rpcUrls: ['https://a', 'https://b'], roundSource: 'fake', fakeScenario: 'void', dev: true });
    expect(readEnv({ VITE_FAKE_SCENARIO: 'jackpot', VITE_API_URL: 42 }).fakeScenario).toBe('win');
  });

  it('detects wallet rejections through nested causes', () => {
    expect(isUserRejection({ cause: { cause: { code: 4001 } } })).toBe(true);
    expect(isUserRejection(new Error('boom'))).toBe(false);
  });
});

describe('PixAIService fetch client', () => {
  const disabled: PixApi = {
    isEnabled: () => false,
    pixInsight: vi.fn(),
    pixDebrief: vi.fn(),
    pixChat: vi.fn(),
  };

  it('falls back to templates when the API is disabled or failing', async () => {
    const offline = await PixAIService.fetchInsight('BNB', 2, { api: disabled });
    expect(offline).toMatchObject({ source: 'template', sentiment: 'bullish' });
    const failing: PixApi = { ...disabled, isEnabled: () => true, pixInsight: vi.fn(async () => Promise.reject(new Error('503'))) };
    expect((await PixAIService.fetchInsight('BNB', -2, { api: failing })).source).toBe('template');
  });

  it('discards LLM copy that breaks the guardrails', async () => {
    const unsafe: PixApi = {
      ...disabled,
      isEnabled: () => true,
      pixInsight: vi.fn(async () => ({
        headline: 'Guaranteed breakout',
        summary: 'You should buy now.',
        sentiment: 'bullish' as const,
        factors: [],
        learningTip: 'x',
        source: 'llm' as const,
        generatedAtMs: 1,
      })),
    };
    expect((await PixAIService.fetchInsight('BNB', 0, { api: unsafe })).source).toBe('template');
  });

  it('streams chat deltas and falls back to a template reply offline', async () => {
    const deltas: string[] = [];
    const offline = await PixAIService.chat([{ role: 'user', content: 'hi' }], { asset: 'BNB', change24h: 0 }, (d) => deltas.push(d), { api: disabled });
    expect(offline.source).toBe('template');
    expect(deltas).toHaveLength(1);

    async function* stream() {
      yield { type: 'pix.delta' as const, text: 'Hello ' };
      yield { type: 'pix.delta' as const, text: 'pilot.' };
      yield { type: 'pix.done' as const, usage: null };
    }
    const online: PixApi = { ...disabled, isEnabled: () => true, pixChat: vi.fn(() => stream()) };
    const streamed: string[] = [];
    const reply = await PixAIService.chat([{ role: 'user', content: 'hi' }], { asset: 'BNB', change24h: 0 }, (d) => streamed.push(d), { api: online });
    expect(reply).toEqual({ text: 'Hello pilot.', source: 'llm' });
    expect(streamed).toEqual(['Hello ', 'pilot.']);
  });

  it('uses the live debrief for live rounds only', async () => {
    const debrief = { headline: 'Clean read', analysis: 'a', keyFactors: [], coachingTip: 'c', source: 'llm' as const };
    const online: PixApi = { ...disabled, isEnabled: () => true, pixDebrief: vi.fn(async () => debrief) };
    const base = { id: '1', asset: 'BNB' as const, direction: 'LONG' as const, stake: 10, entryPrice: 1, exitPrice: 1, pnl: 5, multiplier: 1.5, outcome: 'win' as const, timestamp: 0, txHash: '', xpEarned: 0 };
    expect((await PixAIService.fetchDebrief({ ...base, mode: 'live', roundId: '7' }, { api: online })).headline).toBe('Clean read');
    expect((await PixAIService.fetchDebrief(base, { api: online })).source).toBe('template');
  });
});
