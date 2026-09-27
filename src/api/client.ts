import { z } from 'zod';
import {
  ApiErrorSchema,
  AuthChallengeResponseSchema,
  AuthSessionResponseSchema,
  BalanceSchema,
  CashOutResponseSchema,
  ConfigSchema,
  DebriefSchema,
  LeaderboardEntrySchema,
  MarketInsightSchema,
  MarketSnapshotSchema,
  OpenRoundResponseSchema,
  ProfileSchema,
  RoundSchema,
  type ConfigDTO,
  type DebriefDTO,
  type MarketInsightDTO,
  type ProfileDTO,
  type RoundDTO,
  type BalanceDTO,
} from '@bnbplay/shared/dto';
import type { AssetSymbol } from '@bnbplay/shared/assets';
import { ApiError, toApiError } from './errors';
import {
  FaucetClaimSchema,
  HealthSchema,
  OracleProofSchema,
  OracleRoundRecordSchema,
  PIX_CHAT_EVENTS,
  PlayerRoundsPageSchema,
  ReadinessSchema,
  WithdrawResponseSchema,
  type OracleRoundRecord,
  type PixChatEvent,
  type PixChatMessage,
  type PlayerRoundsPage,
  type Readiness,
} from './schemas';
import { createSseParser } from './sse';

export type AuthChallengeResponse = z.infer<typeof AuthChallengeResponseSchema>;
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export interface OpenRoundRequest {
  intent: {
    player: string;
    assetId: number;
    tier: number;
    direction: number;
    stake: string;
    laneVersion: number;
    oracleIdx: number;
    nonce: string;
    deadline: number;
  };
  signature: string;
}

export interface CashOutRequest {
  intent: { player: string; roundId: string; deadline: number };
  signature: string;
}

export interface WithdrawRequest {
  intent: { player: string; to: string; amount: string; nonce: string; deadline: number };
  signature: string;
}

export interface AuthSessionRequest {
  address: string;
  salt: string;
  expiresAt: number;
  signature: string;
  kind: 'guest' | 'wallet';
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string | null;
  fetch?: FetchLike;
  getToken?: () => string | null;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ApiClient {
  private readonly baseUrl: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly getToken: () => string | null;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.getToken = options.getToken ?? (() => null);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  isEnabled(): boolean {
    return this.baseUrl !== null;
  }

  health() {
    return this.request('/healthz', HealthSchema);
  }

  ready(): Promise<Readiness> {
    return this.request('/readyz', ReadinessSchema, { acceptStatuses: [503] });
  }

  config(): Promise<ConfigDTO> {
    return this.request('/v1/config', ConfigSchema);
  }

  marketSnapshots(): Promise<MarketSnapshot[]> {
    return this.request('/v1/market/snapshots', z.array(MarketSnapshotSchema));
  }

  oracleRounds(params: { asset: AssetSymbol; fromSec?: number; toSec?: number; limit?: number }): Promise<OracleRoundRecord[]> {
    return this.request('/v1/oracle/rounds', z.array(OracleRoundRecordSchema), { query: params });
  }

  oracleProof(hash: string): Promise<{ proof: string }> {
    return this.request(`/v1/oracle/proof/${encodeURIComponent(hash)}`, OracleProofSchema);
  }

  authChallenge(address: string): Promise<AuthChallengeResponse> {
    return this.request('/v1/auth/challenge', AuthChallengeResponseSchema, { method: 'POST', body: { address } });
  }

  authSession(body: AuthSessionRequest): Promise<AuthSessionResponse> {
    return this.request('/v1/auth/session', AuthSessionResponseSchema, { method: 'POST', body });
  }

  balance(): Promise<BalanceDTO> {
    return this.request('/v1/me/balance', BalanceSchema, { auth: true });
  }

  claimFaucet(): Promise<{ claimId: string }> {
    return this.request('/v1/faucet/claim', FaucetClaimSchema, { method: 'POST', auth: true, body: {} });
  }

  openRound(body: OpenRoundRequest): Promise<{ intentId: string; intentHash: string }> {
    return this.request('/v1/rounds/open', OpenRoundResponseSchema, { method: 'POST', auth: true, body });
  }

  cashOut(roundId: string, body: CashOutRequest): Promise<{ intentId: string }> {
    return this.request(`/v1/rounds/${encodeURIComponent(roundId)}/cashout`, CashOutResponseSchema, { method: 'POST', auth: true, body });
  }

  withdraw(body: WithdrawRequest): Promise<{ intentId?: string }> {
    return this.request('/v1/me/withdraw', WithdrawResponseSchema, { method: 'POST', auth: true, body });
  }

  round(roundId: string): Promise<RoundDTO> {
    return this.request(`/v1/rounds/${encodeURIComponent(roundId)}`, RoundSchema);
  }

  playerRounds(address: string, cursor?: string): Promise<PlayerRoundsPage> {
    return this.request(`/v1/players/${encodeURIComponent(address)}/rounds`, PlayerRoundsPageSchema, { query: { cursor } });
  }

  profile(address: string): Promise<ProfileDTO> {
    return this.request(`/v1/players/${encodeURIComponent(address)}/profile`, ProfileSchema);
  }

  leaderboard(period: 'weekly' | 'all' = 'weekly'): Promise<LeaderboardEntry[]> {
    return this.request('/v1/leaderboard', z.array(LeaderboardEntrySchema), { query: { period } });
  }

  pixInsight(asset: AssetSymbol, tier?: number): Promise<MarketInsightDTO> {
    return this.request('/v1/pix/insight', MarketInsightSchema, { query: { asset, tier } });
  }

  pixDebrief(roundId: string): Promise<DebriefDTO> {
    return this.request(`/v1/pix/debrief/${encodeURIComponent(roundId)}`, DebriefSchema, { auth: this.getToken() !== null });
  }

  async *pixChat(messages: readonly PixChatMessage[], signal?: AbortSignal): AsyncGenerator<PixChatEvent> {
    const response = await this.send('/v1/pix/chat', { method: 'POST', auth: true, body: { messages }, signal, timeoutMs: 30_000 });
    if (!response.body) throw new ApiError('BAD_RESPONSE', 'PIX chat returned no body', { status: response.status });
    const queue: PixChatEvent[] = [];
    const parser = createSseParser({
      onMessage: (message) => {
        const event = parsePixChatEvent(message.event, message.data);
        if (event) queue.push(event);
      },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
        while (queue.length > 0) {
          const event = queue.shift();
          if (!event) break;
          yield event;
          if (event.type !== 'pix.delta') return;
        }
      }
      parser.push(decoder.decode());
      parser.end();
      yield* queue;
    } finally {
      reader.releaseLock();
    }
  }

  private async request<T>(path: string, schema: z.ZodType<T>, options: RequestOptions & { acceptStatuses?: number[] } = {}): Promise<T> {
    const response = await this.send(path, options);
    const json = await readJson(response);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError('BAD_RESPONSE', `unexpected response from ${path}: ${parsed.error.issues[0]?.message ?? 'invalid'}`, {
        status: response.status,
      });
    }
    return parsed.data;
  }

  private async send(path: string, options: RequestOptions & { acceptStatuses?: number[] }): Promise<Response> {
    if (this.baseUrl === null) throw new ApiError('API_DISABLED', 'The Tagei API is not configured.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth) {
      const token = this.getToken();
      if (!token) throw new ApiError('SESSION_REQUIRED', 'Sign in to continue.');
      headers.Authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}${buildQuery(options.query)}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new ApiError('ABORTED', 'The request was cancelled.', { cause: error });
      if (controller.signal.aborted) throw new ApiError('TIMEOUT', `The request to ${path} timed out.`, { cause: error });
      throw toApiError(error, 'NETWORK');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
    if (response.ok || options.acceptStatuses?.includes(response.status)) return response;
    throw await errorFromResponse(response);
  }
}

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError('BAD_RESPONSE', 'The server returned malformed JSON.', { status: response.status, cause: error });
  }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = null;
  }
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, retryAfterMs } = parsed.data.error;
    return new ApiError(code, message, { status: response.status, retryAfterMs: retryAfterMs ?? null });
  }
  const code = response.status === 401 ? 'SESSION_REQUIRED' : response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL';
  return new ApiError(code, `HTTP ${response.status}`, { status: response.status });
}

function parsePixChatEvent(name: string, data: string): PixChatEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (name === 'pix.delta') {
    const parsed = PIX_CHAT_EVENTS['pix.delta'].safeParse(json);
    return parsed.success ? { type: 'pix.delta', text: parsed.data.text } : null;
  }
  if (name === 'pix.done') {
    const parsed = PIX_CHAT_EVENTS['pix.done'].safeParse(json);
    return parsed.success ? { type: 'pix.done', usage: parsed.data.usage ?? null } : null;
  }
  if (name === 'pix.error') {
    const parsed = PIX_CHAT_EVENTS['pix.error'].safeParse(json);
    return parsed.success ? { type: 'pix.error', code: parsed.data.code, message: parsed.data.message ?? null } : null;
  }
  return null;
}

export type RoundApi = Pick<ApiClient, 'config' | 'openRound' | 'cashOut' | 'round' | 'playerRounds'>;
