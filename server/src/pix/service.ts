// PixService: insights (cached per asset+tier for PIX_INSIGHT_TTL_S, single-flight),
// debriefs (pre-generated at settle and pushed as `pix.debrief`) and chat (streamed
// through a sentence gate). The LLM is optional: no key, PIX_LLM_ENABLED=false, the
// daily budget kill-switch, a timeout, a refusal, a bad parse or a guardrail hit all
// fall back to the shared templates.

import { getAddress, type Address } from 'viem';
import { assetBySymbol, type AssetSymbol } from '@bnbplay/shared/assets';
import type { DebriefDTO, MarketInsightDTO, RoundDTO } from '@bnbplay/shared/dto';
import { DebriefLLMSchema, InsightLLMSchema, type FactorKey } from '@bnbplay/shared/pix';
import type { Bus } from '../bus.ts';
import type { PixService, PriceHub, RoundBook } from '../ports.ts';
import type { LaneSource, MarketData, RoundHistory } from '../api/deps.ts';
import { ApiError } from '../api/errors.ts';
import { silentLogger, type Logger } from '../api/log.ts';
import { msUntilNextUtcDay, utcDay } from '../api/time.ts';
import { buildDebriefFacts, buildMarketFacts, type Factor, type HubStats } from './context.ts';
import { SentenceGate, allowedNumbers, checkCopy } from './guard.ts';
import { costMicroUsd, type ChatMessage, type LlmUsage, type PixLlm, type StructuredResult } from './llm.ts';
import { CHAT_SYSTEM, DEBRIEF_SYSTEM, INSIGHT_SYSTEM } from './prompts.ts';
import type { LlmKind, LlmOutcome, PixStore } from './store.ts';
import { chatTemplate, debriefTemplate, formatPrice18, insightTemplate } from './templates.ts';

export interface PixDeps {
  store: PixStore;
  priceHub: PriceHub;
  roundBook: Pick<RoundBook, 'toDTO'>;
  bus: Bus;
  history?: RoundHistory;
  marketData?: MarketData;
  lanes?: LaneSource;
  /** Absent when ANTHROPIC_API_KEY is unset → templates only. */
  llm?: PixLlm;
  llmEnabled: boolean;
  dailyBudgetUsd: number;
  chatDailyLimit: number;
  insightTtlMs: number;
  /** First-token deadline for chat (defaults to the LLM timeout budget, 3.5 s). */
  chatFirstTokenMs?: number;
  now?: () => number;
  log?: Logger;
  /** Pre-generation runs on the leader only. */
  isLeader?: () => boolean;
}

export interface ChatSession {
  chunks: AsyncIterable<string>;
  /** Filled in once `chunks` is exhausted. */
  result: { source: 'llm' | 'template'; usage: LlmUsage | null; blocked: boolean };
}

const toDto = (f: Factor) => ({ label: f.label, value: f.value, ...(f.positive !== undefined ? { positive: f.positive } : {}) });

function pickFactors(keys: readonly FactorKey[], available: readonly Factor[], max = 3): Factor[] {
  const out: Factor[] = [];
  for (const k of keys) {
    const f = available.find((x) => x.key === k);
    if (f && !out.includes(f)) out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

const SAFE_STOP = 'I can explain what is moving the market, but I can’t call where it goes next.';

export class PixServiceImpl implements PixService {
  private readonly deps: PixDeps;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly insightCache = new Map<string, { value: MarketInsightDTO; expiresAt: number }>();
  private readonly insightInflight = new Map<string, Promise<MarketInsightDTO>>();
  private readonly debriefInflight = new Map<string, Promise<DebriefDTO>>();
  private readonly stats = new Map<AssetSymbol, HubStats>();
  private spent: { day: string; micro: number } | undefined;
  private unsubs: (() => void)[] = [];

  constructor(deps: PixDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? silentLogger;
  }

  start(): void {
    if (this.unsubs.length) return;
    this.unsubs.push(
      this.deps.bus.on('public.event', (e) => {
        if (e.event !== 'stats') return;
        const p = e.payload as { asset: AssetSymbol; sigma1sPpm: number; momentum60sPpm: number; change24hPct: number | null };
        this.stats.set(p.asset, { sigma1sPpm: p.sigma1sPpm, momentum60sPpm: p.momentum60sPpm, change24hPct: p.change24hPct });
      }),
      this.deps.bus.on('player.event', (e) => {
        if (e.event !== 'round.settled' && e.event !== 'round.voided') return;
        if (this.deps.isLeader && !this.deps.isLeader()) return;
        const roundId = BigInt((e.payload as { roundId: string }).roundId);
        void this.pregenerate(e.player, roundId);
      }),
    );
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Whether the LLM may be called right now (key present, enabled, under the daily budget). */
  async llmAvailable(): Promise<boolean> {
    if (!this.deps.llm || !this.deps.llmEnabled) return false;
    return (await this.spentToday()) < this.deps.dailyBudgetUsd * 1e6;
  }

  // ── Insight ───────────────────────────────────────────────────────────────

  async insight(asset: AssetSymbol, tier?: number): Promise<MarketInsightDTO> {
    const key = `${asset}:${tier ?? '-'}`;
    const hit = this.insightCache.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const pending = this.insightInflight.get(key);
    if (pending) return pending;
    const p = this.buildInsight(asset, tier)
      .then((value) => {
        this.insightCache.set(key, { value, expiresAt: this.now() + this.deps.insightTtlMs });
        return value;
      })
      .finally(() => this.insightInflight.delete(key));
    this.insightInflight.set(key, p);
    return p;
  }

  private async buildInsight(asset: AssetSymbol, tier?: number): Promise<MarketInsightDTO> {
    let lane;
    if (tier !== undefined && this.deps.lanes) {
      const snap = await this.deps.lanes.snapshot().catch(() => undefined);
      lane = snap?.assets.find((a) => a.symbol === asset)?.tiers.find((t) => t.tier === tier);
    }
    const mf = await buildMarketFacts({ asset, priceHub: this.deps.priceHub, marketData: this.deps.marketData, stats: this.stats.get(asset), lane });
    const generatedAtMs = this.now();
    const tpl = insightTemplate({
      asset,
      sentiment: mf.sentiment,
      volatility: mf.volatility,
      factors: mf.factors.slice(0, 3).map(toDto),
      seed: Math.floor(generatedAtMs / 60_000),
    });
    const fallback: MarketInsightDTO = { ...tpl, source: 'template', generatedAtMs };
    if (!(await this.llmAvailable())) return fallback;

    const user = JSON.stringify({ facts: mf.facts, factors: mf.factors.map((f) => ({ key: f.key, label: f.label, value: f.value })) });
    const res = await (this.deps.llm as PixLlm).structured(InsightLLMSchema, INSIGHT_SYSTEM, user, 400);
    if (!res.ok) return this.fallback('insight', null, res, fallback);
    const out = res.output;
    const allowed = allowedNumbers([...Object.values(mf.facts), ...mf.factors.map((f) => `${f.label} ${f.value}`)]);
    const check = checkCopy({ headline: out.headline, prose: [out.summary], tip: out.learningTip }, allowed);
    if (!check.ok) return this.rejected('insight', null, res.usage, check.problems, fallback);
    await this.record('insight', null, 'ok', res.usage);
    const factors = pickFactors(out.factorKeys, mf.factors);
    return {
      headline: out.headline.trim(),
      summary: out.summary.trim(),
      sentiment: mf.sentiment,
      factors: factors.length ? factors.map(toDto) : tpl.factors,
      learningTip: out.learningTip.trim(),
      source: 'llm',
      generatedAtMs,
    };
  }

  // ── Debrief ───────────────────────────────────────────────────────────────

  async debrief(roundId: bigint): Promise<DebriefDTO> {
    const stored = await this.deps.store.getDebrief(roundId);
    if (stored) return stored;
    const key = roundId.toString();
    const pending = this.debriefInflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      const round = this.deps.roundBook.toDTO(roundId) ?? (await this.deps.history?.get(roundId));
      if (!round) throw new ApiError('ROUND_NOT_FOUND', 'round not found');
      if (round.status !== 'settled' || !round.outcome) throw new ApiError('VALIDATION', 'the round has not settled yet', { status: 409 });
      const d = await this.generateDebrief(round);
      return this.deps.store.putDebrief(roundId, round.player.toLowerCase(), d);
    })().finally(() => this.debriefInflight.delete(key));
    this.debriefInflight.set(key, p);
    return p;
  }

  private async pregenerate(player: Address, roundId: bigint): Promise<void> {
    try {
      const debrief = await this.debrief(roundId);
      this.deps.bus.emit('player.event', { player: getAddress(player), event: 'pix.debrief', payload: { roundId: roundId.toString(), debrief } });
    } catch (err) {
      this.log.warn('debrief pre-generation failed', { roundId: roundId.toString(), err: String(err) });
    }
  }

  private async generateDebrief(round: RoundDTO): Promise<DebriefDTO> {
    const df = buildDebriefFacts(round, this.deps.priceHub);
    const dp = assetBySymbol(round.asset).displayDecimals;
    const entry = round.entryPrice ? BigInt(round.entryPrice) : null;
    const exit = round.exitPrice ? BigInt(round.exitPrice) : null;
    const tpl = debriefTemplate({
      asset: round.asset,
      direction: round.terms.direction,
      outcome: round.outcome ?? 'voided',
      stake: BigInt(round.terms.stake),
      payout: BigInt(round.payout ?? round.terms.stake),
      entryPrice: entry,
      exitPrice: exit,
      displayDecimals: dp,
      elapsedSec: df.elapsedSec,
      durationSec: df.durationSec,
      voidReason: round.voidReason,
      factors: df.factors.slice(0, 3).map(toDto),
      seed: Number(BigInt(round.roundId) % 997n),
    });
    const fallback: DebriefDTO = { ...tpl, source: 'template' };
    if (df.branch === 'voided' || !(await this.llmAvailable())) return fallback;

    const facts = { ...df.facts, ...(entry ? { entry: formatPrice18(entry, dp) } : {}), ...(exit ? { exit: formatPrice18(exit, dp) } : {}) };
    const user = JSON.stringify({ facts, factors: df.factors.map((f) => ({ key: f.key, label: f.label, value: f.value })) });
    const player = round.player.toLowerCase();
    const res = await (this.deps.llm as PixLlm).structured(DebriefLLMSchema, DEBRIEF_SYSTEM, user, 500);
    if (!res.ok) return this.fallback('debrief', player, res, fallback);
    const out = res.output;
    const allowed = allowedNumbers([...Object.values(facts), ...df.factors.map((f) => `${f.label} ${f.value}`)]);
    const check = checkCopy({ headline: out.headline, prose: [out.analysis], tip: out.coachingTip }, allowed);
    if (!check.ok) return this.rejected('debrief', player, res.usage, check.problems, fallback);
    await this.record('debrief', player, 'ok', res.usage);
    const factors = pickFactors(out.factorKeys, df.factors);
    return {
      headline: out.headline.trim(),
      analysis: out.analysis.trim(),
      keyFactors: factors.length ? factors.map(toDto) : tpl.keyFactors,
      coachingTip: out.coachingTip.trim(),
      source: 'llm',
    };
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  chat(player: Address, messages: ChatMessage[]): AsyncIterable<string> {
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        const session = await self.chatSession(player, messages);
        yield* session.chunks;
      },
    };
  }

  /** Counts against PIX_CHAT_DAILY_LIMIT (throws PIX_QUOTA), then streams sentences. */
  async chatSession(player: Address, messages: ChatMessage[], asset?: AssetSymbol): Promise<ChatSession> {
    const today = utcDay(this.now());
    const n = await this.deps.store.bumpChat(player.toLowerCase(), today);
    if (n > this.deps.chatDailyLimit) {
      throw new ApiError('PIX_QUOTA', 'PIX chat limit reached for today.', { retryAfterMs: msUntilNextUtcDay(this.now()) });
    }
    const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const insight = asset ? await this.insight(asset).catch(() => null) : null;
    const templateSentences = chatTemplate({ question, asset, insight, factors: insight?.factors ?? [] });
    const result: ChatSession['result'] = { source: 'template', usage: null, blocked: false };
    const templateChunks = async function* () {
      for (const s of templateSentences) yield s;
    };
    if (!(await this.llmAvailable())) return { chunks: templateChunks(), result };

    const context = insight
      ? `\n\nCurrent read for ${asset}: ${insight.headline} ${insight.summary} Factors: ${insight.factors.map((f) => `${f.label} ${f.value}`).join('; ')}.`
      : '';
    const stream = (this.deps.llm as PixLlm).stream(CHAT_SYSTEM + context, messages, 400);
    const firstTokenMs = this.deps.chatFirstTokenMs ?? 3_500;
    const self = this;
    async function* run(): AsyncGenerator<string> {
      const gate = new SentenceGate();
      let sent = 0;
      let outcome: LlmOutcome = 'ok';
      try {
        for (;;) {
          const next = await stream.next(sent === 0 ? firstTokenMs : 15_000);
          if (next === 'timeout') {
            outcome = 'timeout';
            stream.abort();
            break;
          }
          const step = next === null ? gate.flush() : gate.push(next);
          for (const s of step.sentences) {
            sent++;
            result.source = 'llm';
            yield s;
          }
          if (step.blocked) {
            outcome = 'guardrail';
            result.blocked = true;
            stream.abort();
            break;
          }
          if (next === null) break;
        }
      } catch (err) {
        outcome = 'error';
        self.log.warn('pix chat stream failed', { err: String(err) });
      }
      if (sent === 0) {
        // Nothing reached the player: answer from the templates instead.
        result.source = 'template';
        yield* templateChunks();
      } else if (outcome !== 'ok') {
        yield SAFE_STOP;
      }
      const final = await stream.final();
      result.usage = final.usage;
      await self.record('chat', player.toLowerCase(), outcome, final.usage);
    }
    return { chunks: run(), result };
  }

  // ── Budget / usage ────────────────────────────────────────────────────────

  private async spentToday(): Promise<number> {
    const day = utcDay(this.now());
    if (!this.spent || this.spent.day !== day) {
      const micro = await this.deps.store.spentMicroUsd(day).catch(() => 0);
      this.spent = { day, micro };
    }
    return this.spent.micro;
  }

  private async record(kind: LlmKind, player: string | null, outcome: LlmOutcome, usage: LlmUsage | null): Promise<void> {
    const model = this.deps.llm?.model ?? 'none';
    const cost = costMicroUsd(model, usage);
    const day = utcDay(this.now());
    if (this.spent?.day === day) this.spent.micro += cost;
    try {
      await this.deps.store.recordUsage({
        day,
        kind,
        model,
        player,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicroUsd: cost,
        outcome,
      });
    } catch (err) {
      this.log.warn('llm usage record failed', { err: String(err) });
    }
  }

  private async fallback<T>(kind: LlmKind, player: string | null, res: Extract<StructuredResult<unknown>, { ok: false }>, value: T): Promise<T> {
    this.log.info('pix llm fallback', { kind, reason: res.reason, detail: res.detail });
    await this.record(kind, player, res.reason, res.usage);
    return value;
  }

  private async rejected<T>(kind: LlmKind, player: string | null, usage: LlmUsage, problems: string[], value: T): Promise<T> {
    this.log.warn('pix llm copy rejected', { kind, problems: problems.slice(0, 5) });
    await this.record(kind, player, 'guardrail', usage);
    return value;
  }
}
