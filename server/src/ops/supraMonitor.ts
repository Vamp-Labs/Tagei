// Supra integrity monitor (F1a §3 "Verifier rotation", spike-report §3.1). Read-only.
// 1. ERC-1967 implementation slot of the pull, storage and committee-verifier proxies vs a baseline.
// 2. `Upgraded` / `AdminChanged` / `OwnershipTransferred` logs on those proxies, and any log at all on
//    the committee verifier (key rotation), since the last checked block.
// 3. Functional check: a fresh hub proof must still pass `requireHashVerified_V2(root, sigs, committee)`,
//    the exact call our StatelessSupraVerifier makes. A failure means new records will revert.
// Alerts are logged at error level and kept in memory (readiness detail).

import { decodeAbiParameters, decodeEventLog, getAddress, type Address, type Hex } from 'viem';
import { bscTestnet } from '@bnbplay/shared/chain';
import { supraOracleProofV2Abi } from '@bnbplay/shared/supra';
import type { ReadinessCheck } from '../ports.ts';
import { supraCommitteeVerifierAbi, supraProxyEventsAbi } from '../recorder/abi.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { describeRevert, formatRevert } from '../relayer/errors.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';

export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

export interface SupraAlert {
  kind: 'implementation_changed' | 'proxy_event' | 'verifier_log' | 'verification_failed';
  target: Address;
  detail: Record<string, unknown>;
  atMs: number;
}

export interface SupraMonitorOptions {
  chain: ChainIo;
  proxies?: { pull: Address; storage: Address; committeeVerifier: Address };
  /** Newest captured proof (the hub's latest round). */
  latestProof: () => Hex | undefined;
  log?: Logger;
  intervalMs?: number;
  maxLogRange?: bigint;
}

export class SupraMonitor {
  readonly alerts: SupraAlert[] = [];
  private readonly baseline = new Map<Address, Address>();
  private lastBlock: bigint | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly log: Logger;
  private readonly proxies: { pull: Address; storage: Address; committeeVerifier: Address };
  lastVerifiedAtMs = 0;

  private readonly o: SupraMonitorOptions;


  constructor(o: SupraMonitorOptions) {

    this.o = o;
    this.log = o.log ?? silentLogger;
    this.proxies = o.proxies ?? { pull: bscTestnet.supra.pull, storage: bscTestnet.supra.storage, committeeVerifier: bscTestnet.supra.committeeVerifier };
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private alert(a: Omit<SupraAlert, 'atMs'>): void {
    const full = { ...a, atMs: Date.now() };
    this.alerts.push(full);
    if (this.alerts.length > 200) this.alerts.shift();
    this.log.error(`ALERT supra ${a.kind}`, { target: a.target, ...a.detail });
  }

  async tick(): Promise<void> {
    const c = this.o.chain.read;
    const targets = [this.proxies.pull, this.proxies.storage, this.proxies.committeeVerifier];
    for (const t of targets) {
      try {
        const slot = await c.getStorageAt({ address: t, slot: IMPLEMENTATION_SLOT });
        if (!slot) continue;
        const impl = getAddress(`0x${slot.slice(-40)}`);
        const prev = this.baseline.get(t);
        if (!prev) this.baseline.set(t, impl);
        else if (prev !== impl) {
          this.alert({ kind: 'implementation_changed', target: t, detail: { from: prev, to: impl } });
          this.baseline.set(t, impl);
        }
      } catch (err) {
        this.log.debug('implementation slot read failed', { target: t, error: errorMessage(err) });
      }
    }
    try {
      const head = await c.getBlockNumber();
      const from = this.lastBlock === undefined ? head - 200n : this.lastBlock + 1n;
      const max = this.o.maxLogRange ?? 5000n;
      const start = head - from > max ? head - max : from;
      if (start <= head) {
        const logs = await c.getLogs({ address: targets, fromBlock: start, toBlock: head });
        for (const l of logs) {
          const addr = getAddress(l.address);
          let name: string | undefined;
          try {
            name = decodeEventLog({ abi: supraProxyEventsAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }).eventName;
          } catch {
            name = undefined;
          }
          if (name) this.alert({ kind: 'proxy_event', target: addr, detail: { event: name, tx: l.transactionHash, block: l.blockNumber } });
          else if (addr === getAddress(this.proxies.committeeVerifier)) this.alert({ kind: 'verifier_log', target: addr, detail: { topic0: l.topics[0] ?? null, tx: l.transactionHash } });
        }
        this.lastBlock = head;
      }
    } catch (err) {
      this.log.debug('proxy log scan failed', { error: errorMessage(err) });
    }
    await this.verifyLatest();
  }

  /** eth_call of requireHashVerified_V2 for every committee of the newest proof. */
  async verifyLatest(): Promise<boolean | undefined> {
    const proof = this.o.latestProof();
    if (!proof) return undefined;
    let data: readonly { committee_id: bigint; root: Hex; sigs: readonly [bigint, bigint] }[];
    try {
      data = decodeAbiParameters(supraOracleProofV2Abi, proof)[0].data;
    } catch {
      return undefined;
    }
    for (const d of data) {
      try {
        await this.o.chain.read.readContract({
          address: this.proxies.committeeVerifier,
          abi: supraCommitteeVerifierAbi,
          functionName: 'requireHashVerified_V2',
          args: [d.root, [d.sigs[0], d.sigs[1]], d.committee_id],
        });
      } catch (err) {
        const r = describeRevert(err);
        if (r.name === 'reverted' && /timeout|fetch|network|http/i.test(String(r.args[0] ?? ''))) return undefined;
        this.alert({ kind: 'verification_failed', target: this.proxies.committeeVerifier, detail: { committee: d.committee_id, root: d.root, error: formatRevert(r) } });
        return false;
      }
    }
    this.lastVerifiedAtMs = Date.now();
    return true;
  }

  readiness(): ReadinessCheck {
    return {
      name: 'supra-integrity',
      check: async () => {
        const recent = this.alerts.filter((a) => Date.now() - a.atMs < 3600_000);
        return { ok: !recent.some((a) => a.kind === 'verification_failed' || a.kind === 'implementation_changed'), detail: { alerts: recent.slice(-10), lastVerifiedAtMs: this.lastVerifiedAtMs } };
      },
    };
  }
}
