// Adaptive lanes (docs/spec/F1e-lanes.md §Adaptive lanes), behind ADAPTIVE_LANES_ENABLED.
// Every ADAPTIVE_LANES_INTERVAL_MIN (clamped to 5–15) per asset:
//   σ_recent = bipower σ₁ₛ of the last 30 min of Supra rounds from the hub
//   k = clamp(σ_recent / σ_base, 0.5, 2.0);  T' = round(T·k), S' = round(S·k), gap' = ceil(0.58·σ_recent)
//   setLane only if |k − k_current| / k_current > 20 %, the lane passes validateLane and S' ≥ 10 ppm.
// k_current is implied by the on-chain lane (T_current / T_base). Tiers disabled in the base table,
// or disabled on chain, are never touched (so never enabled). Every change goes to lane_changes.

import { randomUUID } from 'node:crypto';
import { encodeFunctionData, type Address } from 'viem';
import { ASSETS } from '@bnbplay/shared/assets';
import { MIN_BARRIER_PPM } from '@bnbplay/shared/constants';
import { validateLane, type LaneParams } from '@bnbplay/shared/lane';
import { eq } from 'drizzle-orm';
import { laneChanges } from '../db/schema/rounds.ts';
import { arenaAbi } from '../recorder/abi.ts';
import type { ChainIo } from '../relayer/chain.ts';
import { errorMessage, silentLogger, type Logger } from '../relayer/log.ts';
import type { ChainTxSender } from '../relayer/sender.ts';
import type { AnyPgDb } from '../relayer/txlog.ts';

/** F1e base table (config/97.json, laneVersion 1). σ_base is the calibration σ₁ₛ (ppm). */
export const BASE_LANES: Record<number, { sigmaBasePpm: number; tiers: { tier: number; targetPpm: number; stopPpm: number; enabled: boolean }[] }> = {
  0: { sigmaBasePpm: 63.55, tiers: [{ tier: 0, targetPpm: 226, stopPpm: 434, enabled: true }, { tier: 1, targetPpm: 291, stopPpm: 262, enabled: true }] },
  1: { sigmaBasePpm: 52.67, tiers: [{ tier: 0, targetPpm: 207, stopPpm: 397, enabled: true }, { tier: 1, targetPpm: 241, stopPpm: 217, enabled: false }] },
  2: { sigmaBasePpm: 78.19, tiers: [{ tier: 0, targetPpm: 265, stopPpm: 507, enabled: true }, { tier: 1, targetPpm: 358, stopPpm: 323, enabled: true }] },
  3: { sigmaBasePpm: 111.65, tiers: [{ tier: 0, targetPpm: 240, stopPpm: 461, enabled: true }, { tier: 1, targetPpm: 511, stopPpm: 461, enabled: true }] },
  4: { sigmaBasePpm: 173.71, tiers: [{ tier: 0, targetPpm: 374, stopPpm: 717, enabled: true }, { tier: 1, targetPpm: 794, stopPpm: 717, enabled: true }] },
};

export const K_MIN = 0.5;
export const K_MAX = 2.0;
export const CHANGE_THRESHOLD = 0.2;
export const GAP_K = 0.58;
export const WINDOW_SEC = 30 * 60;
export const MIN_SAMPLE_SHARE = 0.8;

export type LaneDecision =
  | { action: 'keep'; k: number; kCurrent: number }
  | { action: 'invalid'; k: number; kCurrent: number; errors: string[] }
  | { action: 'update'; k: number; kCurrent: number; params: LaneParams; gapMarginPpm: number };

export function computeLaneUpdate(input: {
  sigmaRecentPpm: number;
  sigmaBasePpm: number;
  base: { targetPpm: number; stopPpm: number };
  current: LaneParams;
  currentGapMarginPpm: number;
}): LaneDecision {
  const k = Math.min(K_MAX, Math.max(K_MIN, input.sigmaRecentPpm / input.sigmaBasePpm));
  const kCurrent = input.current.targetPpm / input.base.targetPpm;
  if (Math.abs(k - kCurrent) / kCurrent <= CHANGE_THRESHOLD) return { action: 'keep', k, kCurrent };
  const targetPpm = Math.round(input.base.targetPpm * k);
  const stopPpm = Math.round(input.base.stopPpm * k);
  const gapMarginPpm = Math.ceil(GAP_K * input.sigmaRecentPpm);
  const params: LaneParams = { ...input.current, targetPpm, stopPpm };
  // The spec's gap' and the gap the chain will check setLane against must both pass.
  const errors = [...new Set([...validateLane(params, gapMarginPpm), ...validateLane(params, input.currentGapMarginPpm)])];
  if (stopPpm < MIN_BARRIER_PPM) errors.push(`stopPpm < ${MIN_BARRIER_PPM}`);
  if (errors.length > 0) return { action: 'invalid', k, kCurrent, errors };
  return { action: 'update', k, kCurrent, params, gapMarginPpm };
}

export type LaneChangeRow = typeof laneChanges.$inferInsert;

export interface LaneChangeStore {
  insert(row: LaneChangeRow): Promise<void>;
  update(id: string, patch: Partial<LaneChangeRow>): Promise<void>;
}

export class MemoryLaneChangeStore implements LaneChangeStore {
  readonly rows = new Map<string, LaneChangeRow>();
  async insert(row: LaneChangeRow) {
    this.rows.set(row.id, { ...row });
  }
  async update(id: string, patch: Partial<LaneChangeRow>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch });
  }
}

export class PgLaneChangeStore implements LaneChangeStore {
  private readonly db: AnyPgDb;

  constructor(db: AnyPgDb) {
    this.db = db;
  }
  async insert(row: LaneChangeRow) {
    await this.db.insert(laneChanges).values(row);
  }
  async update(id: string, patch: Partial<LaneChangeRow>) {
    await this.db.update(laneChanges).set(patch).where(eq(laneChanges.id, id));
  }
}

export interface SigmaSource {
  sigmaBipower(pairId: number, windowSec?: number): { sigmaPpm: number | null; samples: number };
}

export interface AdaptiveLanesOptions {
  arena: Address;
  hub: SigmaSource;
  sender: ChainTxSender;
  chain: ChainIo;
  store?: LaneChangeStore;
  enabled: () => boolean;
  intervalMin: number;
  log?: Logger;
}

export interface AssetEvaluation {
  assetId: number;
  sigmaRecentPpm: number | null;
  samples: number;
  k: number | null;
  tiers: { tier: number; action: LaneDecision['action'] | 'skipped'; reason?: string; kCurrent?: number }[];
  atMs: number;
}

export class AdaptiveLanes {
  private timer: NodeJS.Timeout | undefined;
  private readonly store: LaneChangeStore;
  private readonly log: Logger;
  private readonly inflight = new Set<string>();
  readonly last = new Map<number, AssetEvaluation>();

  private readonly o: AdaptiveLanesOptions;


  constructor(o: AdaptiveLanesOptions) {

    this.o = o;
    this.store = o.store ?? new MemoryLaneChangeStore();
    this.log = o.log ?? silentLogger;
  }

  intervalMs(): number {
    return Math.min(15, Math.max(5, this.o.intervalMin)) * 60_000;
  }

  start(): void {
    this.timer = setInterval(() => void this.runOnce().catch((err) => this.log.warn('adaptive lanes run failed', { error: errorMessage(err) })), this.intervalMs());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<AssetEvaluation[]> {
    if (!this.o.enabled()) return []; // kill switch: keep the last lanes
    const out: AssetEvaluation[] = [];
    for (const a of ASSETS) {
      const base = BASE_LANES[a.assetId];
      if (!base) continue;
      const { sigmaPpm, samples } = this.o.hub.sigmaBipower(a.supraPairId, WINDOW_SEC);
      const ev: AssetEvaluation = { assetId: a.assetId, sigmaRecentPpm: sigmaPpm, samples, k: null, tiers: [], atMs: Date.now() };
      out.push(ev);
      this.last.set(a.assetId, ev);
      if (sigmaPpm === null || samples < WINDOW_SEC * MIN_SAMPLE_SHARE) {
        ev.tiers = base.tiers.map((t) => ({ tier: t.tier, action: 'skipped', reason: `insufficient data (${samples} returns)` }));
        continue;
      }
      ev.k = Math.min(K_MAX, Math.max(K_MIN, sigmaPpm / base.sigmaBasePpm));
      let gapNow = 0;
      try {
        const asset = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'getAsset', args: [a.assetId] });
        gapNow = asset.gapMarginPpm;
      } catch (err) {
        ev.tiers = base.tiers.map((t) => ({ tier: t.tier, action: 'skipped', reason: `getAsset failed: ${errorMessage(err)}` }));
        continue;
      }
      for (const t of base.tiers) {
        if (!t.enabled) {
          ev.tiers.push({ tier: t.tier, action: 'skipped', reason: 'disabled in the base table' });
          continue;
        }
        const key = `${a.assetId}:${t.tier}`;
        if (this.inflight.has(key)) {
          ev.tiers.push({ tier: t.tier, action: 'skipped', reason: 'change in flight' });
          continue;
        }
        let lane: { p: LaneParams; version: number };
        try {
          lane = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'getLane', args: [a.assetId, t.tier] });
        } catch (err) {
          ev.tiers.push({ tier: t.tier, action: 'skipped', reason: `getLane failed: ${errorMessage(err)}` });
          continue;
        }
        if (!lane.p.enabled) {
          ev.tiers.push({ tier: t.tier, action: 'skipped', reason: 'disabled on chain' });
          continue;
        }
        const d = computeLaneUpdate({ sigmaRecentPpm: sigmaPpm, sigmaBasePpm: base.sigmaBasePpm, base: t, current: lane.p, currentGapMarginPpm: gapNow });
        ev.tiers.push({ tier: t.tier, action: d.action, kCurrent: d.kCurrent, reason: d.action === 'invalid' ? d.errors.join('; ') : undefined });
        if (d.action !== 'update') continue;
        await this.apply(a.assetId, t.tier, lane, d, sigmaPpm, base.sigmaBasePpm, samples);
      }
    }
    return out;
  }

  private async apply(assetId: number, tier: number, lane: { p: LaneParams; version: number }, d: Extract<LaneDecision, { action: 'update' }>, sigma: number, sigmaBase: number, samples: number): Promise<void> {
    const key = `${assetId}:${tier}`;
    const id = randomUUID();
    const now = Date.now();
    const h = this.o.sender.enqueue({
      key: 'ops',
      kind: 'admin',
      to: this.o.arena,
      data: encodeFunctionData({ abi: arenaAbi, functionName: 'setLane', args: [assetId, tier, d.params] }),
      priority: 10,
    });
    this.inflight.add(key);
    await this.store
      .insert({
        id,
        assetId,
        tier,
        fromVersion: lane.version,
        sigmaRecentPpm: sigma,
        sigmaBasePpm: sigmaBase,
        samples,
        k: d.k,
        kPrev: d.kCurrent,
        targetPpmBefore: lane.p.targetPpm,
        stopPpmBefore: lane.p.stopPpm,
        targetPpmAfter: d.params.targetPpm,
        stopPpmAfter: d.params.stopPpm,
        gapMarginPpm: d.gapMarginPpm,
        status: 'submitted',
        txId: h.id,
        createdAtMs: now,
        updatedAtMs: now,
      })
      .catch((err) => this.log.warn('lane_changes insert failed', { error: errorMessage(err) }));
    this.log.info('adaptive lane change', { assetId, tier, k: d.k, kPrev: d.kCurrent, T: `${lane.p.targetPpm}->${d.params.targetPpm}`, S: `${lane.p.stopPpm}->${d.params.stopPpm}` });
    void h.done.then(async (res) => {
      this.inflight.delete(key);
      let toVersion: number | null = null;
      if (res.status === 'confirmed') {
        try {
          const l = await this.o.chain.read.readContract({ address: this.o.arena, abi: arenaAbi, functionName: 'getLane', args: [assetId, tier] });
          toVersion = l.version;
        } catch {
          // version stays null; LaneConfigured in chain_events has it
        }
      }
      await this.store
        .update(id, { status: res.status, txHash: res.txHash ?? null, error: res.error ?? null, toVersion, updatedAtMs: Date.now() })
        .catch((err) => this.log.warn('lane_changes update failed', { error: errorMessage(err) }));
    });
  }
}
