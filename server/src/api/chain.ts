// Read-only chain adapters (viem): lanes for /v1/config and the Arena ledger.
// No transactions are sent from here; writes go through A3's TxSender.

import type { Address, PublicClient } from 'viem';
import { ASSETS } from '@bnbplay/shared/assets';
import { arenaAbi, checkpointOracleAbi, priceVerifierAbi } from './arena-abi.ts';
import type { AssetConfigDTO, LaneSnapshot, LaneSource, LedgerReader, TierDTO } from './deps.ts';
import { TIER_LABELS } from './lanes.fixture.ts';
import { silentLogger, type Logger } from './log.ts';

const TIER_COUNT = 4;

export interface ChainLaneSourceOptions {
  client: PublicClient;
  arena: Address;
  ttlMs?: number;
  now?: () => number;
  log?: Logger;
}

export function createChainLaneSource(opts: ChainLaneSourceOptions): LaneSource {
  const ttlMs = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? silentLogger;
  let cached: { snap: LaneSnapshot; expiresAt: number } | undefined;
  let inflight: Promise<LaneSnapshot> | undefined;

  const arena = { address: opts.arena, abi: arenaAbi } as const;

  async function load(): Promise<LaneSnapshot> {
    const [assets, activeOracleIdx] = await Promise.all([
      Promise.all(
        ASSETS.map(async (def): Promise<AssetConfigDTO> => {
          const [asset, lanes] = await Promise.all([
            opts.client.readContract({ ...arena, functionName: 'getAsset', args: [def.assetId] }),
            Promise.all(
              Array.from({ length: TIER_COUNT }, (_, tier) =>
                opts.client.readContract({ ...arena, functionName: 'getLane', args: [def.assetId, tier] }),
              ),
            ),
          ]);
          return {
            assetId: def.assetId,
            symbol: def.symbol,
            pairId: Number(asset.pairId),
            maxJumpPpm: Number(asset.maxJumpPpm),
            gapMarginPpm: Number(asset.gapMarginPpm),
            enabled: asset.enabled,
            tiers: lanes.map(
              (lane, tier): TierDTO => ({
                tier,
                label: TIER_LABELS[tier] ?? 'CRUISE',
                laneVersion: Number(lane.version),
                multiplierBps: Number(lane.p.multiplierBps),
                targetPpm: Number(lane.p.targetPpm),
                stopPpm: Number(lane.p.stopPpm),
                feeBps: Number(lane.p.feeBps),
                durationSec: Number(lane.p.durationSec),
                minStake: lane.p.minStake.toString(),
                maxStake: lane.p.maxStake.toString(),
                enabled: lane.p.enabled,
              }),
            ),
          };
        }),
      ),
      opts.client.readContract({ ...arena, functionName: 'activeOracleIdx' }),
    ]);
    let oracleTrusted = false;
    try {
      const oracle = await opts.client.readContract({ ...arena, functionName: 'oracles', args: [BigInt(activeOracleIdx)] });
      const verifier = await opts.client.readContract({ address: oracle, abi: checkpointOracleAbi, functionName: 'verifier' });
      oracleTrusted = await opts.client.readContract({ address: verifier, abi: priceVerifierAbi, functionName: 'isTrusted' });
    } catch (err) {
      log.warn('oracle trust lookup failed', { err: String(err) });
    }
    return { assets, activeOracleIdx: Number(activeOracleIdx), oracleTrusted, source: 'chain', fetchedAtMs: now() };
  }

  return {
    async snapshot() {
      if (cached && cached.expiresAt > now()) return cached.snap;
      inflight ??= load()
        .then((snap) => {
          cached = { snap, expiresAt: now() + ttlMs };
          return snap;
        })
        .catch((err: unknown) => {
          log.warn('lane refresh failed', { err: String(err) });
          if (cached) return cached.snap; // serve stale rather than failing /v1/config
          throw err;
        })
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}

export function createChainLedger(opts: { client: PublicClient; arena: Address }): LedgerReader {
  return {
    balanceOf: (player) => opts.client.readContract({ address: opts.arena, abi: arenaAbi, functionName: 'balanceOf', args: [player] }),
  };
}
