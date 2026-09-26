// TxSender for one hot key (relayer | recorder | ops).
//
// Per job: simulate (eth_call) + estimateGas in parallel before any nonce is taken; a revert
// fails the job with the decoded custom error and no gas spent. Then, under a per-key mutex:
// allocate the next nonce, price it (legacy: max(rpc, floor) × premium, capped), sign locally
// and broadcast to two RPCs. Many jobs can be in flight with consecutive nonces. A tracker polls
// receipts every 250 ms, replaces a stuck tx by fee after `replaceAfterMs`, and detects a nonce
// taken by another transaction. A handle resolves `failed` only when the job can no longer
// land (simulation revert, on-chain revert, definitive rejection, or its nonce consumed).

import { randomUUID } from 'node:crypto';
import { keccak256, type Address, type Hex, type TransactionReceipt } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { ErrorCode } from '@bnbplay/shared/dto';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { Bus } from '../bus.ts';
import type { TxHandle, TxJob, TxKey, TxKind, TxSender, TxStep } from '../ports.ts';
import type { ChainIo } from './chain.ts';
import { apiErrorCode, describeRevert, formatRevert, isRevert, TRANSIENT_REVERTS, type DecodedRevert } from './errors.ts';
import { bumpGasPrice, gasLimitFor, gweiToWei, policyGasPrice } from './gas.ts';
import { errorMessage, silentLogger, type Logger } from './log.ts';
import { noopTxLog, type TxLog, type TxLogRow } from './txlog.ts';

export type SettlementKind = SsePayload<'settlement.step'>['kind'];

export interface SendOptions {
  /** Minimum gas limit, e.g. a per-round allowance for settles estimated on a stale state. */
  gasFloor?: bigint;
  /** Fixed gas limit (skips estimateGas; the eth_call simulation still runs). */
  gasLimit?: bigint;
  /** Also emit `settlement.step` player events for these (player, round) targets. */
  playerSteps?: { kind: SettlementKind; intentId?: string; targets: { player: Address; roundId?: bigint }[] };
  /** Re-send with a fresh nonce if another transaction consumed this job's nonce. */
  idempotent?: boolean;
  /** Keep retrying a transient simulation revert (FutureRound) for this long after enqueue. */
  transientRetryMs?: number;
}

export type SenderJob = TxJob & SendOptions;

export interface TxResult {
  status: 'confirmed' | 'failed';
  txHash?: Hex;
  error?: string;
  errorName?: string;
  errorCode?: ErrorCode;
  receipt?: TransactionReceipt;
}

export interface SenderHandle extends TxHandle {
  done: Promise<TxResult>;
}

export interface ReceiptEvent {
  id: string;
  key: TxKey;
  job: SenderJob;
  receipt: TransactionReceipt;
}

export interface SenderOptions {
  key: TxKey;
  privateKey: Hex;
  chain: ChainIo;
  bus?: Bus;
  txLog?: TxLog;
  log?: Logger;
  gasPriceFloorGwei: number;
  gasPriceMaxGwei: number;
  /** Default gas-price premium for this key (job.gasPremium overrides). */
  premium: number;
  replaceAfterMs: number;
  receiptPollMs?: number;
  maxInFlight?: number;
  gasPriceTtlMs?: number;
  maxGasLimit?: bigint;
}

interface Attempt {
  hash: Hex;
  raw: Hex;
  gasPriceWei: bigint;
  sentAtMs: number;
}

interface Active {
  id: string;
  seq: number;
  job: SenderJob;
  resolve: (r: TxResult) => void;
  createdAtMs: number;
  notBeforeMs: number;
  prepareFailures: number;
  requeues: number;
  step: TxStep | 'queued';
  nonce?: number;
  gas?: bigint;
  minGasPriceWei?: bigint;
  attempts: Attempt[];
  /** Every hash ever signed for this job (receipt lookups), including rejected broadcasts. */
  knownHashes: Hex[];
  lastBroadcastMs: number;
  consumedChecks: number;
  submittedAtMs?: number;
  error?: string;
  errorCode?: string;
}

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

class Signal {
  private wake: (() => void) | undefined;
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(t);
        this.wake = undefined;
        resolve();
      };
    });
  }
  fire(): void {
    this.wake?.();
  }
}

const CHECKPOINT_KINDS: ReadonlySet<TxKind> = new Set(['record', 'record_settle']);
const MAX_ATTEMPTS = 12;

export class ChainTxSender implements TxSender {
  readonly key: TxKey;
  private readonly account: PrivateKeyAccount;
  private readonly chain: ChainIo;
  private readonly bus: Bus | undefined;
  private readonly txLog: TxLog;
  private readonly log: Logger;
  private readonly floorWei: bigint;
  private readonly maxWei: bigint;
  private readonly premium: number;
  private readonly replaceAfterMs: number;
  private readonly receiptPollMs: number;
  private readonly maxInFlight: number;
  private readonly gasPriceTtlMs: number;
  private readonly maxGasLimit: bigint;

  private readonly queue: Active[] = [];
  private readonly inflight = new Map<string, Active>();
  private readonly mutex = new Mutex();
  private readonly signal = new Signal();
  private readonly receiptListeners = new Set<(e: ReceiptEvent) => void>();
  private nextNonce: number | undefined;
  private seq = 0;
  private running = false;
  private worker: Promise<void> | undefined;
  private tracker: NodeJS.Timeout | undefined;
  private tracking = false;
  private trackTick = 0;
  private lastNonceCheckMs = 0;
  private gasCache: { wei: bigint; atMs: number } | undefined;

  constructor(opts: SenderOptions) {
    this.key = opts.key;
    this.account = privateKeyToAccount(opts.privateKey);
    this.chain = opts.chain;
    this.bus = opts.bus;
    this.txLog = opts.txLog ?? noopTxLog;
    this.log = opts.log ?? silentLogger;
    this.floorWei = gweiToWei(opts.gasPriceFloorGwei);
    this.maxWei = gweiToWei(opts.gasPriceMaxGwei);
    this.premium = opts.premium;
    this.replaceAfterMs = opts.replaceAfterMs;
    this.receiptPollMs = opts.receiptPollMs ?? 250;
    this.maxInFlight = opts.maxInFlight ?? 16;
    this.gasPriceTtlMs = opts.gasPriceTtlMs ?? 3000;
    this.maxGasLimit = opts.maxGasLimit ?? 15_000_000n;
  }

  address(): Address {
    return this.account.address;
  }

  async balanceWei(): Promise<bigint> {
    return this.chain.read.getBalance({ address: this.account.address });
  }

  queueDepth(): number {
    return this.queue.length;
  }

  inFlightCount(): number {
    return this.inflight.size;
  }

  onReceipt(cb: (e: ReceiptEvent) => void): () => void {
    this.receiptListeners.add(cb);
    return () => this.receiptListeners.delete(cb);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.mutex.run(() => this.resync());
    } catch (err) {
      this.log.warn('initial nonce sync failed; retrying on first job', { error: errorMessage(err) });
    }
    this.worker = this.workLoop();
    this.tracker = setInterval(() => void this.trackOnce(), this.receiptPollMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.signal.fire();
    if (this.tracker) clearInterval(this.tracker);
    await this.worker;
    for (const j of this.queue.splice(0)) this.finish(j, { status: 'failed', error: 'sender stopped before broadcast' });
    await this.txLog.flush();
  }

  enqueue(job: SenderJob): SenderHandle {
    if (job.key !== this.key) throw new Error(`job for key ${job.key} enqueued on the ${this.key} sender`);
    const id = randomUUID();
    let resolve!: (r: TxResult) => void;
    const done = new Promise<TxResult>((r) => (resolve = r));
    const now = Date.now();
    const a: Active = {
      id,
      seq: this.seq++,
      job,
      resolve,
      createdAtMs: now,
      notBeforeMs: now,
      prepareFailures: 0,
      requeues: 0,
      step: 'queued',
      attempts: [],
      knownHashes: [],
      lastBroadcastMs: 0,
      consumedChecks: 0,
    };
    this.queue.push(a);
    this.persist(a, 'queued');
    this.signal.fire();
    return { id, done };
  }

  // ── worker ────────────────────────────────────────────────────────────────

  private pick(): Active | undefined {
    if (this.inflight.size >= this.maxInFlight) return undefined;
    const now = Date.now();
    let best: Active | undefined;
    for (const a of this.queue) {
      if (a.notBeforeMs > now) continue;
      if (!best || a.job.priority > best.job.priority || (a.job.priority === best.job.priority && a.seq < best.seq)) best = a;
    }
    if (best) this.queue.splice(this.queue.indexOf(best), 1);
    return best;
  }

  private async workLoop(): Promise<void> {
    while (this.running) {
      const a = this.pick();
      if (!a) {
        const soonest = this.queue.reduce((m, j) => Math.min(m, j.notBeforeMs), Number.POSITIVE_INFINITY);
        await this.signal.wait(Number.isFinite(soonest) ? Math.max(5, Math.min(250, soonest - Date.now())) : 250);
        continue;
      }
      try {
        await this.process(a);
      } catch (err) {
        this.log.error('job processing crashed', { id: a.id, kind: a.job.kind, error: errorMessage(err) });
        this.fail(a, `internal: ${errorMessage(err)}`);
      }
    }
  }

  private requeue(a: Active, delayMs: number): void {
    a.notBeforeMs = Date.now() + delayMs;
    a.step = 'queued';
    this.queue.push(a);
  }

  private async process(a: Active): Promise<void> {
    this.setStep(a, 'preparing');
    const sim = await this.simulate(a);
    if ('revert' in sim) {
      const transientWindow = a.job.transientRetryMs ?? 10_000;
      if (TRANSIENT_REVERTS.has(sim.revert.name) && Date.now() - a.createdAtMs < transientWindow) {
        this.requeue(a, 400);
        return;
      }
      this.fail(a, formatRevert(sim.revert), sim.revert.name);
      return;
    }
    if ('transient' in sim) {
      a.prepareFailures++;
      if (a.prepareFailures > 30) {
        this.fail(a, `simulation unavailable: ${sim.transient}`);
        return;
      }
      this.requeue(a, Math.min(2000, 100 * 2 ** Math.min(a.prepareFailures, 5)));
      return;
    }
    await this.mutex.run(() => this.submit(a, sim.gas));
  }

  private async simulate(a: Active): Promise<{ gas: bigint } | { revert: DecodedRevert } | { transient: string }> {
    const { to, data } = a.job;
    const account = this.account.address;
    const [call, est] = await Promise.allSettled([
      this.chain.read.call({ account, to, data }),
      a.job.gasLimit !== undefined ? Promise.resolve(a.job.gasLimit) : this.chain.read.estimateGas({ account, to, data }),
    ]);
    if (call.status === 'rejected') {
      return isRevert(call.reason) ? { revert: describeRevert(call.reason) } : { transient: errorMessage(call.reason) };
    }
    if (est.status === 'rejected') {
      return isRevert(est.reason) ? { revert: describeRevert(est.reason) } : { transient: errorMessage(est.reason) };
    }
    let gas = a.job.gasLimit ?? gasLimitFor(est.value, a.job.gasFloor);
    if (gas > this.maxGasLimit) gas = this.maxGasLimit;
    return { gas };
  }

  private async rpcGasPrice(): Promise<bigint> {
    const c = this.gasCache;
    if (c && Date.now() - c.atMs < this.gasPriceTtlMs) return c.wei;
    try {
      const wei = await this.chain.read.getGasPrice();
      this.gasCache = { wei, atMs: Date.now() };
      return wei;
    } catch {
      return c?.wei ?? this.floorWei;
    }
  }

  private async policyPrice(a: Active): Promise<bigint> {
    return policyGasPrice(await this.rpcGasPrice(), this.floorWei, this.maxWei, a.job.gasPremium ?? this.premium);
  }

  private async resync(): Promise<void> {
    const pending = await this.chain.pendingNonce(this.account.address);
    let inflightNext = 0;
    for (const a of this.inflight.values()) if (a.nonce !== undefined) inflightNext = Math.max(inflightNext, a.nonce + 1);
    const next = Math.max(pending, inflightNext);
    if (this.nextNonce !== next) this.log.info('nonce resync', { key: this.key, from: this.nextNonce ?? null, to: next });
    this.nextNonce = next;
  }

  private async sign(a: Active, nonce: number, gasPriceWei: bigint, gas: bigint): Promise<{ raw: Hex; hash: Hex }> {
    const raw = await this.account.signTransaction({
      chainId: this.chain.chainId,
      type: 'legacy',
      nonce,
      gasPrice: gasPriceWei,
      gas,
      to: a.job.to,
      data: a.job.data,
      value: 0n,
    });
    const hash = keccak256(raw);
    a.knownHashes.push(hash);
    return { raw, hash };
  }

  /** Runs under the key mutex, so no other nonce is allocated meanwhile (rollback is safe). */
  private async submit(a: Active, gas: bigint): Promise<void> {
    let resyncs = 0;
    let bumps = 0;
    for (;;) {
      if (this.nextNonce === undefined) {
        try {
          await this.resync();
        } catch (err) {
          this.requeue(a, 500);
          this.log.warn('nonce sync failed; job requeued', { id: a.id, error: errorMessage(err) });
          return;
        }
      }
      const nonce = this.nextNonce as number;
      this.nextNonce = nonce + 1;
      const policy = await this.policyPrice(a);
      let price = a.minGasPriceWei && a.minGasPriceWei > policy ? a.minGasPriceWei : policy;
      if (price > this.maxWei) price = this.maxWei;
      a.nonce = nonce;
      a.gas = gas;
      this.setStep(a, 'signing');
      const { raw, hash } = await this.sign(a, nonce, price, gas);
      const out = await this.chain.sendRaw(raw);
      if (out.kind === 'accepted' || out.kind === 'ambiguous') {
        if (out.kind === 'ambiguous') this.log.warn('broadcast ambiguous; tracking the tx anyway', { id: a.id, hash, error: out.error });
        const now = Date.now();
        a.attempts.push({ hash, raw, gasPriceWei: price, sentAtMs: now });
        a.lastBroadcastMs = now;
        a.submittedAtMs = now;
        this.inflight.set(a.id, a);
        this.setStep(a, 'submitted', hash);
        return;
      }
      this.nextNonce = nonce; // definitive rejection: the nonce was not used by this tx
      a.nonce = undefined;
      if (out.kind === 'nonce_too_low' && resyncs++ < 4) {
        await this.resyncOrRequeue(a);
        if (this.nextNonce === undefined) return;
        continue;
      }
      if (out.kind === 'replacement_underpriced' && resyncs++ < 4) {
        await this.resyncOrRequeue(a);
        if (this.nextNonce === undefined) return;
        if (this.nextNonce === nonce) a.minGasPriceWei = bumpGasPrice(price, policy, this.maxWei);
        continue;
      }
      if (out.kind === 'underpriced' && bumps++ < 4 && price < this.maxWei) {
        a.minGasPriceWei = bumpGasPrice(price, policy, this.maxWei);
        continue;
      }
      this.fail(a, `${out.kind}: ${out.error}`);
      return;
    }
  }

  private async resyncOrRequeue(a: Active): Promise<void> {
    try {
      await this.resync();
    } catch (err) {
      this.nextNonce = undefined;
      this.requeue(a, 500);
      this.log.warn('nonce resync failed; job requeued', { id: a.id, error: errorMessage(err) });
    }
  }

  // ── tracker ───────────────────────────────────────────────────────────────

  private async trackOnce(): Promise<void> {
    if (this.tracking || this.inflight.size === 0) return;
    this.tracking = true;
    try {
      this.trackTick++;
      const jobs = [...this.inflight.values()].sort((x, y) => (x.nonce ?? 0) - (y.nonce ?? 0));
      const deep = this.trackTick % 4 === 0;
      const receipts = await Promise.all(jobs.map((a) => this.findReceipt(a, deep)));
      for (let i = 0; i < jobs.length; i++) {
        const a = jobs[i];
        const r = receipts[i];
        if (r) await this.complete(a, r);
        else if (Date.now() - a.lastBroadcastMs >= this.replaceAfterMs) await this.mutex.run(() => this.replace(a));
      }
      if (Date.now() - this.lastNonceCheckMs >= 2000 && this.inflight.size > 0) {
        this.lastNonceCheckMs = Date.now();
        let mined: number;
        try {
          mined = await this.chain.latestNonce(this.account.address);
        } catch {
          return;
        }
        for (const a of [...this.inflight.values()]) {
          if (a.nonce === undefined || a.nonce >= mined) continue;
          const r = await this.findReceipt(a, true);
          if (r) await this.complete(a, r);
          else if (++a.consumedChecks >= 2) await this.consumed(a);
        }
      }
    } catch (err) {
      this.log.warn('tracker iteration failed', { error: errorMessage(err) });
    } finally {
      this.tracking = false;
    }
  }

  /** Fast ticks ask the fresh client for the newest attempt; deep ticks (1/s) ask both clients for every hash. */
  private async findReceipt(a: Active, deep: boolean): Promise<TransactionReceipt | undefined> {
    const hashes = deep ? [...a.knownHashes].reverse() : a.attempts.length > 0 ? [a.attempts[a.attempts.length - 1].hash] : [];
    const clients = !deep || this.chain.fresh === this.chain.read ? [this.chain.fresh] : [this.chain.fresh, this.chain.read];
    for (const hash of hashes) {
      for (const client of clients) {
        try {
          return await client.getTransactionReceipt({ hash });
        } catch (err) {
          const name = (err as { name?: string }).name;
          if (name === 'TransactionReceiptNotFoundError') break; // this client answered: not mined (yet)
        }
      }
    }
    return undefined;
  }

  private async replace(a: Active): Promise<void> {
    if (!this.inflight.has(a.id) || a.nonce === undefined || a.gas === undefined) return;
    const last = a.attempts[a.attempts.length - 1];
    const now = Date.now();
    a.lastBroadcastMs = now;
    const policy = await this.policyPrice(a);
    const floor = a.minGasPriceWei && a.minGasPriceWei > last.gasPriceWei ? a.minGasPriceWei : last.gasPriceWei;
    const nextPrice = bumpGasPrice(floor, policy, this.maxWei);
    if (nextPrice <= last.gasPriceWei || a.attempts.length >= MAX_ATTEMPTS) {
      await this.chain.sendRaw(last.raw); // at the cap: keep the tx alive in the pools
      return;
    }
    const { raw, hash } = await this.sign(a, a.nonce, nextPrice, a.gas);
    const out = await this.chain.sendRaw(raw);
    if (out.kind === 'accepted' || out.kind === 'ambiguous') {
      a.attempts.push({ hash, raw, gasPriceWei: nextPrice, sentAtMs: now });
      this.log.info('replaced by fee', { id: a.id, key: this.key, nonce: a.nonce, gasPriceWei: nextPrice, attempt: a.attempts.length });
      this.persist(a, 'submitted');
      return;
    }
    if (out.kind === 'replacement_underpriced' || out.kind === 'underpriced') a.minGasPriceWei = nextPrice;
    else if (out.kind !== 'nonce_too_low') this.log.warn('replacement rejected', { id: a.id, kind: out.kind, error: out.error });
  }

  private async consumed(a: Active): Promise<void> {
    this.inflight.delete(a.id);
    await this.mutex.run(async () => {
      try {
        await this.resync();
      } catch {
        this.nextNonce = undefined;
      }
    });
    if (a.job.idempotent && a.requeues < 2) {
      a.requeues++;
      a.attempts = [];
      a.nonce = undefined;
      a.consumedChecks = 0;
      this.log.warn('nonce consumed by another transaction; re-sending', { id: a.id, kind: a.job.kind });
      this.requeue(a, 0);
      this.signal.fire();
      return;
    }
    this.fail(a, 'nonce consumed by another transaction');
  }

  /** Emits the final step first, then hands the receipt to listeners (the indexer turns its logs into round events). */
  private async complete(a: Active, receipt: TransactionReceipt): Promise<void> {
    if (!this.inflight.delete(a.id)) return;
    let result: TxResult;
    if (receipt.status === 'success') {
      this.setStep(a, 'confirmed', receipt.transactionHash, receipt);
      result = { status: 'confirmed', txHash: receipt.transactionHash, receipt };
    } else {
      const reason = await this.revertReason(a, receipt);
      a.error = formatRevert(reason);
      a.errorCode = apiErrorCode(reason.name);
      this.setStep(a, 'failed', receipt.transactionHash, receipt);
      result = { status: 'failed', txHash: receipt.transactionHash, error: a.error, errorName: reason.name, errorCode: apiErrorCode(reason.name), receipt };
    }
    for (const cb of this.receiptListeners) {
      try {
        cb({ id: a.id, key: this.key, job: a.job, receipt });
      } catch (err) {
        this.log.error('receipt listener failed', { error: errorMessage(err) });
      }
    }
    this.finish(a, result);
    this.signal.fire();
  }

  private async revertReason(a: Active, receipt: TransactionReceipt): Promise<DecodedRevert> {
    if (a.gas !== undefined && receipt.gasUsed >= a.gas) return { name: 'OutOfGas', args: [] };
    try {
      await this.chain.read.call({ account: this.account.address, to: a.job.to, data: a.job.data, blockNumber: receipt.blockNumber - 1n });
      return { name: 'reverted', args: [] };
    } catch (err) {
      return describeRevert(err);
    }
  }

  private fail(a: Active, error: string, errorName?: string): void {
    a.error = error;
    a.errorCode = apiErrorCode(errorName);
    this.inflight.delete(a.id);
    this.setStep(a, 'failed');
    this.finish(a, { status: 'failed', error, errorName, errorCode: apiErrorCode(errorName), txHash: a.attempts.at(-1)?.hash });
    this.signal.fire();
  }

  private finish(a: Active, r: TxResult): void {
    a.resolve(r);
  }

  // ── events + log ──────────────────────────────────────────────────────────

  private setStep(a: Active, step: TxStep, txHash?: Hex, receipt?: TransactionReceipt): void {
    a.step = step;
    const j = a.job;
    this.bus?.emit('tx.step', { id: a.id, kind: j.kind, step, roundId: j.roundId, intentId: j.intentId, txHash, error: step === 'failed' ? a.error : undefined });
    const ps = j.playerSteps;
    if (this.bus && ps) {
      for (const t of ps.targets) {
        const roundId = t.roundId ?? j.roundId;
        this.bus.emit('player.event', {
          player: t.player,
          event: 'settlement.step',
          payload: {
            kind: ps.kind,
            intentId: ps.intentId ?? j.intentId ?? null,
            roundId: roundId === undefined ? null : roundId.toString(),
            step,
            txHash: txHash ?? a.attempts.at(-1)?.hash ?? null,
            error: step === 'failed' ? { code: (a.errorCode as ErrorCode | undefined) ?? 'INTERNAL', message: a.error ?? 'failed' } : null,
          },
        });
      }
    }
    this.persist(a, step, receipt);
  }

  private persist(a: Active, status: TxStep | 'queued', receipt?: TransactionReceipt): void {
    const j = a.job;
    const now = Date.now();
    const last = a.attempts.at(-1);
    const row: TxLogRow = {
      id: a.id,
      key: this.key,
      kind: j.kind,
      fromAddress: this.account.address.toLowerCase(),
      toAddress: j.to.toLowerCase(),
      selector: j.data.slice(0, 10),
      dataHash: keccak256(j.data),
      data: CHECKPOINT_KINDS.has(j.kind) ? null : j.data,
      priority: j.priority,
      roundId: j.roundId?.toString() ?? null,
      intentId: j.intentId ?? null,
      status,
      nonce: a.nonce ?? null,
      gasLimit: a.gas === undefined ? null : Number(a.gas),
      gasPriceWei: last?.gasPriceWei.toString() ?? null,
      txHash: receipt?.transactionHash ?? last?.hash ?? null,
      txHashes: a.attempts.map((x) => x.hash),
      attempts: a.attempts.length,
      blockNumber: receipt ? Number(receipt.blockNumber) : null,
      gasUsed: receipt ? Number(receipt.gasUsed) : null,
      error: a.error ?? null,
      errorCode: a.errorCode ?? null,
      createdAtMs: a.createdAtMs,
      updatedAtMs: now,
      submittedAtMs: a.submittedAtMs ?? null,
      confirmedAtMs: status === 'confirmed' ? now : null,
    };
    this.txLog.write(row);
  }
}
