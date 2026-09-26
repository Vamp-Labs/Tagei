// Senders for the three hot keys + the chain I/O they share. A0 wires `createChainIoFromConfig`
// once and passes the ChainIo to every A3 module.

import { formatEther, type Hex } from 'viem';
import type { Bus } from '../bus.ts';
import type { Config } from '../config.ts';
import type { ReadinessCheck, TxKey } from '../ports.ts';
import { createChainIo, type ChainIo } from './chain.ts';
import { createLogger, silentLogger, type Logger } from './log.ts';
import { ChainTxSender, type ReceiptEvent } from './sender.ts';
import { PgTxLog, noopTxLog, type AnyPgDb, type TxLog } from './txlog.ts';

export { createChainIo, type ChainIo, type Head, type HeadTracker } from './chain.ts';
export { ChainTxSender, type ReceiptEvent, type SenderHandle, type SenderJob, type SendOptions, type SettlementKind, type TxResult } from './sender.ts';
export { apiErrorCode, decodeRevert, describeRevert, extractRevertData } from './errors.ts';
export { createLogger, type Logger } from './log.ts';

/** Non-recorder keys replace a stuck tx after 8 s (the recorder uses RECORDER_REPLACE_AFTER_MS). */
export const DEFAULT_REPLACE_AFTER_MS = 8000;

export type ChainConfig = Pick<Config, 'CHAIN_ID' | 'RPC_HTTP_URLS' | 'RPC_WS_URL'>;

export function createChainIoFromConfig(config: ChainConfig, log: Logger = createLogger('chain')): ChainIo {
  return createChainIo({ chainId: config.CHAIN_ID, httpUrls: config.RPC_HTTP_URLS, wsUrl: config.RPC_WS_URL, log });
}

export type SendersConfig = Pick<
  Config,
  | 'RELAYER_PRIVATE_KEY'
  | 'RECORDER_PRIVATE_KEY'
  | 'OPS_PRIVATE_KEY'
  | 'GAS_PRICE_FLOOR_GWEI'
  | 'GAS_PRICE_MAX_GWEI'
  | 'RECORDER_GAS_PREMIUM'
  | 'RECORDER_REPLACE_AFTER_MS'
  | 'RELAYER_MIN_BALANCE_BNB'
>;

export interface SendersDeps {
  config: SendersConfig;
  chain: ChainIo;
  bus: Bus;
  db?: AnyPgDb;
  log?: Logger;
  /** Test hook: overrides for every sender (poll interval, max in flight, …). */
  overrides?: { receiptPollMs?: number; maxInFlight?: number; replaceAfterMs?: Partial<Record<TxKey, number>> };
}

export interface Senders {
  relayer?: ChainTxSender;
  recorder?: ChainTxSender;
  ops?: ChainTxSender;
  all(): ChainTxSender[];
  /** Receipts of every key; the indexer ingests their logs before its next getLogs sweep. */
  onReceipt(cb: (e: ReceiptEvent) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  checks(): ReadinessCheck[];
}

export function createSenders(deps: SendersDeps): Senders {
  const log = deps.log ?? silentLogger;
  const txLog: TxLog = deps.db ? new PgTxLog(deps.db, log.child('txlog')) : noopTxLog;
  const c = deps.config;
  const keys: Record<TxKey, string | undefined> = { relayer: c.RELAYER_PRIVATE_KEY, recorder: c.RECORDER_PRIVATE_KEY, ops: c.OPS_PRIVATE_KEY };
  const out: Partial<Record<TxKey, ChainTxSender>> = {};
  for (const key of ['relayer', 'recorder', 'ops'] as const) {
    const pk = keys[key];
    if (!pk) continue;
    out[key] = new ChainTxSender({
      key,
      privateKey: (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex,
      chain: deps.chain,
      bus: deps.bus,
      txLog,
      log: log.child(key),
      gasPriceFloorGwei: c.GAS_PRICE_FLOOR_GWEI,
      gasPriceMaxGwei: c.GAS_PRICE_MAX_GWEI,
      premium: key === 'recorder' ? c.RECORDER_GAS_PREMIUM : 1,
      replaceAfterMs: deps.overrides?.replaceAfterMs?.[key] ?? (key === 'recorder' ? c.RECORDER_REPLACE_AFTER_MS : DEFAULT_REPLACE_AFTER_MS),
      receiptPollMs: deps.overrides?.receiptPollMs,
      maxInFlight: deps.overrides?.maxInFlight,
    });
  }
  const all = () => Object.values(out).filter((s): s is ChainTxSender => Boolean(s));
  const listeners = new Set<(e: ReceiptEvent) => void>();
  for (const s of all()) s.onReceipt((e) => listeners.forEach((cb) => cb(e)));

  return {
    ...out,
    all,
    onReceipt: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    start: async () => {
      await Promise.all(all().map((s) => s.start()));
    },
    stop: async () => {
      await Promise.all(all().map((s) => s.stop()));
      await txLog.stop();
    },
    checks: () => [
      {
        name: 'sender-balances',
        check: async () => {
          const min = BigInt(Math.round(c.RELAYER_MIN_BALANCE_BNB * 1e6)) * 10n ** 12n;
          const detail: Record<string, string> = {};
          let ok = true;
          for (const s of all()) {
            const wei = await s.balanceWei();
            detail[s.key] = formatEther(wei);
            if (wei < min) ok = false;
          }
          return { ok, detail };
        },
      },
    ],
  };
}

export async function startSenders(deps: SendersDeps): Promise<Senders> {
  const s = createSenders(deps);
  await s.start();
  return s;
}
