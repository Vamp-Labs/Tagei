# A3 — Chain services (W2)

**Branch:** `feat/a3-chain` · **Worktree:** `…/Tagei-worktrees/a3-chain` · **Owns:** `server/src/{pricehub,relayer,recorder,ops,indexer,market}/**`, `server/src/db/schema/{oracle,relayer,rounds,chain}.ts`, matching `server/test/*`

## Read first

- `CLAUDE.md` and `docs/spec/F0-repo.md`
- `docs/spec/F1a-contracts.md` (events, errors, recorder timing)
- `docs/spec/F1b-api-sse.md` (steps and events you emit)
- `server/src/{ports,bus,config,leader}.ts` — the frozen boundaries you implement against
- `packages/shared/src/{path,lane,assets,chain}.ts`
- `research/spike-report.md` (polling rate, latency, OracleProofV2 ABI, fixtures)

## Deliverables

1. **Price hub** (`pricehub/`), implementing `PriceHub` from `ports.ts`:
   - poll `POST {SUPRA_REST_URL}/get_proof {pair_indexes:[0,1,3,10,49], chain_type:"evm"}` every `SUPRA_POLL_MS` (200 ms, never overlapping, with jitter and backoff);
   - decode `OracleProofV2` with viem;
   - emit `oracle.round` in order;
   - store rounds and proofs: in-memory ring (30 min) + `oracle_rounds` (3 d) + `oracle_proofs` (6 h, forever if referenced);
   - health `ok < 3 s`, `degraded < 10 s`, `down`;
   - σ₁ₛ EWMA + momentum stats;
   - publish `price`, `stats` and `oracle.status` as `public.event` on the bus.
2. **Senders** (`relayer/`), implementing `TxSender` for the three keys (`relayer`, `recorder`, `ops`):
   - viem wallet clients;
   - serialized nonce allocation with resync on "nonce too low";
   - legacy gas price = `max(rpc, floor)` × premium, capped at max;
   - `estimateGas × 1.25`;
   - receipt polling every 250 ms, replace-by-fee after `RECORDER_REPLACE_AFTER_MS` for the recorder (8 s for the others);
   - `simulateContract` before nonce allocation;
   - `relayer_txs` log;
   - emit `tx.step`.
3. **Recorder + settler** (`recorder/`):
   - while any round is open, submit `CheckpointOracle.record(proof)` for **every** second as soon as the hub sees the round (target mined < t+1.2 s, F1);
   - when `previewSettle` (or the local `evaluatePath`) says a round is decidable, use `recordAndSettle(oracleIdx, proof, ids)` for that second, otherwise `settleMany`;
   - reconcile every 5 s and on boot;
   - emit `round.entry_locked`, `round.touch`, `round.exit_locked` via `player.event`.
4. **Ops** (`ops/`): faucet drips (`TestUSDFaucet` via the ops key) and a `voidStale` watchdog for provably permanent gaps and stalled rounds.
5. **Indexer** (`indexer/`):
   - `getLogs` every `INDEXER_POLL_MS` over the fallback RPCs;
   - upsert `chain_events` on `(tx_hash, log_index)`;
   - maintain `rounds`;
   - mark `finalized` using the `finalized` tag;
   - reorg check via stored block hashes;
   - implement `RoundBook`;
   - emit `chain.event` plus the player events `round.opened`, `round.cashout_requested`, `round.settled`, `round.voided`, `balance`.
6. **Market** (`market/`): Binance data-api `ticker/24hr` (30 s) and `1m` klines (60 s) for 24 h change, seed history and PIX volume features.

## Definition of done

- `pnpm --filter @bnbplay/server typecheck && pnpm --filter @bnbplay/server test` green.
- Integration test on anvil (a stub ABI from F1a until A2's contracts + `MockSupraCommitteeVerifier` land, then the real ones) with a fake Supra REST server: open → record 21 s → TP, SL, timeout, cash-out, void; kill and restart the recorder mid-round; reorg.
- The hub runs for 10 minutes against the real Supra endpoint with no missed seconds (log proof).

## Constraints

- Only A0 generates migrations: provide the drizzle schema files and A0 runs `db:generate`.
- Code against `ports.ts`, `bus.ts` and the shared schemas; never import A4 modules.
- Wire nothing in `server/src/index.ts`. Export a `start(deps)` function per module and A0 wires them.

## v2 notes (after the A1 spike)

- **Stateless verification.** Late and backfilled `record` calls are valid.
  - The recorder archives **every** proof (Postgres; dedupe by hash).
  - It backfills any missing second of an open round from the archive until `endSec + STALL_AFTER_SEC (60 s)`.
  - Inclusion target is soft, ≈ t+2 s, for snappy UX.
- **Record on demand.** Record only the seconds covered by open rounds. Batching 2–5 seconds per tx is allowed. Recording 24/7 would cost ≈ 2.4–4 tBNB/day.
- **Polling.** 5 Hz, phase-aligned between round+150 ms and round+950 ms (rounds appear +0.2–0.65 s after the round start). Reject non-canonical feeds with `isCanonicalRound`.
- **Chain I/O.** Track heads over **WSS** (`wss://bsc-testnet-rpc.publicnode.com`); HTTP "latest" from the bnbchain.org RPCs is ≈ 1.9 s stale. Send txs through two RPCs. Use publicnode for archive reads and forks.
- **Redundancy.** Build the proof archiver so that a second instance (`ROLE=archiver`, P1) can run on another network. Both upsert into the same `oracle_proofs` table.
- **Adaptive lanes (ops, pending the user's G0 decision).** A job that recomputes σ₁ₛ from the hub every 5–15 min and calls `setLane` when the calibrated T/S drift by more than 20 %, bounded within [0.5×, 2×] of `research/lane-params.json`. Keep it behind a flag.
- **Supra monitoring.** Watch `Upgraded` on the Supra proxies and committee key changes (owner `0xaF90…4B7A`), and alert.
