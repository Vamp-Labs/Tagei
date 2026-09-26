// Shared test fakes for A4: in-memory PriceHub, RoundBook and TxSender (the A3
// ports), an app harness around createA4 + createApp, login/sign helpers and an
// SSE frame reader for app.request() streams.

import type { Hono } from 'hono';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { assetById } from '@bnbplay/shared/assets';
import type { RoundDTO } from '@bnbplay/shared/dto';
import { apiDomain, arenaDomain, arenaTypes, loginTypes, packKeyedNonce } from '@bnbplay/shared/eip712';
import { Direction } from '@bnbplay/shared/enums';
import { maxPayout } from '@bnbplay/shared/lane';
import { createApp } from '../../src/app.ts';
import { Bus, type BusEvents } from '../../src/bus.ts';
import { loadConfig } from '../../src/config.ts';
import type { OracleRound, OracleStatus, PriceHub, RoundBook, RoundState, TxHandle, TxJob, TxKey, TxSender } from '../../src/ports.ts';
import { createA4, type A4Deps } from '../../src/api/index.ts';
import { createFixtureLaneSource } from '../../src/api/lanes.fixture.ts';
import { silentLogger } from '../../src/api/log.ts';
import { nullMarketData } from '../../src/pix/market-data.ts';

export const E18 = 10n ** 18n;
export const ARENA = '0x1111111111111111111111111111111111111111' as Address;
export const FAUCET = '0x2222222222222222222222222222222222222222' as Address;
export const CONTRACTS = {
  arena: ARENA,
  checkpointOracle: '0x3333333333333333333333333333333333333333' as Address,
  testUsd: '0x4444444444444444444444444444444444444444' as Address,
  faucet: FAUCET,
};
/** 2026-09-26 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 8, 26, 12, 0, 0);

export class FakePriceHub implements PriceHub {
  statusValue: OracleStatus = 'ok';
  readonly rounds = new Map<number, OracleRound[]>();
  readonly proofs = new Map<number, { proof: Hex; proofHash: Hex }>();
  async start() {}
  async stop() {}
  status() {
    return { status: this.statusValue, lagMsP50: 250, pairs: {} };
  }
  latest(pairId: number) {
    const rs = this.rounds.get(pairId);
    return rs?.[rs.length - 1];
  }
  history(pairId: number, limit: number) {
    return (this.rounds.get(pairId) ?? []).slice(-limit);
  }
  proofForSecond(sec: number) {
    return this.proofs.get(sec);
  }
  waitForSecond(): Promise<OracleRound> {
    return Promise.reject(new Error('not in fake'));
  }
  /** Adds one round per second starting at `fromSec`. */
  seed(pairId: number, fromSec: number, prices: bigint[]): OracleRound[] {
    const list = this.rounds.get(pairId) ?? [];
    prices.forEach((price18, i) => {
      const sec = fromSec + i;
      const proof = toHex(`proof-${sec}`);
      const proofHash = keccak256(proof);
      this.proofs.set(sec, { proof, proofHash });
      list.push({ pairId, roundMs: BigInt(sec) * 1000n, sec, tsMs: sec * 1000 + 300, price18, proofHash, receivedAtMs: sec * 1000 + 500 });
    });
    this.rounds.set(pairId, list);
    return list;
  }
}

export class FakeRoundBook implements RoundBook {
  readonly states = new Map<string, RoundState>();
  readonly dtos = new Map<string, RoundDTO>();
  open() {
    return [...this.states.values()].filter((s) => s.status === 'open');
  }
  get(roundId: bigint) {
    return this.states.get(roundId.toString());
  }
  activeFor(player: Address) {
    return [...this.states.values()].find((s) => s.status === 'open' && s.player.toLowerCase() === player.toLowerCase());
  }
  toDTO(roundId: bigint) {
    return this.dtos.get(roundId.toString());
  }
  put(dto: RoundDTO): void {
    this.dtos.set(dto.roundId, dto);
    this.states.set(dto.roundId, {
      roundId: BigInt(dto.roundId),
      player: getAddress(dto.player),
      assetId: dto.assetId,
      pairId: dto.terms.pairId,
      terms: {
        direction: dto.terms.direction === 'LONG' ? Direction.Long : Direction.Short,
        stake: BigInt(dto.terms.stake),
        maxPayout: BigInt(dto.terms.maxPayout),
        entrySec: dto.terms.entrySec,
        endSec: dto.terms.endSec,
        targetPpm: dto.terms.targetPpm,
        stopPpm: dto.terms.stopPpm,
        multiplierBps: dto.terms.multiplierBps,
        feeBps: dto.terms.feeBps,
        maxJumpPpm: dto.terms.maxJumpPpm,
        cashOutRequested: dto.cashOutRequested,
      },
      openTx: dto.openTx as Hex,
      status: dto.status,
    });
  }
}

export class FakeSender implements TxSender {
  readonly key: TxKey;
  readonly jobs: (TxJob & { handleId: string })[] = [];
  balance = 10n ** 18n;
  private readonly resolvers = new Map<string, (r: { status: 'confirmed' | 'failed'; txHash?: Hex; error?: string }) => void>();
  private n = 0;
  constructor(key: TxKey) {
    this.key = key;
  }
  address(): Address {
    return '0x5555555555555555555555555555555555555555';
  }
  enqueue(job: TxJob): TxHandle {
    const id = `${this.key}-${++this.n}`;
    this.jobs.push({ ...job, handleId: id });
    const done = new Promise<{ status: 'confirmed' | 'failed'; txHash?: Hex; error?: string }>((resolve) => this.resolvers.set(id, resolve));
    return { id, done };
  }
  async balanceWei() {
    return this.balance;
  }
  finish(handleId: string, r: { status: 'confirmed' | 'failed'; txHash?: Hex; error?: string }): void {
    this.resolvers.get(handleId)?.(r);
  }
}

export interface RoundSpec {
  roundId: bigint;
  player: Address;
  assetId?: number;
  tier?: number;
  direction?: 'LONG' | 'SHORT';
  stake?: bigint;
  multiplierBps?: number;
  entrySec: number;
  durationSec?: number;
  status?: 'open' | 'settled';
  outcome?: RoundDTO['outcome'];
  payout?: bigint | null;
  exitSec?: number | null;
  decisionSec?: number | null;
  cashOutRequested?: boolean;
  settledAtMs?: number | null;
  voidReason?: RoundDTO['voidReason'];
}

export function roundDto(s: RoundSpec): RoundDTO {
  const assetId = s.assetId ?? 0;
  const asset = assetById(assetId);
  const stake = s.stake ?? 10n * E18;
  const m = s.multiplierBps ?? 15_000;
  const status = s.status ?? 'settled';
  const endSec = s.entrySec + (s.durationSec ?? 30);
  const payout = s.payout === undefined ? (status === 'settled' ? stake : null) : s.payout;
  return {
    roundId: s.roundId.toString(),
    player: s.player,
    assetId,
    asset: asset.symbol,
    status,
    terms: {
      tier: s.tier ?? 0,
      direction: s.direction ?? 'LONG',
      stake: stake.toString(),
      maxPayout: maxPayout(stake, m).toString(),
      entrySec: s.entrySec,
      endSec,
      laneVersion: 1,
      oracleIdx: 0,
      pairId: asset.supraPairId,
      targetPpm: 226,
      stopPpm: 434,
      multiplierBps: m,
      feeBps: 100,
      maxJumpPpm: 15_000,
    },
    entryPrice: status === 'settled' ? (600n * E18).toString() : null,
    cashOutRequested: s.cashOutRequested ?? false,
    exitSec: s.exitSec ?? null,
    outcome: status === 'settled' ? (s.outcome ?? 'timeout') : null,
    voidReason: s.voidReason ?? null,
    payout: payout === null ? null : payout.toString(),
    pnl: payout === null ? null : (payout - stake).toString(),
    exitPrice: status === 'settled' ? (601n * E18).toString() : null,
    decisionSec: s.decisionSec ?? (status === 'settled' ? endSec : null),
    openTx: `0x${'ab'.repeat(32)}`,
    settleTx: status === 'settled' ? `0x${'cd'.repeat(32)}` : null,
    openedAtMs: s.entrySec * 1000 - 3000,
    settledAtMs: status === 'settled' ? (s.settledAtMs ?? (s.decisionSec ?? endSec) * 1000 + 1500) : null,
  };
}

export interface Harness {
  app: Hono;
  a4: ReturnType<typeof createA4>;
  bus: Bus;
  hub: FakePriceHub;
  roundBook: FakeRoundBook;
  relayer: FakeSender;
  ops: FakeSender;
  clock: { t: number };
  events: BusEvents['player.event'][];
  request(path: string, init?: RequestInit & { ip?: string; token?: string }): Promise<Response>;
  login(account?: PrivateKeyAccount, kind?: 'guest' | 'wallet', ip?: string): Promise<{ token: string; account: PrivateKeyAccount }>;
}

export function makeHarness(opts: { env?: Record<string, string>; deps?: Partial<A4Deps> } = {}): Harness {
  const clock = { t: T0 };
  const now = () => clock.t;
  const config = loadConfig({ NODE_ENV: 'test', TRUST_PROXY: 'true', JWT_SECRET: 'test-secret', IP_HASH_SALT: 'salt', ...opts.env });
  const bus = new Bus();
  const hub = new FakePriceHub();
  const roundBook = new FakeRoundBook();
  const relayer = new FakeSender('relayer');
  const ops = new FakeSender('ops');
  const events: BusEvents['player.event'][] = [];
  bus.on('player.event', (e) => events.push(e));
  const a4 = createA4({
    config,
    bus,
    priceHub: hub,
    roundBook,
    senders: { relayer, ops },
    contracts: CONTRACTS,
    lanes: createFixtureLaneSource(now),
    marketData: nullMarketData,
    now,
    log: silentLogger,
    ...opts.deps,
  });
  const app = createApp({ version: 'test', corsOrigins: [], checks: a4.checks, routers: a4.routers });
  a4.start();
  const request: Harness['request'] = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-forwarded-for', init.ip ?? '10.0.0.1');
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return Promise.resolve(app.request(path, { ...init, headers }));
  };
  const login: Harness['login'] = async (account = privateKeyToAccount(generatePrivateKey()), kind = 'guest', ip) => {
    const ch = (await (await request('/v1/auth/challenge', { method: 'POST', body: JSON.stringify({ address: account.address }), ip })).json()) as {
      salt: Hex;
      expiresAt: number;
      chainId: number;
    };
    const signature = await account.signTypedData({
      domain: apiDomain(ch.chainId),
      types: loginTypes,
      primaryType: 'Login',
      message: { player: account.address, salt: ch.salt, expiresAt: ch.expiresAt },
    });
    const res = await request('/v1/auth/session', {
      method: 'POST',
      body: JSON.stringify({ address: account.address, salt: ch.salt, expiresAt: ch.expiresAt, signature, kind }),
      ip,
    });
    const body = (await res.json()) as { token: string };
    return { token: body.token, account };
  };
  return { app, a4, bus, hub, roundBook, relayer, ops, clock, events, request, login };
}

export async function signOpen(
  account: PrivateKeyAccount,
  o: { assetId?: number; tier?: number; direction?: number; stake?: bigint; laneVersion?: number; oracleIdx?: number; seq?: bigint; deadline: number },
) {
  const intent = {
    player: account.address,
    assetId: o.assetId ?? 0,
    tier: o.tier ?? 0,
    direction: o.direction ?? 0,
    stake: o.stake ?? 10n * E18,
    laneVersion: o.laneVersion ?? 1,
    oracleIdx: o.oracleIdx ?? 0,
    nonce: packKeyedNonce(0n, o.seq ?? 0n),
    deadline: o.deadline,
  };
  const signature = await account.signTypedData({ domain: arenaDomain(97, ARENA), types: { OpenRound: arenaTypes.OpenRound }, primaryType: 'OpenRound', message: intent });
  return { intent: { ...intent, stake: intent.stake.toString(), nonce: intent.nonce.toString() }, signature };
}

export async function signCashOut(account: PrivateKeyAccount, roundId: bigint, deadline: number) {
  const intent = { player: account.address, roundId, deadline };
  const signature = await account.signTypedData({ domain: arenaDomain(97, ARENA), types: { CashOut: arenaTypes.CashOut }, primaryType: 'CashOut', message: intent });
  return { intent: { ...intent, roundId: roundId.toString() }, signature };
}

export async function signWithdraw(account: PrivateKeyAccount, amount: bigint, deadline: number) {
  const intent = { player: account.address, to: account.address, amount, nonce: packKeyedNonce(1n, 0n), deadline };
  const signature = await account.signTypedData({ domain: arenaDomain(97, ARENA), types: { Withdraw: arenaTypes.Withdraw }, primaryType: 'Withdraw', message: intent });
  return { intent: { ...intent, amount: amount.toString(), nonce: intent.nonce.toString() }, signature };
}

export interface SseFrame {
  event?: string;
  id?: string;
  data?: string;
  comment?: string;
}

/** Incremental SSE parser over a Response body. */
export function sseReader(res: Response) {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let buf = '';
  let pending: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> | null = null;
  const frames: SseFrame[] = [];
  const parse = () => {
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const f: SseFrame = {};
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) f.comment = line.slice(1).trim();
        else if (line.startsWith('event: ')) f.event = line.slice(7);
        else if (line.startsWith('id: ')) f.id = line.slice(4);
        else if (line.startsWith('data: ')) f.data = (f.data ?? '') + line.slice(6);
      }
      frames.push(f);
    }
  };
  return {
    frames,
    events: () => frames.filter((f) => f.event),
    async until(pred: (frames: SseFrame[]) => boolean, timeoutMs = 2000): Promise<SseFrame[]> {
      const deadline = Date.now() + timeoutMs;
      while (!pred(frames)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`sse timeout; got ${JSON.stringify(frames.map((f) => f.event ?? f.comment))}`);
        pending ??= reader.read();
        const r = await Promise.race([pending, new Promise<'t'>((res) => setTimeout(() => res('t'), left))]);
        if (r === 't') continue;
        pending = null;
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        parse();
      }
      return frames;
    },
    close: () => reader.cancel(),
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
