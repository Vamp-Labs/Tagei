import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { DebriefSchema, MarketInsightSchema } from '@bnbplay/shared/dto';
import { guardrailViolations } from '@bnbplay/shared/pix';
import { Bus } from '../../src/bus.ts';
import { SentenceGate } from '../../src/pix/guard.ts';
import { PixLlm, type AnthropicLike } from '../../src/pix/llm.ts';
import { PixServiceImpl } from '../../src/pix/service.ts';
import { createMemoryPixStore } from '../../src/pix/store.ts';
import { ApiError } from '../../src/api/errors.ts';
import { E18, FakePriceHub, FakeRoundBook, T0, makeHarness, roundDto, sseReader, tick } from '../api/helpers.ts';

const player = privateKeyToAccount(generatePrivateKey()).address;
const usage = { input_tokens: 100, output_tokens: 50 };

type ParseImpl = (params: unknown, opts: unknown) => Promise<unknown>;

function mockClient(parse: ParseImpl, stream?: () => unknown): AnthropicLike & { messages: { parse: ReturnType<typeof vi.fn> } } {
  return { messages: { parse: vi.fn(parse), stream: vi.fn(stream ?? (() => ({}))) } } as never;
}

const insightOk = { headline: 'Momentum is picking up', summary: 'Buyers stepped in over the last minutes.', factorKeys: ['volatility', 'momentum_1m'], learningTip: 'Watch how momentum and volatility interact.' };
const debriefOk = { headline: 'A patient, clean read', analysis: 'Price climbed after entry and touched the target.', factorKeys: ['time_to_touch'], coachingTip: 'Keep reading the track before each launch.' };

function pixHarness(client?: AnthropicLike, over: Partial<ConstructorParameters<typeof PixServiceImpl>[0]> = {}) {
  const clock = { t: T0 };
  const bus = new Bus();
  const hub = new FakePriceHub();
  const now = Math.floor(T0 / 1000);
  hub.seed(49, now - 300, Array.from({ length: 300 }, (_, i) => 600n * E18 + BigInt(i) * 10n ** 16n + (i % 2 ? 5n * 10n ** 15n : 0n)));
  const book = new FakeRoundBook();
  const store = createMemoryPixStore();
  const svc = new PixServiceImpl({
    store,
    priceHub: hub,
    roundBook: book,
    bus,
    llm: client ? new PixLlm({ client, model: 'claude-haiku-4-5', timeoutMs: 50 }) : undefined,
    llmEnabled: true,
    dailyBudgetUsd: 5,
    chatDailyLimit: 3,
    insightTtlMs: 60_000,
    chatFirstTokenMs: 50,
    now: () => clock.t,
    ...over,
  });
  return { clock, bus, hub, book, store, svc };
}

const settledWin = (id = 7n) =>
  roundDto({ roundId: id, player, entrySec: Math.floor(T0 / 1000) - 60, outcome: 'win', payout: 15n * E18, decisionSec: Math.floor(T0 / 1000) - 48 });

describe('PIX insight via the Anthropic adapter', () => {
  it('uses the structured LLM output on success (factors and sentiment computed in code)', async () => {
    const client = mockClient(async () => ({ stop_reason: 'end_turn', usage, parsed_output: insightOk, content: [] }));
    const { svc } = pixHarness(client);
    const out = MarketInsightSchema.parse(await svc.insight('BNB'));
    expect(out.source).toBe('llm');
    expect(out.headline).toBe(insightOk.headline);
    expect(out.factors.map((f) => f.label)).toEqual(['Volatility', '1m momentum']);
    const [params, opts] = client.messages.parse.mock.calls[0] as [{ model: string; output_config: { format: { type: string } } }, { maxRetries: number }];
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.output_config.format.type).toBe('json_schema');
    expect(opts.maxRetries).toBe(0);
  });

  it.each([
    ['refusal', async () => ({ stop_reason: 'refusal', usage, parsed_output: null, content: [] })],
    ['timeout', () => new Promise(() => {})],
    ['null parse', async () => ({ stop_reason: 'end_turn', usage, parsed_output: null, content: [] })],
    ['parse error', async () => {
      throw new Anthropic.AnthropicError('Failed to parse structured output');
    }],
    ['guardrail violation', async () => ({ stop_reason: 'end_turn', usage, parsed_output: { ...insightOk, summary: 'This is a guaranteed win.' }, content: [] })],
    ['invented number', async () => ({ stop_reason: 'end_turn', usage, parsed_output: { ...insightOk, summary: 'BNB rose 7.77% in an hour.' }, content: [] })],
    ['long headline', async () => ({ stop_reason: 'end_turn', usage, parsed_output: { ...insightOk, headline: 'one two three four five six seven' }, content: [] })],
    ['api error', async () => {
      throw new Anthropic.APIError(529, undefined, 'overloaded', undefined);
    }],
  ] as [string, ParseImpl][])('falls back to the template on %s', async (_name, impl) => {
    const { svc } = pixHarness(mockClient(impl));
    const started = Date.now();
    const out = MarketInsightSchema.parse(await svc.insight('BNB'));
    expect(out.source).toBe('template');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(guardrailViolations(`${out.headline} ${out.summary} ${out.learningTip}`)).toEqual([]);
  });

  it('caches per (asset, tier) for the TTL with single-flight', async () => {
    const client = mockClient(async () => {
      await tick(10);
      return { stop_reason: 'end_turn', usage, parsed_output: insightOk, content: [] };
    });
    const h = pixHarness(client);
    const [a, b] = await Promise.all([h.svc.insight('BNB'), h.svc.insight('BNB')]);
    expect(a).toBe(b);
    await h.svc.insight('BNB');
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
    await h.svc.insight('BNB', 1);
    expect(client.messages.parse).toHaveBeenCalledTimes(2);
    h.clock.t += 61_000;
    await h.svc.insight('BNB');
    expect(client.messages.parse).toHaveBeenCalledTimes(3);
  });

  it('stops calling the LLM once the daily budget is spent, and without a key', async () => {
    const client = mockClient(async () => ({ stop_reason: 'end_turn', usage, parsed_output: insightOk, content: [] }));
    const h = pixHarness(client, { dailyBudgetUsd: 0.0002 }); // 200 micro-USD; one call costs 350
    expect((await h.svc.insight('BNB')).source).toBe('llm');
    expect((await h.svc.insight('ETH')).source).toBe('template');
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
    expect(await h.svc.llmAvailable()).toBe(false);
    h.clock.t += 86_400_000; // budget resets on the next UTC day
    expect(await h.svc.llmAvailable()).toBe(true);

    const none = pixHarness();
    expect((await none.svc.insight('BNB')).source).toBe('template');
  });
});

describe('PIX debrief', () => {
  it('generates once, stores it, and pushes pix.debrief at settle', async () => {
    const client = mockClient(async () => ({ stop_reason: 'end_turn', usage, parsed_output: debriefOk, content: [] }));
    const h = pixHarness(client);
    const pushed: unknown[] = [];
    h.bus.on('player.event', (e) => e.event === 'pix.debrief' && pushed.push(e.payload));
    h.svc.start();
    const dto = settledWin();
    h.book.put(dto);
    h.bus.emit('player.event', { player, event: 'round.settled', payload: dto });
    await tick(20);
    expect(pushed).toHaveLength(1);
    const d = DebriefSchema.parse(await h.svc.debrief(7n));
    expect(d).toMatchObject({ source: 'llm', headline: debriefOk.headline, keyFactors: [{ label: 'Time to target', value: '12s', positive: true }] });
    expect(client.messages.parse).toHaveBeenCalledTimes(1);
    h.svc.stop();
  });

  it('falls back to the correct template branch on a guardrail violation', async () => {
    const client = mockClient(async () => ({ stop_reason: 'end_turn', usage, parsed_output: { ...debriefOk, coachingTip: 'Double down to win it back next round.' }, content: [] }));
    const h = pixHarness(client);
    const dto = roundDto({ roundId: 8n, player, entrySec: Math.floor(T0 / 1000) - 60, outcome: 'timeout', payout: 9n * E18 });
    h.book.put(dto);
    const d = await h.svc.debrief(8n);
    expect(d.source).toBe('template');
    expect(d.analysis).toContain('−$1.00');
    expect(d.headline).not.toMatch(/target/i);
  });

  it('never calls the LLM for voided rounds and rejects unsettled ones', async () => {
    const client = mockClient(async () => ({ stop_reason: 'end_turn', usage, parsed_output: debriefOk, content: [] }));
    const h = pixHarness(client);
    h.book.put(roundDto({ roundId: 9n, player, entrySec: 1000, outcome: 'voided', voidReason: 'stalled', payout: 10n * E18 }));
    expect((await h.svc.debrief(9n)).headline).toBe('Round voided — stake returned.');
    expect(client.messages.parse).not.toHaveBeenCalled();
    h.book.put(roundDto({ roundId: 10n, player, entrySec: 1000, status: 'open' }));
    await expect(h.svc.debrief(10n)).rejects.toBeInstanceOf(ApiError);
    await expect(h.svc.debrief(404n)).rejects.toMatchObject({ code: 'ROUND_NOT_FOUND' });
  });
});

function streamOf(chunks: string[], opts: { hang?: boolean } = {}) {
  return () => {
    let aborted = false;
    return {
      async *[Symbol.asyncIterator]() {
        if (opts.hang) await new Promise(() => {});
        for (const text of chunks) {
          if (aborted) return;
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
        }
      },
      finalMessage: async () => ({ usage, stop_reason: 'end_turn' }),
      abort: () => {
        aborted = true;
      },
    };
  };
}

const collect = async (it: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const s of it) out.push(s);
  return out;
};

describe('PIX chat', () => {
  it('streams whole sentences that passed the gate', async () => {
    const h = pixHarness(mockClient(async () => ({}), streamOf(['Momentum is ', 'building. Volatility ', 'is elevated', '.'])));
    const session = await h.svc.chatSession(player, [{ role: 'user', content: 'what is BNB doing?' }], 'BNB');
    expect(await collect(session.chunks)).toEqual(['Momentum is building.', 'Volatility is elevated.']);
    expect(session.result).toMatchObject({ source: 'llm', usage: { inputTokens: 100, outputTokens: 50 } });
  });

  it('cuts the stream at a guardrail violation and closes safely', async () => {
    const h = pixHarness(mockClient(async () => ({}), streamOf(['Momentum is building. ', 'You should buy now. ', 'It is a sure thing.'])));
    const session = await h.svc.chatSession(player, [{ role: 'user', content: 'should I go long?' }]);
    const out = await collect(session.chunks);
    expect(out[0]).toBe('Momentum is building.');
    expect(out.join(' ')).not.toMatch(/buy now|sure thing/);
    expect(session.result.blocked).toBe(true);
  });

  it('answers from templates on first-token timeout, without a key, and enforces the daily quota', async () => {
    const h = pixHarness(mockClient(async () => ({}), streamOf(['late.'], { hang: true })));
    const s = await h.svc.chatSession(player, [{ role: 'user', content: 'Is it a good time to go long?' }], 'BNB');
    const out = await collect(s.chunks);
    expect(s.result.source).toBe('template');
    expect(out[0]).toMatch(/can’t call where the price goes next/);
    for (const line of out) expect(guardrailViolations(line)).toEqual([]);

    const noKey = pixHarness();
    for (let i = 0; i < 3; i++) await collect((await noKey.svc.chatSession(player, [{ role: 'user', content: 'explain this chart' }])).chunks);
    await expect(noKey.svc.chatSession(player, [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code: 'PIX_QUOTA' });
  });

  it('gates sentence by sentence', () => {
    const g = new SentenceGate();
    expect(g.push('Hello there. How')).toEqual({ sentences: ['Hello there.'], blocked: false });
    expect(g.push(' are you? This is guaranteed')).toEqual({ sentences: ['How are you?'], blocked: false });
    expect(g.flush().blocked).toBe(true);
  });
});

describe('PIX routes (no ANTHROPIC_API_KEY)', () => {
  it('serves template insights, chat over SSE, and credits the owner for opening a debrief', async () => {
    const h = makeHarness();
    const insight = MarketInsightSchema.parse(await (await h.request('/v1/pix/insight?asset=SOL&tier=0')).json());
    expect(insight.source).toBe('template');

    const { token, account } = await h.login();
    const chat = await h.request('/v1/pix/chat', { method: 'POST', token, body: JSON.stringify({ messages: [{ role: 'user', content: 'how does cash out work?' }] }) });
    const s = sseReader(chat);
    await s.until((f) => f.some((x) => x.event === 'pix.done'));
    expect(s.events().filter((f) => f.event === 'pix.delta').length).toBeGreaterThan(0);
    expect(JSON.parse(s.events().at(-1)?.data ?? '{}')).toMatchObject({ source: 'template' });
    expect((await h.request('/v1/pix/chat', { method: 'POST', body: '{}' })).status).toBe(401);

    const dto = roundDto({ roundId: 21n, player: account.address, entrySec: Math.floor(h.clock.t / 1000) - 40, settledAtMs: h.clock.t, outcome: 'loss', payout: 0n });
    h.roundBook.put(dto);
    await h.a4.progression.onRoundFinalized(21n);
    const anon = DebriefSchema.parse(await (await h.request('/v1/pix/debrief/21')).json());
    expect(anon.source).toBe('template');
    const before = h.events.filter((e) => e.event === 'progression.updated').length;
    expect((await h.request('/v1/pix/debrief/21', { token })).status).toBe(200);
    const updates = h.events.filter((e) => e.event === 'progression.updated');
    expect(updates).toHaveLength(before + 1);
    expect(JSON.stringify(updates.at(-1)?.payload)).toContain('debrief_review');
  });
});
