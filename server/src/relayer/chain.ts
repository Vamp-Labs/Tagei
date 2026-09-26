// Chain I/O for the A3 modules (spike-report §2, §3.2, §7):
// - `read`: HTTP fallback over RPC_HTTP_URLS (bnbchain.org first; their "latest" is ~1.9 s stale).
// - `fresh`: WSS publicnode when configured (newHeads arrive ~0.18 s after the header), else `read`.
// - `archive`: publicnode HTTP for deep history (getLogs catch-up, forks).
// - `sendRaw`: broadcasts one signed tx to two RPCs in parallel.
// - `heads`: WSS newHeads with an HTTP polling fallback.

import { createPublicClient, defineChain, fallback, http, webSocket, type Address, type Chain, type Hex, type PublicClient } from 'viem';
import { classifySendError, type SendErrorKind } from './errors.ts';
import { errorMessage, silentLogger, type Logger } from './log.ts';

export interface Head {
  number: bigint;
  hash: Hex;
  timestamp: number;
  receivedAtMs: number;
}

export interface HeadTracker {
  latest(): Head | undefined;
  /** Chain time: the newest head's timestamp (conservative), wall clock before the first head. */
  nowSec(): number;
  onHead(cb: (head: Head) => void): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type SendOutcome = { kind: 'accepted'; via: string[] } | { kind: Exclude<SendErrorKind, 'already_known'>; error: string };

export interface ChainIo {
  chainId: number;
  chain: Chain;
  read: PublicClient;
  fresh: PublicClient;
  archive: PublicClient;
  heads: HeadTracker;
  sendRaw(serialized: Hex): Promise<SendOutcome>;
  /** Highest `pending` nonce reported by the send RPCs and the fresh client. */
  pendingNonce(address: Address): Promise<number>;
  /** Mined nonce (`latest`) from the fresh client. */
  latestNonce(address: Address): Promise<number>;
  close(): Promise<void>;
}

export interface ChainIoOptions {
  chainId: number;
  httpUrls: string[];
  wsUrl?: string;
  /** Defaults to the first two HTTP URLs. */
  sendUrls?: string[];
  /** Defaults to a publicnode URL from httpUrls, else the whole fallback. */
  archiveUrl?: string;
  headPollMs?: number;
  httpTimeoutMs?: number;
  log?: Logger;
}

export function chainFor(chainId: number, httpUrls: string[]): Chain {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'BNB', symbol: chainId === 97 ? 'tBNB' : 'BNB', decimals: 18 },
    rpcUrls: { default: { http: httpUrls } },
  });
}

class Heads implements HeadTracker {
  private head: Head | undefined;
  private readonly listeners = new Set<(h: Head) => void>();
  private unwatch: (() => void) | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastWsMs = 0;
  private polling = false;

  constructor(
    private readonly ws: PublicClient | undefined,
    private readonly http: PublicClient,
    private readonly pollMs: number,
    private readonly log: Logger,
  ) {}

  latest(): Head | undefined {
    return this.head;
  }

  nowSec(): number {
    return this.head ? this.head.timestamp : Math.floor(Date.now() / 1000);
  }

  onHead(cb: (h: Head) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async start(): Promise<void> {
    if (this.ws) {
      this.unwatch = this.ws.watchBlocks({
        emitOnBegin: true,
        onBlock: (b) => {
          if (b.number === null || b.hash === null) return;
          this.lastWsMs = Date.now();
          this.push({ number: b.number, hash: b.hash, timestamp: Number(b.timestamp), receivedAtMs: Date.now() });
        },
        onError: (err) => this.log.warn('wss head error', { error: errorMessage(err) }),
      });
    }
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  async stop(): Promise<void> {
    this.unwatch?.();
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    // With a healthy WSS feed the HTTP poll only fills in after 3 s of silence.
    if (this.polling || (this.ws && Date.now() - this.lastWsMs < 3000)) return;
    this.polling = true;
    try {
      const b = await this.http.getBlock({ blockTag: 'latest' });
      if (b.number !== null && b.hash !== null) {
        this.push({ number: b.number, hash: b.hash, timestamp: Number(b.timestamp), receivedAtMs: Date.now() });
      }
    } catch (err) {
      this.log.debug('head poll failed', { error: errorMessage(err) });
    } finally {
      this.polling = false;
    }
  }

  private push(h: Head): void {
    const cur = this.head;
    if (cur && (h.number < cur.number || (h.number === cur.number && h.hash === cur.hash))) return;
    this.head = h;
    for (const cb of this.listeners) {
      try {
        cb(h);
      } catch (err) {
        this.log.error('head listener failed', { error: errorMessage(err) });
      }
    }
  }
}

export function createChainIo(opts: ChainIoOptions): ChainIo {
  const log = opts.log ?? silentLogger;
  const timeout = opts.httpTimeoutMs ?? 6000;
  if (opts.httpUrls.length === 0) throw new Error('createChainIo: at least one HTTP RPC URL is required');
  const chain = chainFor(opts.chainId, opts.httpUrls);

  const read = createPublicClient({
    chain,
    transport: fallback(
      opts.httpUrls.map((u) => http(u, { timeout, retryCount: 0 })),
      { rank: false, retryCount: 1, retryDelay: 150 },
    ),
  }) as PublicClient;

  const wsClient = opts.wsUrl
    ? (createPublicClient({ chain, transport: webSocket(opts.wsUrl, { reconnect: { attempts: 1_000_000, delay: 1000 }, keepAlive: { interval: 15_000 }, timeout }) }) as PublicClient)
    : undefined;
  const fresh = wsClient ?? read;

  const archiveUrl = opts.archiveUrl ?? opts.httpUrls.find((u) => u.includes('publicnode'));
  const archive = archiveUrl ? (createPublicClient({ chain, transport: http(archiveUrl, { timeout: 15_000, retryCount: 2 }) }) as PublicClient) : read;

  const sendUrls = (opts.sendUrls && opts.sendUrls.length > 0 ? opts.sendUrls : opts.httpUrls).slice(0, 2);
  const senders = sendUrls.map((url) => ({ url, client: createPublicClient({ chain, transport: http(url, { timeout: 4000, retryCount: 0 }) }) as PublicClient }));

  const heads = new Heads(wsClient, read, opts.headPollMs ?? (wsClient ? 1000 : 500), log.child('heads'));

  async function sendRaw(serialized: Hex): Promise<SendOutcome> {
    const results = await Promise.allSettled(
      senders.map(({ client }) => client.request({ method: 'eth_sendRawTransaction', params: [serialized] })),
    );
    const via: string[] = [];
    const errors: { kind: SendErrorKind; message: string }[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') via.push(senders[i].url);
      else {
        const kind = classifySendError(r.reason);
        if (kind === 'already_known') via.push(senders[i].url);
        else errors.push({ kind, message: errorMessage(r.reason) });
      }
    });
    if (via.length > 0) return { kind: 'accepted', via };
    const order: Exclude<SendErrorKind, 'already_known'>[] = ['nonce_too_low', 'replacement_underpriced', 'underpriced', 'insufficient_funds', 'rejected', 'ambiguous'];
    for (const kind of order) {
      const hit = errors.find((e) => e.kind === kind);
      if (hit) return { kind, error: hit.message };
    }
    return { kind: 'ambiguous', error: 'no send RPC answered' };
  }

  async function pendingNonce(address: Address): Promise<number> {
    const clients = [...senders.map((s) => s.client), fresh];
    const counts = await Promise.allSettled(clients.map((c) => c.getTransactionCount({ address, blockTag: 'pending' })));
    const ok = counts.flatMap((c) => (c.status === 'fulfilled' ? [c.value] : []));
    if (ok.length === 0) throw new Error('pendingNonce: every RPC failed');
    return Math.max(...ok);
  }

  async function latestNonce(address: Address): Promise<number> {
    return fresh.getTransactionCount({ address, blockTag: 'latest' });
  }

  return {
    chainId: opts.chainId,
    chain,
    read,
    fresh,
    archive,
    heads,
    sendRaw,
    pendingNonce,
    latestNonce,
    close: async () => {
      await heads.stop();
      if (wsClient) {
        try {
          const transport = wsClient.transport as { getRpcClient?: () => Promise<{ close(): void }> };
          (await transport.getRpcClient?.())?.close();
        } catch {
          // already closed
        }
      }
    },
  };
}
