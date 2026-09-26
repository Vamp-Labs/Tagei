// Anthropic adapter for PIX (claude-haiku-4-5). Structured outputs via
// `messages.parse` + zodOutputFormat; streaming via `messages.stream`. Every call is
// time-boxed (PIX_TIMEOUT_MS, no retries) and every failure mode is reported as a
// reason so the caller falls back to the templates.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { LlmOutcome } from './store.ts';

export type AnthropicLike = Pick<Anthropic, 'messages'>;

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StructuredResult<T> =
  | { ok: true; output: T; usage: LlmUsage }
  | { ok: false; reason: Exclude<LlmOutcome, 'ok' | 'guardrail'>; usage: LlmUsage | null; detail?: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TextStream {
  /** Resolves with the next text delta, `null` at the end, or throws on error. */
  next(timeoutMs: number): Promise<string | null | 'timeout'>;
  final(): Promise<{ usage: LlmUsage | null; stopReason: string | null }>;
  abort(): void;
}

const TIMEOUT = Symbol('timeout');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<typeof TIMEOUT>((resolve) => (timer = setTimeout(() => resolve(TIMEOUT), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

const usageOf = (u: { input_tokens?: number | null; output_tokens?: number | null } | undefined | null): LlmUsage | null =>
  u ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : null;

export class PixLlm {
  readonly model: string;
  private readonly client: AnthropicLike;
  private readonly timeoutMs: number;

  constructor(opts: { client: AnthropicLike; model: string; timeoutMs: number }) {
    this.client = opts.client;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs;
  }

  async structured<S extends z.ZodType>(schema: S, system: string, user: string, maxTokens: number): Promise<StructuredResult<z.infer<S>>> {
    const controller = new AbortController();
    try {
      const call = this.client.messages.parse(
        {
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { format: zodOutputFormat(schema) },
        },
        { signal: controller.signal, timeout: this.timeoutMs, maxRetries: 0 },
      );
      const msg = await withTimeout(Promise.resolve(call), this.timeoutMs);
      if (msg === TIMEOUT) {
        controller.abort();
        return { ok: false, reason: 'timeout', usage: null };
      }
      const usage = usageOf(msg.usage);
      if (msg.stop_reason === 'refusal') return { ok: false, reason: 'refusal', usage };
      if (msg.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', usage };
      if (msg.parsed_output === null || msg.parsed_output === undefined) return { ok: false, reason: 'null_parse', usage };
      return { ok: true, output: msg.parsed_output as z.infer<S>, usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
        return { ok: false, reason: 'timeout', usage: null };
      }
      if (err instanceof Anthropic.APIError) return { ok: false, reason: 'error', usage: null, detail: `${err.status ?? ''} ${err.message}` };
      // AnthropicError without a status: the structured output failed JSON/zod validation.
      if (err instanceof Anthropic.AnthropicError) return { ok: false, reason: 'parse_error', usage: null, detail: err.message };
      return { ok: false, reason: 'error', usage: null, detail: String(err) };
    }
  }

  stream(system: string, messages: ChatMessage[], maxTokens: number): TextStream {
    const ms = this.client.messages.stream({ model: this.model, max_tokens: maxTokens, system, messages }, { maxRetries: 0 });
    const iter = ms[Symbol.asyncIterator]();
    let pending: Promise<IteratorResult<unknown>> | null = null;
    return {
      async next(timeoutMs) {
        for (;;) {
          pending ??= iter.next();
          const r = await withTimeout(pending, timeoutMs);
          if (r === TIMEOUT) return 'timeout';
          pending = null;
          if (r.done) return null;
          const ev = r.value as { type?: string; delta?: { type?: string; text?: string } };
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) return ev.delta.text;
        }
      },
      async final() {
        try {
          const m = await ms.finalMessage();
          return { usage: usageOf(m.usage), stopReason: m.stop_reason ?? null };
        } catch {
          return { usage: null, stopReason: null };
        }
      },
      abort() {
        try {
          ms.abort();
        } catch {
          // already finished
        }
      },
    };
  }
}

/** Haiku 4.5 list price: $1 / $5 per MTok, i.e. micro-USD per token. Unknown models are priced high. */
const PRICES: Record<string, { in: number; out: number }> = { 'claude-haiku-4-5': { in: 1, out: 5 } };

export const costMicroUsd = (model: string, u: LlmUsage | null): number => {
  if (!u) return 0;
  const p = PRICES[model] ?? { in: 5, out: 25 };
  return u.inputTokens * p.in + u.outputTokens * p.out;
};
