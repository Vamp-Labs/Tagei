import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoundSchema } from '@bnbplay/shared/dto';
import { Direction, Outcome, VoidReason } from '@bnbplay/shared/enums';
import { ChainRoundBook } from '../../src/indexer/roundBook.ts';
import { MemoryIndexerStore, PgIndexerStore, type IndexerStore } from '../../src/indexer/store.ts';
import { roundToDTO } from '../../src/indexer/types.ts';
import { createTestDb, DATABASE_URL, type TestDb } from '../recorder/harness/db.ts';

const E18 = 10n ** 18n;
const player = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as const;
const opened = (roundId: bigint) => ({
  roundId,
  player,
  assetId: 0,
  terms: { tier: 0, direction: Direction.Long, stake: 10n * E18, maxPayout: 15n * E18, entrySec: 1_790_000_003, endSec: 1_790_000_033, laneVersion: 1, oracleIdx: 0, pairId: 49, targetPpm: 226, stopPpm: 434, multiplierBps: 15_000, feeBps: 100, maxJumpPpm: 15_000 },
} as const);

describe('ChainRoundBook', () => {
  it('projects open → cash-out → settled with valid DTOs, and undoes each step', () => {
    const book = new ChainRoundBook();
    const changes: string[] = [];
    book.onChange((_, c) => changes.push(c));
    const r = book.applyOpened(opened(7n), { txHash: tx(1), blockNumber: 10n, logIndex: 0 }, 0)!;
    expect(book.activeFor(player)?.roundId).toBe(7n);
    expect(r.openedAtMs).toBe(1_790_000_000_000);
    expect(RoundSchema.parse(roundToDTO(r)).status).toBe('open');
    book.setEntryPrice(7n, 612n * E18, 0);
    book.applyCashOut(7n, 1_790_000_010, tx(2), 0);
    expect(book.get(7n)!.terms.endSec).toBe(1_790_000_010);
    expect(roundToDTO(book.get(7n)!).terms.endSec).toBe(1_790_000_033);
    book.applySettled({ roundId: 7n, outcome: Outcome.CashedOut, payout: 9n * E18, pnl: -1n * E18, entryPrice: 612n * E18, exitPrice: 611n * E18, decisionSec: 1_790_000_010, voidReason: VoidReason.None }, { txHash: tx(3), blockNumber: 20n }, 5, 0);
    const dto = RoundSchema.parse(book.toDTO(7n));
    expect(dto).toMatchObject({ status: 'settled', outcome: 'cashed_out', pnl: '-1000000000000000000', exitSec: 1_790_000_010, cashOutRequested: true });
    expect(book.activeFor(player)).toBeUndefined();
    expect(book.lastSettledFor(player)?.roundId).toBe(7n);
    book.undoSettled(7n, 0);
    expect(book.activeFor(player)?.status).toBe('open');
    book.undoCashOut(7n, 0);
    expect(book.get(7n)!.terms).toMatchObject({ endSec: 1_790_000_033, cashOutRequested: false });
    book.undoOpened(7n);
    expect(book.get(7n)).toBeUndefined();
    expect(changes).toEqual(['opened', 'entry', 'cashout', 'settled', 'reverted', 'reverted', 'reverted']);
  });

  it('maps voids: exitPrice null, voidReason label', () => {
    const book = new ChainRoundBook();
    book.applyOpened(opened(8n), { txHash: tx(1), blockNumber: 10n, logIndex: 0 }, 0);
    book.applySettled({ roundId: 8n, outcome: Outcome.Voided, payout: 10n * E18, pnl: 0n, entryPrice: 0n, exitPrice: 0n, decisionSec: 1_790_000_003, voidReason: VoidReason.Stalled }, { txHash: tx(3), blockNumber: 20n }, 5, 0);
    expect(RoundSchema.parse(book.toDTO(8n))).toMatchObject({ outcome: 'voided', voidReason: 'stalled', exitPrice: null, entryPrice: null, payout: '10000000000000000000' });
  });
});

async function roundTrip(store: IndexerStore) {
  const book = new ChainRoundBook();
  const r = book.applyOpened(opened(9n), { txHash: tx(4), blockNumber: 11n, logIndex: 2 }, 1)!;
  book.applyCashOut(9n, 1_790_000_020, tx(5), 1);
  await store.upsertRounds([r]);
  await store.saveCursor({ number: 12n, hash: tx(6) }, 5n);
  await store.upsertEvents([{ txHash: tx(4), logIndex: 2, blockNumber: 11n, blockHash: tx(7), address: '0x0000000000000000000000000000000000000001', name: 'RoundOpened', args: opened(9n) as unknown as Record<string, unknown>, finalized: false, source: 'receipt' }]);
  const [back] = await store.loadRounds(0);
  expect(back).toMatchObject({ roundId: 9n, exitSec: 1_790_000_020, terms: { endSec: 1_790_000_020, cashOutRequested: true, stake: 10n * E18 } });
  expect(await store.loadCursor()).toMatchObject({ number: 12n, finalized: 5n });
  const [ev] = await store.loadUnfinalizedEvents();
  expect((ev.args.terms as { stake: bigint }).stake).toBe(10n * E18);
  await store.markFinalized(11n);
  expect(await store.loadUnfinalizedEvents()).toHaveLength(0);
}

describe('indexer store', () => {
  it('memory round trip', () => roundTrip(new MemoryIndexerStore()));
  describe.skipIf(!DATABASE_URL)('Postgres', () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb();
    });
    afterAll(async () => {
      await t?.drop();
    });
    it('round trip (rounds, cursor, chain_events)', () => roundTrip(new PgIndexerStore(t.db)));
  });
});
