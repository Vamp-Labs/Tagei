import { ASSETS } from '@bnbplay/shared/assets';
import type { SsePayload } from '@bnbplay/shared/sse';
import type { StreamLike } from '../../api/stream';
import { fromPrice18 } from '../../game/units';
import type { AssetSymbol, ExactRound, OracleHealth } from '../../types/market';

export const HUB_HISTORY_SIZE = 120;

export function exactRoundFrom(
  asset: AssetSymbol,
  roundMs: string | number,
  tsMs: number,
  price18: string | bigint,
  lagMs: number | null,
  receivedAtMs: number,
): ExactRound {
  const round = Number(roundMs);
  const price = BigInt(price18);
  return {
    asset,
    price: fromPrice18(price),
    price18: price,
    sec: Math.floor(round / 1000),
    roundMs: round,
    tsMs,
    source: 'hub',
    lagMs,
    receivedAtMs,
  };
}

export class HubPriceSource {
  private readonly stream: StreamLike;
  private readonly historySize: number;
  private readonly now: () => number;
  private readonly histories = new Map<AssetSymbol, ExactRound[]>();
  private readonly changes = new Map<AssetSymbol, number | null>();
  private oracleStatus: OracleHealth | null = null;
  private readonly roundListeners = new Set<(round: ExactRound) => void>();
  private readonly snapshotListeners = new Set<(assets: AssetSymbol[]) => void>();
  private readonly statsListeners = new Set<(asset: AssetSymbol, change24hPct: number | null) => void>();
  private readonly oracleListeners = new Set<(status: OracleHealth) => void>();
  private detach: (() => void) | null = null;
  private starts = 0;

  constructor(stream: StreamLike, options: { historySize?: number; now?: () => number } = {}) {
    this.stream = stream;
    this.historySize = options.historySize ?? HUB_HISTORY_SIZE;
    this.now = options.now ?? (() => Date.now());
  }

  isConfigured(): boolean {
    return this.stream.isConfigured();
  }

  start(): () => void {
    this.starts++;
    if (this.starts === 1) this.attach();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.starts = Math.max(0, this.starts - 1);
      if (this.starts === 0) {
        this.detach?.();
        this.detach = null;
      }
    };
  }

  onRound(listener: (round: ExactRound) => void): () => void {
    return subscribe(this.roundListeners, listener);
  }

  onSnapshot(listener: (assets: AssetSymbol[]) => void): () => void {
    return subscribe(this.snapshotListeners, listener);
  }

  onStats(listener: (asset: AssetSymbol, change24hPct: number | null) => void): () => void {
    return subscribe(this.statsListeners, listener);
  }

  onOracle(listener: (status: OracleHealth) => void): () => void {
    return subscribe(this.oracleListeners, listener);
  }

  history(asset: AssetSymbol): readonly ExactRound[] {
    return this.histories.get(asset) ?? [];
  }

  latest(asset: AssetSymbol): ExactRound | undefined {
    const history = this.histories.get(asset);
    return history ? history[history.length - 1] : undefined;
  }

  change24h(asset: AssetSymbol): number | null {
    return this.changes.get(asset) ?? null;
  }

  oracle(): OracleHealth | null {
    return this.oracleStatus;
  }

  private attach(): void {
    const release = this.stream.retain();
    const offs = [
      this.stream.on('hello', (hello) => this.setOracle(hello.oracle.status)),
      this.stream.on('prices.snapshot', (snapshot) => this.applySnapshot(snapshot)),
      this.stream.on('price', (price) => this.applyPrice(price)),
      this.stream.on('stats', (stats) => this.setChange(stats.asset, stats.change24hPct)),
      this.stream.on('oracle.status', (status) => this.setOracle(status.status)),
    ];
    this.detach = () => {
      offs.forEach((off) => off());
      release();
    };
  }

  private applySnapshot(snapshot: SsePayload<'prices.snapshot'>): void {
    const received = this.now();
    const assets: AssetSymbol[] = [];
    for (const { symbol: asset } of ASSETS) {
      const entry = snapshot.assets[asset];
      if (!entry) continue;
      const rounds = entry.rounds
        .map(([round, tsMs, price]) => exactRoundFrom(asset, round, tsMs, price, null, received))
        .sort((a, b) => a.sec - b.sec)
        .filter((round, index, all) => index === 0 || round.sec > all[index - 1].sec);
      const merged = mergeRounds(this.histories.get(asset) ?? [], rounds).slice(-this.historySize);
      this.histories.set(asset, merged);
      assets.push(asset);
    }
    for (const { symbol: asset } of ASSETS) {
      const stats = snapshot.stats[asset];
      if (stats) this.setChange(asset, stats.change24hPct);
    }
    if (assets.length > 0) for (const listener of [...this.snapshotListeners]) listener(assets);
  }

  private applyPrice(event: SsePayload<'price'>): void {
    const round = exactRoundFrom(event.asset, event.round, event.tsMs, event.price, event.lagMs, this.now());
    const history = this.histories.get(event.asset) ?? [];
    const last = history[history.length - 1];
    if (last && round.sec <= last.sec) return;
    history.push(round);
    if (history.length > this.historySize) history.splice(0, history.length - this.historySize);
    this.histories.set(event.asset, history);
    for (const listener of [...this.roundListeners]) listener(round);
  }

  private setChange(asset: AssetSymbol, change: number | null): void {
    this.changes.set(asset, change);
    for (const listener of [...this.statsListeners]) listener(asset, change);
  }

  private setOracle(status: OracleHealth): void {
    if (status === this.oracleStatus) return;
    this.oracleStatus = status;
    for (const listener of [...this.oracleListeners]) listener(status);
  }
}

function mergeRounds(existing: readonly ExactRound[], incoming: readonly ExactRound[]): ExactRound[] {
  const bySec = new Map<number, ExactRound>();
  for (const round of existing) bySec.set(round.sec, round);
  for (const round of incoming) bySec.set(round.sec, round);
  return [...bySec.values()].sort((a, b) => a.sec - b.sec);
}

function subscribe<T>(set: Set<T>, listener: T): () => void {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
