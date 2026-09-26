# A1 spike: Supra DORA-2 pull oracle on BSC testnet (chainId 97)

Date: 2026-09-26 · branch `feat/a1-spike` · everything lives in `research/`.

Legend: **[M]** measured in this spike · **[I]** inferred/derived from measurements · **[D]** from public docs/articles.
No transaction was sent to chain 97. Real-chain work was `eth_call`/`eth_estimateGas` only. All state-changing tests ran on a local anvil fork.

---

## 0. Verdict: **GO for Supra DORA-2, with conditions**

**GO, provided the contracts use stateless verification and the recorder archives every proof.** The lane design needs a product decision (section 6) before real value is at stake.

Why GO:

1. **Availability [M].** Over the 60 min recording, 100 % of seconds had a round for all 5 pairs. There were no gaps, 0 errors and 0 HTTP 429 (also 0 at 10 Hz).
2. **Determinism [M].** Each (pair, round) had exactly one value and one proof hash, and `round == floor(ts/1000)*1000` always held. No proof mixed rounds and the served round never went backwards. Every proof was exactly 2304 bytes.
3. **Latency [M].** A new round is first seen p50 **0.40 s**, p95 **0.60 s** and p99 **0.63 s** after the round start. The feed `ts` sits about 0.16 s after the round start.
4. **On-chain [M].** BLS (BN254) verification works on chain 97. The EVM is Cancun-level: TSTORE/TLOAD, MCOPY, PUSH0 and BLOBBASEFEE all work, so `ReentrancyGuardTransient` is fine.
5. **Stateless verification works [M].** The verifier `requireHashVerified_V2(root, sig, committeeId)` is a permissionless view. It is declared in Supra's own verified interface and is exactly what Supra's pull contract calls. The Merkle leaf encoding was recovered from an opcode trace and matches the verified source. A PoC proves **historical** rounds (this removes F1) for about 270-300k gas instead of about 460k.
6. **Not vulnerable to the Bonzo pattern [M].** The July 2026 Hedera exploit used a zero signature with a zero key. On chain 97 the verifier rejects identity and off-curve points (`BLSInvalidPublicKeyorSignaturePoints`) for every committee id tested, including ids 2+ whose keys are zero.

Conditions and caveats (why it is not an unconditional GO):

- `requireHashVerified_V2` is not a documented third-party integration API. It is, however, part of Supra's verified `ISupraSValueFeedVerifier` interface [M]. It sits behind UUPS proxies owned by `0xaF90E04a87743312000607d0F6a0519892454B7A`, so Supra can change it or rotate committee keys. Keep the verifier address admin-updatable (timelocked), and design a fallback path (section 8).
- `/get_proof` serves **only the latest** proof. No request field for history exists: REST rejects unknown fields and the gRPC proto has only `pair_indexes` and `chain_type` [M]. **Our recorder is the only archive**, so run two of them.
- Nobody else pushes to Supra storage on testnet: all 5 pairs were about 2.3 h stale [M]. Our recorder is therefore the sole liveness source.
- **Lane economics are not validated [M].** On the recorded hour's Supra path, a trivial player who bets the direction of Binance's last 5 s beats the house on CRUISE and BOOST for every asset. At entry delays of 2-8 s the house edge is −0.4 % to −11.9 %, and Supra-only 5 s momentum is negative-edge on all 20 lanes. The oracle is sound; the payout design leaks (section 6.3).
- F1 is real [M]. Stateful `verifyOracleProofV2` cannot prove history, and it lets anyone who pushes a newer proof first make a checkpoint unrecordable, which would force a void. **Do not build the CheckpointOracle on `verifyOracleProofV2`.**

---

## 1. What was run

| step | details |
|---|---|
| Recorder | `scripts/record-supra.mjs`. A drift-free fixed schedule fires requests even while earlier ones are in flight, so the sampling rate does not depend on RTT. It ran at 5 Hz for 3600 s, preceded by a 30 s burst at 10 Hz. The BSC latest block was logged every 10 s. Unique raw proofs went to a sidecar file. |
| Clock | systemd-timesyncd, synchronised; last offset −19 ms, jitter 28 ms, root distance 9 ms **[M]**. All latencies carry roughly ±30 ms. |
| Analysis | `scripts/analyze-recording.mjs` → `results/t1-metrics.json` |
| Fixture | `scripts/capture-fixture.mjs` → `fixtures/supra-97-1790414769.json` |
| On-chain | `scripts/onchain-tests.mjs` → `results/t3-onchain.json`. It combines real-chain `eth_call` (including block-time overrides) with an anvil fork at the fixture block. Stateless PoC: `poc/src/StatelessSupraVerifier.sol`. |
| Lanes | `scripts/fetch-binance-1s.mjs` downloads 7 d of Binance 1 s closes: 604,800 s per asset, 0 missing, 2026-09-19T09:24Z to 2026-09-26T09:24Z. `scripts/calibrate-lanes.mjs` then writes `lane-params.json` and `results/t4-*.json`. |
| RTT | `scripts/measure-rtt.mjs` → `results/t5-rtt.json` |

Reproduce with `cd research && pnpm install --ignore-workspace`, then run the scripts in the order above (usage notes are in each file header).

---

## 2. Metrics (T1, all [M])

<!-- T1_TABLES:BEGIN -->
### T1 recording: main-1790414012, 3600 s at 5 Hz (2026-09-26T09:13:32.129Z)

| pair | rounds seen | seconds spanned | missing | % seconds with a round | longest gap (s) | first-seen − round start p50 / p95 / p99 / max (ms) |
|---|---|---|---|---|---|---|
| BTC (0) | 3600 | 3600 | 0 | 100% | 0 | 400 / 602 / 630 / 1416 |
| ETH (1) | 3600 | 3600 | 0 | 100% | 0 | 400 / 602 / 630 / 1416 |
| DOGE (3) | 3600 | 3600 | 0 | 100% | 0 | 400 / 602 / 630 / 1416 |
| SOL (10) | 3600 | 3600 | 0 | 100% | 0 | 400 / 602 / 630 / 1416 |
| BNB (49) | 3600 | 3600 | 0 | 100% | 0 | 400 / 602 / 630 / 1416 |

| metric | value |
|---|---|
| requests (5 Hz) | 18000 sent, 18000 OK, error rate 0% , HTTP 429: 0, statuses {"200":18000} |
| requests (10 Hz burst, 30 s) | 300 sent, 300 OK, HTTP 429: 0, RTT p50/p95 69/86 ms |
| REST RTT (keep-alive, in recorder) | p50 69 / p95 95 / p99 235 / max 1601 ms |
| first-seen − round start, all pairs (response received) | p50 400 / p95 602 / p99 630 / max 1416 ms |
| first-seen − round start (request sent; lower bound incl. 200 ms poll quantisation) | p50 330 / p95 530 / p99 531 ms |
| feed ts − round | min 132 / p50 157 / p95 199 / p99 239 / max 345 ms |
| first-seen − feed ts | p50 247 / p95 444 / p99 469 ms |
| how long a round stays the served one | p50 800 / p95 1002 / max 1200 ms |
| consistency | 18000 (pair, round) keys; >1 value: 0; >1 proof hash: 0; round ≠ floor(ts/1000)·1000: 0; proofs with mixed rounds: 0; served-round regressions: 0 |
| proof size | 2304 B × 18000 (5 pairs) |
| BSC testnet block time | 450 ms avg (7980 blocks / 3591 s) |
| age of HTTP "latest" block when observed (dataseed/bnbchain) | p50 1936 / p95 3341 / max 3683 ms |

### T5 RTT (results/t5-rtt.json)

| endpoint | warm keep-alive p50 / p95 (ms) | cold (new TCP+TLS, curl) p50 / p95 (ms) |
|---|---|---|
| supraRest | 69 / 108 | 227 / 252 |
| bscDataseed | 111 / 134 | 449 / 499 |
| bscBnbchain | 115 / 131 | 441 / 501 |
| bscPublicnode | 154 / 9252 | 220 / 1711 |
| WSS newHeads (wss://bsc-testnet-rpc.publicnode.com) arrival − header milliTimestamp | 178 / 516 | - |

<!-- T1_TABLES:END -->

Notes:
- **"Missing-second rate" is 0 % for every pair.** The longest gap was 0 s. At 5 Hz polling a round is served for about 0.8-1.0 s (p50 800 ms), so it cannot be skipped unless several polls in a row fail. None did.
- The "sent" latency is a lower bound on server availability and "received" is an upper bound. The truth lies between them. Proofs appear about 0.2-0.35 s after the feed `ts`.
- The HTTP `latest` block from the bnbchain.org RPCs is about 1.9 s old when observed (p50). WSS `newHeads` from publicnode arrive only about 0.18 s after the header's `milliTimestamp` (section 7). Use WSS for head tracking.

---

## 3. On-chain behaviour (T3)

Contracts on chain 97 [M]:

| role | proxy (ERC1967/UUPS) | implementation |
|---|---|---|
| Pull (`verifyOracleProofV2`) | `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917` | `0x4b065deb38b05119b4ce27ad35d4d4c7c844f499` |
| Storage (`getSvalue` etc.) | `0x004d42225631F6bec6503a281Ed4c233810CBC29` | `0x0cf118278555c5b679b2f5a516529eab301fd17d` |
| Committee verifier (BLS) | `0x8694E798112a9Df06d9Ccc772967A5AeCfb24320` | `0x471a1025181e141e4d304f2377b8beaa001a4355` |

The owner is `0xaF90E04a87743312000607d0F6a0519892454B7A`. Both `TIME_DELTA_ALLOWANCE()` values are 3000 (ms). The pull contract's `MILLISECOND_CONVERSION_FACTOR` is 1000.

Flow of `verifyOracleProofV2`. It comes from the call trace, and is **confirmed by the verified source**: the pull implementation is an exact match on Sourcify (`src/SupraOraclePull_V2.sol`, solc 0.8.24, verified 2026-06-10; reference in `abi/supra-pull-v2.sourcify.json`). The verifier implementation is **not** verified; its checks were tested behaviourally only.
1. The root is skipped if it is already in `merkleSet`, a ring buffer of the last 1000 verified roots. Otherwise the contract runs `requireRootVerified`, a `staticcall` to `verifier.requireHashVerified_V2(root, sigs, committee_id)` that reverts `DataNotVerified` on failure. This is BLS on BN254: hash-to-curve via the SHA-256 precompile, `ecadd`, then a 2-pair `ecpairing` costing 113k. The call costs about 207k in total.
2. `verifyMultileafMerkleProof` computes each leaf as `keccak256(abi.encodePacked(betole_4(pair), betole_16(price), betole_8(timestamp), betole_2(decimals), betole_8(round)))` and then calls OZ `MerkleProof.multiProofVerify`.
3. For each pair it reads `storage.getRound(pair)` = lastRound.
   - If `round > lastRound` and `round ≤ block.timestamp·1000 + 3000`, it writes storage and returns the proof's values (mask 1).
   - If `round > block.timestamp·1000 + 3000`, it reverts `IncorrectFutureUpdate`.
   - If `round < lastRound`, it returns the **stored** values with mask 0. This is F1.
   - If `round == lastRound`, it returns the proof's values with mask 0.
4. `emit PriceUpdate(pairs, prices, updateMask)`.

**Gotcha [M, source]:** the struct overload `verifyOracleProofV2(OracleProofV2 calldata)` (selector `0x03a02dfd`) is a **stub**. It only emits `SupraSValueVerifierUpdated` and returns an empty struct. Always use the `bytes` overload `0x3dcd9793`.

| test | result |
|---|---|
| **(a) fresh proof** | Succeeds. Fork tx `gasUsed` **460,515** for 5 pairs; `updateMask` [1,1,1,1,1]; returns the proof's own values. On the real chain, `eth_estimateGas` gave 475,037 for the fixture proof and **466,222** for a live 5-pair proof (2304 B), against **347,060** for a live 1-pair proof (1216 B, pair 49). These include intrinsic gas and calldata, and confirm the earlier ~356k/449k [M]. |
| **(b) newer then older (F1)** | Proof round r+5 was stored, then proof round r+2 was submitted. **The tx does NOT revert.** Gas 435,853, `updateMask` [0,0,0,0,0], storage unchanged. The returned `PriceInfo` holds the **stored newer values**: `round`, `prices` and `timestamp` all come from round r+5, not from the submitted proof. A caller cannot tell unless it compares the returned `round` with the proof's round. F1 confirmed [M]. |
| **(c) same proof twice** | Succeeds. The gas drops to **175,263** the second time [M]. The cause is the root cache: `merkleSet` holds the last 1000 roots, so a known root skips BLS (confirmed by source). `updateMask` all 0, same values returned [M]. |
| **(d) staleness / future** | **There is no staleness check.** A proof newer than stored is accepted and written after +1 h, +1 d and +30 d of time travel on the fork, and at +365 d via an `eth_call` block override [M]. **There is a future check**: `IncorrectFutureUpdate(uint256 deltaMs)` when `round − block.timestamp·1000 > 3000`. At 3 s ahead it passes; at 4 s ahead it reverts with `IncorrectFutureUpdate(4000)` [M]. |
| **(e) stateless verification** | **Works (confidence HIGH today; MEDIUM for longevity).** Details below. |
| **(f) EIP-1153** | **Supported on the real chain.** An `eth_call` create running `TSTORE(1,42); TLOAD(1)` returns 42. MCOPY (EIP-5656), PUSH0 and BLOBBASEFEE (EIP-7516) also work [M]. |

### 3.1 Stateless verification: how, and evidence

- `requireHashVerified_V2(bytes32 message, uint256[2] signature, uint256 committee_id) external view` is declared in Supra's verified `ISupraSValueFeedVerifier.sol`, and the pull contract calls it by `staticcall`. It reverts unless `sig` is the committee's BLS signature over `root`. It succeeded from a random EOA and from no sender, and reverted `BLSIncorrectInputMessaage()` (`0x22460675`) for a tampered root or a wrong committee [M]. Committees 0 and 1 have keys; ids 2+ return a zero key but zero or identity signatures are rejected [M].
- **Leaf encoding [M].** It was taken from an opcode-level trace (Foundry `startDebugTraceRecording`) of the real `verifyOracleProofV2`, **later confirmed by the verified source**, and validated off-chain on every captured proof (all 3,600 proofs of the 60 min recording plus the 23 fixture proofs, 0 mismatches; `scripts/check-merkle-encoding.mjs`):
  `leaf = keccak256(LE32(pair) ‖ LE128(price) ‖ LE64(timestamp) ‖ LE16(decimals) ‖ LE64(round))`. That is 38 bytes, **little-endian** (BCS style). ABI or packed big-endian encodings do **not** match.
  The multiproof is OpenZeppelin `MerkleProof.multiProofVerify` (sorted-pair keccak), with `proof = committee_data.proof`, `proofFlags = committee_data.flags`, and leaves in `committee_feed` order.
- **PoC [M].** `poc/src/StatelessSupraVerifier.sol` was deployed on the fork, and fixture proof #22 was pushed into Supra storage first.
  - Supra's `verifyOracleProofV2(#0)` returns round #22 (F1).
  - The PoC's `verify(#0 / #1 / #10 / #21)` returns each proof's own historical round and prices, all matching the fixture.
  - A tampered price reverts `RootMismatch`; a tampered signature reverts `BLSInvalidPublicKeyorSignaturePoints`.
  - On the real chain, a constructor-only `eth_call` (nothing deployed) verifies fixture proof #0 and returns its feeds.
- **Gas [M].** `estimateGas` for a stateless 5-pair verify is 266k-300k. That includes 21k intrinsic gas and about 30-37k of calldata, so execution is about 210-250k, of which BLS is about 207k. Supra's stateful verify costs 443-460k. Our own checkpoint `SSTORE`s come on top of either path.
- **Why it matters.**
  - Late proofs remain provable, so F1 disappears.
  - Backfill becomes possible.
  - Anyone can record, so neither the house nor a player can censor a second and force a void.
  - There is no longer a hard inclusion deadline.
- **Longevity risks [I].**
  - The function is undocumented, and Supra can upgrade the verifier behind its UUPS proxy.
  - A committee key rotation (`updatePublicKey`) invalidates old signatures, so a backfill across a rotation fails and that round is voided.
  - Mitigation: an admin-settable (timelocked) verifier address, a monitoring alert on the proxy `Upgraded` event and on `checkCommitteePublicKey` changes, and void-on-unverifiable.

Suggested shape for the contracts team (sketch, not audited):

```solidity
// record(bytes proof): permissionless, idempotent, set-once per (pair, second)
SupraProofV2.CommitteeFeed[] memory feeds = SupraProofV2.verify(verifier, proof); // BLS (requireHashVerified_V2) + LE-leaf multiproof
for (uint i; i < feeds.length; ++i) {
    CommitteeFeed memory f = feeds[i];
    if (!isTrackedPair[f.pair]) continue;
    require(f.decimals == 18 && f.round % 1000 == 0 && f.timestamp >= f.round && f.timestamp < f.round + 1000);
    require(f.round <= block.timestamp * 1000 + 3000);          // same bound as Supra's IncorrectFutureUpdate
    uint64 sec = f.round / 1000;
    if (price[f.pair][sec] == 0) { price[f.pair][sec] = f.price; emit Checkpoint(f.pair, sec, f.price); }
}
```

### 3.2 Archive RPC requirement (affects the fixture and every fork test) [M]

`bsc-testnet-dataseed.bnbchain.org`, `bsc-testnet.bnbchain.org` and the `data-seed-prebsc-*` nodes return **"missing trie node" for state only about 200 blocks (about 90 s) old**, so anvil forks from them break within minutes. `https://bsc-testnet-rpc.publicnode.com` and `https://bsc-testnet.drpc.org` served state 200,000 blocks back. Fork from publicnode, which also supports `eth_call` block overrides. Its p95 latency is poor, so do not use it on the recorder's hot path.

---

## 4. Fixture (T2)

`fixtures/supra-97-1790414769.json` (about 150 KB) contains **23 consecutive** 5-pair proofs, rounds 1790414769000 to 1790414791000.

- `blockBeforeFirstProof`: 133261858, ts 1790414769 (milliTimestamp 1790414769400). This was read just before the first `/get_proof` call.
- `verifyCall`: the result of `verifyOracleProofV2(proofs[0])` via `eth_call`, both at block 133261858 and at latest (133261860). Both returned the proof's values; `estimateGas` was 475,037.
- `proofs[i]`: `{round, receivedAtMs, proofHash, sizeBytes, proof (raw 0x bytes), committees[{committeeId, root, feeds[{pair, price, timestamp, decimals, round, leaf}]}]}`.

The format is also described inside the file under the `format` key.

How to use it:
1. Fork chain 97 at `blockBeforeFirstProof.number` using **publicnode**.
2. Record `proofs[]` in order.
3. Before recording proof *i*, `vm.warp(round_i/1000 + 1)` or later. Otherwise Supra's `IncorrectFutureUpdate` reverts once the fork clock is more than 3 s behind the proof. A stateless oracle should enforce the same bound itself.

---

## 5. Recommended constants

| constant | value | rationale |
|---|---|---|
| `ENTRY_DELAY_SEC` | **3** (spec had 2) | The entry price is the Supra round `block.timestamp + ENTRY_DELAY_SEC`. A player's information lead is about `ENTRY_DELAY_SEC − 0.5 … +1.5` s, depending on when in the second the commit lands [I]. Two measurements argue for a longer delay: Supra lags Binance by about 1-2 s (1 s-return correlation peaks at Binance lag −2 for BNB/BTC/ETH) [M], and short-horizon momentum exists (section 6.3) [M]. Each extra second recovers about 0.5-1.2 pp of house edge against a trend-follower (BTC BOOST at D=30: −3.8 % → −2.7 % → −1.8 % for 2 → 3 → 4 s) [M]. A delay of 3 s is a compromise with UX; it does **not** make any lane momentum-safe. On the recorded Supra hour, a Binance-informed player still wins at an 8 s delay (section 6.3). |
| `EXIT_DELAY_SEC` | **2** | Interpreted as: settlement at timeout may be called once `block.timestamp ≥ endSec + EXIT_DELAY_SEC` and every needed checkpoint is present. A round t proof is available by t+0.63 s (p99) and at most t+1.42 s [M]. A checkpoint tx is mined within about 0.5-1 s after that [I; no tx could be sent]. So the end-second checkpoint is normally on-chain before `endSec + 2`. Settlement just requires the needed checkpoints; early settlement on a recorded touch needs no delay. |
| `STALL_AFTER_SEC` | **60** | Void only if a needed checkpoint is still missing 60 s after `endSec`. With stateless verification, any archived proof can be backfilled, and 60 s (about 130 blocks) covers recorder restarts and RPC hiccups. A second that no recorder captured is lost forever, since REST keeps no history. Nothing was lost in 60 min [M]. |
| `maxJumpPpm` (per asset) | BNB **15,000** · BTC **10,000** · ETH **15,000** · SOL **20,000** · DOGE **40,000** | `niceCeil(max(2 × max\|1 s return\|, 10 × p99.99))` over 7 d of Binance 1 s data [M]. Supra's 1 s moves are smaller than Binance's (section 6.4), so these never trigger on real data. Treat a trigger as an oracle fault: void. |
| Recorder polling | **5 Hz**, phase-aligned | 5 Hz missed 0 rounds, and 10 Hz caused no 429s [M]. Better: poll from round+150 ms to round+950 ms, since rounds appear at +0.2 to 0.65 s. Run **two independent recorders** (the REST keeps no history) and dedupe by proof hash. |
| Inclusion-latency budget | about **0.8 s** hard budget (stateful path) / **soft, about 2 s** (stateless) | The next round's proof exists at about t+1.2 s at the earliest (t+1.33 s p50) [M]. Ours is fetched at about t+0.40 s, which leaves about 0.8 s, or about 2 BSC blocks of 450 ms [M], for send, propagate and include. That is tight on public RPCs [I]. The budget only matters for the stateful path when a third party pushes newer proofs. **With stateless verification there is no hard deadline**; the target becomes UX (checkpoint on-chain by about t+2 s, so settlement is snappy). |
| Oracle-side checks (stateless) | `round ≤ block.timestamp·1000 + 3000`, `round ≤ ts < round + 1000`, `decimals == 18`, pair ∈ {0,1,3,10,49}, set-once per (pair, second) | Mirrors Supra's own future check [M] and the invariants observed [M]. |
| Recording cost | record **on demand** (only seconds covered by open rounds) and/or **batch** 2-5 seconds per tx | Recording 24/7 every second costs about 86,400 tx × 0.28-0.46M gas × 0.1 gwei ≈ **2.4-4.0 tBNB/day** before checkpoint storage [I, from measured gas and gas price]. With stateless verification a late or batched record is still valid. |

---

## 6. Lanes (T4)

<!-- T4_TABLES:BEGIN -->
### T4 volatility (Binance 1 s closes, 7 days)

| asset | σ1s plain (ppm) | σ1s bipower (ppm) | σ_eff from 20 s returns | VR(20) | ACF(1) | zero-return seconds | approx tick (ppm) | \|r1s\| p99.9 / p99.99 / max (ppm) | gapMargin (ppm) | maxJumpPpm |
|---|---|---|---|---|---|---|---|---|---|---|
| BNB | 63.5 | 44.9 | 75.1 | 1.40 | 0.099 | 54.5% | 12.4 | 538 / 985 / 5888 | 37.0 | 15000 |
| BTC | 52.7 | 36.1 | 65.7 | 1.56 | 0.121 | 48.0% | 0.1 | 490 / 888 / 2891 | 30.7 | 10000 |
| ETH | 78.2 | 57.1 | 90.0 | 1.32 | 0.099 | 48.2% | 3.6 | 694 / 1302 / 3626 | 45.6 | 15000 |
| SOL | 111.6 | 86.9 | 115.7 | 1.07 | -0.006 | 54.8% | 81.4 | 911 / 1706 / 3163 | 65.0 | 20000 |
| DOGE | 173.7 | 141.5 | 180.8 | 1.08 | 0.026 | 57.2% | 94.6 | 1459 / 3005 / 10740 | 101.2 | 40000 |

#### Strict constraints as specified (σ = plain stdev) → lane-params.json (D = 30 s)

| asset | tier | M | enabled | T (ppm) | S (ppm) | P(TP) | P(SL) | P(timeout) | house edge | worst-regime edge | momentum-player edge (entry delay 2 s) | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BNB | CRUISE | 1.5x | no | 226 | 434 | 32.3% | 13.9% | 53.7% | 5.98% | 4.47% | 4.26% | P(TP) band unreachable; max 32.3% |
| BNB | BOOST | 2x | no | 291 | 262 | 24.6% | 27.5% | 47.9% | 2.84% | 1.25% | -0.08% | P(TP) band unreachable; max 24.7% |
| BNB | HYPER | 3x | no | 718 | 276 | 5.0% | 27.2% | 67.8% | 2.29% | 0.42% | -0.92% | P(TP) band unreachable; max 5.0% |
| BNB | WARP | 5x | no | 1526 | 276 | 0.5% | 27.2% | 72.3% | 2.83% | 0.44% | -0.55% | P(TP) band unreachable; max 0.5% |
| BTC | CRUISE | 1.5x | no | 207 | 397 | 26.0% | 11.4% | 62.6% | 6.01% | 4.21% | 2.49% | P(TP) band unreachable; max 26.0% |
| BTC | BOOST | 2x | no | 241 | 217 | 21.5% | 24.0% | 54.5% | 2.48% | 1.20% | -3.83% | P(TP) band unreachable; max 21.5% |
| BTC | HYPER | 3x | no | 626 | 217 | 4.8% | 25.1% | 70.1% | 2.90% | 1.14% | -3.44% | P(TP) band unreachable; max 4.8% |
| BTC | WARP | 5x | no | 1399 | 228 | 0.5% | 24.1% | 75.4% | 3.63% | 0.53% | -2.63% | P(TP) band unreachable; max 0.5% |
| ETH | CRUISE | 1.5x | no | 265 | 507 | 31.8% | 14.0% | 54.2% | 5.86% | 4.80% | 4.31% | P(TP) band unreachable; max 31.9% |
| ETH | BOOST | 2x | no | 358 | 323 | 22.9% | 25.9% | 51.2% | 2.89% | 1.23% | 0.26% | P(TP) band unreachable; max 23.0% |
| ETH | HYPER | 3x | no | 840 | 323 | 5.3% | 27.1% | 67.6% | 2.70% | 0.96% | 0.11% | P(TP) band unreachable; max 5.3% |
| ETH | WARP | 5x | no | 1786 | 323 | 0.6% | 27.2% | 72.2% | 3.23% | 1.03% | 0.60% | P(TP) band unreachable; max 0.6% |
| SOL | CRUISE | 1.5x | **yes** | 240 | 461 | 47.4% | 22.0% | 30.5% | 5.20% | 4.03% | 3.68% |  |
| SOL | BOOST | 2x | no | 511 | 461 | 22.9% | 25.0% | 52.1% | 2.51% | 1.19% | 0.80% | P(TP) band unreachable; max 23.1% |
| SOL | HYPER | 3x | no | 1200 | 485 | 4.3% | 25.7% | 70.0% | 2.90% | 1.77% | 1.19% | P(TP) band unreachable; max 4.3% |
| SOL | WARP | 5x | no | 2425 | 485 | 0.4% | 25.8% | 73.8% | 2.02% | 0.27% | 0.13% | P(TP) band unreachable; max 0.4% |
| DOGE | CRUISE | 1.5x | **yes** | 374 | 717 | 43.7% | 21.0% | 35.3% | 5.77% | 4.51% | 5.10% |  |
| DOGE | BOOST | 2x | no | 794 | 717 | 21.4% | 23.7% | 54.9% | 2.75% | 0.77% | 1.92% | P(TP) band unreachable; max 21.4% |
| DOGE | HYPER | 3x | no | 1775 | 717 | 4.8% | 24.7% | 70.5% | 2.71% | 0.67% | 1.95% | P(TP) band unreachable; max 4.8% |
| DOGE | WARP | 5x | no | 3772 | 754 | 0.4% | 23.6% | 75.9% | 2.40% | 0.86% | 1.49% | P(TP) band unreachable; max 0.4% |

#### Strict constraints, alternative duration (D = 20 s)

| asset | tier | M | enabled | T (ppm) | S (ppm) | P(TP) | P(SL) | P(timeout) | house edge | worst-regime edge | momentum-player edge (entry delay 2 s) | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BNB | CRUISE | 1.5x | no | 205 | 392 | 27.3% | 11.1% | 61.6% | 5.80% | 4.52% | 3.86% | P(TP) band unreachable; max 27.4% |
| BNB | BOOST | 2x | no | 291 | 262 | 18.1% | 20.7% | 61.2% | 2.67% | 1.52% | -0.43% | P(TP) band unreachable; max 18.2% |
| BNB | HYPER | 3x | no | 683 | 262 | 3.2% | 21.1% | 75.7% | 2.50% | 1.03% | -0.87% | P(TP) band unreachable; max 3.2% |
| BNB | WARP | 5x | no | 1451 | 276 | 0.2% | 19.9% | 79.9% | 2.18% | 0.28% | -1.24% | P(TP) band unreachable; max 0.2% |
| BTC | CRUISE | 1.5x | no | 178 | 342 | 22.3% | 9.7% | 67.9% | 5.85% | 3.77% | 1.96% | P(TP) band unreachable; max 22.3% |
| BTC | BOOST | 2x | no | 241 | 217 | 15.9% | 18.1% | 66.0% | 2.34% | 1.51% | -4.00% | P(TP) band unreachable; max 16.0% |
| BTC | HYPER | 3x | no | 626 | 228 | 2.8% | 17.7% | 79.5% | 2.41% | 0.45% | -3.86% | P(TP) band unreachable; max 2.8% |
| BTC | WARP | 5x | no | 1330 | 228 | 0.3% | 17.7% | 82.0% | 2.86% | 0.02% | -3.41% | P(TP) band unreachable; max 0.3% |
| ETH | CRUISE | 1.5x | no | 228 | 436 | 28.1% | 12.2% | 59.7% | 5.93% | 4.60% | 4.10% | P(TP) band unreachable; max 28.2% |
| ETH | BOOST | 2x | no | 358 | 323 | 16.9% | 19.5% | 63.6% | 2.71% | 1.55% | -0.00% | P(TP) band unreachable; max 17.0% |
| ETH | HYPER | 3x | no | 840 | 323 | 3.2% | 20.0% | 76.8% | 2.87% | 1.42% | 0.19% | P(TP) band unreachable; max 3.2% |
| ETH | WARP | 5x | no | 1698 | 323 | 0.3% | 20.1% | 79.6% | 2.16% | 0.05% | -0.61% | P(TP) band unreachable; max 0.3% |
| SOL | CRUISE | 1.5x | no | 240 | 461 | 40.0% | 16.5% | 43.5% | 5.11% | 4.14% | 3.69% | P(TP) band unreachable; max 40.0% |
| SOL | BOOST | 2x | no | 511 | 461 | 16.4% | 18.1% | 65.5% | 2.50% | 1.57% | 0.91% | P(TP) band unreachable; max 16.5% |
| SOL | HYPER | 3x | no | 1141 | 461 | 2.8% | 18.5% | 78.7% | 2.35% | 1.17% | 0.62% | P(TP) band unreachable; max 2.8% |
| SOL | WARP | 5x | no | 2425 | 485 | 0.2% | 18.3% | 81.5% | 2.59% | 1.14% | 0.88% | P(TP) band unreachable; max 0.2% |
| DOGE | CRUISE | 1.5x | no | 374 | 717 | 36.3% | 15.7% | 48.0% | 5.46% | 4.40% | 4.90% | P(TP) band unreachable; max 36.3% |
| DOGE | BOOST | 2x | no | 794 | 717 | 15.2% | 17.2% | 67.6% | 2.66% | 1.04% | 1.91% | P(TP) band unreachable; max 15.3% |
| DOGE | HYPER | 3x | no | 1775 | 717 | 2.8% | 17.6% | 79.5% | 2.83% | 1.46% | 2.11% | P(TP) band unreachable; max 2.8% |
| DOGE | WARP | 5x | no | 3587 | 717 | 0.3% | 17.7% | 82.1% | 2.40% | 1.36% | 1.63% | P(TP) band unreachable; max 0.3% |

#### Sensitivity: σ = bipower (robust) in S ≥ 4σ and gap margin (D = 30 s)

| asset | tier | M | enabled | T (ppm) | S (ppm) | P(TP) | P(SL) | P(timeout) | house edge | worst-regime edge | momentum-player edge (entry delay 2 s) | note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BNB | CRUISE | 1.5x | no | 227 | 435 | 32.2% | 13.9% | 53.9% | 5.99% | 4.47% | 4.27% | P(TP) band unreachable; max 32.3% |
| BNB | BOOST | 2x | **yes** | 216 | 185 | 31.1% | 35.4% | 33.5% | 3.91% | 2.22% | 0.54% |  |
| BNB | HYPER | 3x | no | 533 | 185 | 9.4% | 37.6% | 53.0% | 2.29% | 0.27% | -1.55% | P(TP) band unreachable; max 9.4% |
| BNB | WARP | 5x | no | 1192 | 185 | 1.0% | 37.9% | 61.1% | 3.48% | 0.39% | -0.57% | P(TP) band unreachable; max 1.0% |
| BTC | CRUISE | 1.5x | no | 213 | 407 | 25.3% | 10.9% | 63.7% | 5.90% | 4.06% | 2.45% | P(TP) band unreachable; max 25.4% |
| BTC | BOOST | 2x | no | 165 | 149 | 28.6% | 30.6% | 40.8% | 2.06% | 0.16% | -5.98% | P(TP) band unreachable; max 28.6% |
| BTC | HYPER | 3x | no | 499 | 156 | 7.3% | 32.2% | 60.5% | 2.66% | 0.50% | -5.04% | P(TP) band unreachable; max 7.3% |
| BTC | WARP | 5x | no | 1115 | 156 | 0.9% | 32.5% | 66.6% | 3.54% | 0.20% | -4.28% | P(TP) band unreachable; max 0.9% |
| ETH | CRUISE | 1.5x | no | 261 | 501 | 32.2% | 14.2% | 53.5% | 5.88% | 4.86% | 4.32% | P(TP) band unreachable; max 32.2% |
| ETH | BOOST | 2x | no | 261 | 235 | 29.9% | 32.9% | 37.3% | 2.84% | 0.78% | -0.48% | P(TP) band unreachable; max 29.9% |
| ETH | HYPER | 3x | no | 679 | 248 | 8.2% | 34.0% | 57.9% | 2.28% | 0.06% | -0.87% | P(TP) band unreachable; max 8.2% |
| ETH | WARP | 5x | no | 1442 | 235 | 1.1% | 35.6% | 63.2% | 3.32% | 0.61% | -0.02% | P(TP) band unreachable; max 1.1% |
| SOL | CRUISE | 1.5x | **yes** | 241 | 461 | 47.4% | 22.0% | 30.5% | 5.21% | 4.01% | 3.69% |  |
| SOL | BOOST | 2x | no | 418 | 359 | 29.3% | 31.5% | 39.2% | 2.74% | 1.29% | 0.70% | P(TP) band unreachable; max 29.3% |
| SOL | HYPER | 3x | no | 982 | 377 | 7.0% | 31.9% | 61.2% | 2.33% | 0.84% | 0.25% | P(TP) band unreachable; max 7.0% |
| SOL | WARP | 5x | no | 2088 | 377 | 0.7% | 32.1% | 67.2% | 2.63% | 0.54% | 0.45% | P(TP) band unreachable; max 0.7% |
| DOGE | CRUISE | 1.5x | **yes** | 372 | 714 | 43.7% | 21.1% | 35.2% | 5.88% | 4.63% | 5.20% |  |
| DOGE | BOOST | 2x | no | 615 | 584 | 27.4% | 29.8% | 42.8% | 2.34% | 0.77% | 1.36% | P(TP) band unreachable; max 27.4% |
| DOGE | HYPER | 3x | no | 1445 | 584 | 7.3% | 31.7% | 61.0% | 2.44% | 0.19% | 1.55% | P(TP) band unreachable; max 7.3% |
| DOGE | WARP | 5x | no | 3072 | 584 | 0.9% | 31.9% | 67.2% | 2.73% | 1.02% | 1.65% | P(TP) band unreachable; max 0.9% |

### Entry-delay sweep: momentum:5 player house edge (Binance, D = 30)

| asset | tier | base edge (50/50) | delay 2 s | 3 s | 4 s | 6 s | 10 s |
|---|---|---|---|---|---|---|---|
| BNB | CRUISE | 5.98% | 4.26% | 4.73% | 5.08% | 5.57% | 6.01% |
| BNB | BOOST | 2.84% | -0.08% | 0.63% | 1.19% | 1.95% | 2.67% |
| BTC | CRUISE | 6.01% | 2.49% | 3.18% | 3.76% | 4.57% | 5.38% |
| BTC | BOOST | 2.48% | -3.83% | -2.71% | -1.77% | -0.49% | 0.80% |
| ETH | CRUISE | 5.86% | 4.31% | 4.87% | 5.30% | 5.81% | 6.19% |
| ETH | BOOST | 2.89% | 0.26% | 1.09% | 1.71% | 2.45% | 3.04% |
| SOL | CRUISE | 5.20% | 3.68% | 4.16% | 4.50% | 4.97% | 5.14% |
| SOL | BOOST | 2.51% | 0.80% | 1.32% | 1.66% | 2.15% | 2.42% |
| DOGE | CRUISE | 5.77% | 5.10% | 5.30% | 5.52% | 5.95% | 6.27% |
| DOGE | BOOST | 2.75% | 1.92% | 2.14% | 2.42% | 2.88% | 3.18% |

### Proxy check: Supra rounds vs Binance 1 s closes over the recorded window (supra-series-main-1790414012.json)

| asset | n (s) | tracking error mean / sd / p95 abs / max abs (bps) | corr 1 s returns by lag (Binance kline t+lag vs Supra round t): −3 / −2 / −1 / 0 / +1 | corr 20 s returns at lag −2 / 0 | σ1s Supra / Binance (ppm) | VR(20) Supra / Binance | Supra ACF lags 1..5 |
|---|---|---|---|---|---|---|---|
| BNB | 3600 | 0.39 / 1.21 / 2.59 / 10.08 | -0.00 / 0.22 / 0.01 / 0.03 / 0.02 | 0.53 / 0.44 | 19.9 / 27.5 | 1.93 / 1.14 | -0.04, 0.08, 0.06, 0.08, 0.07 |
| BTC | 3600 | -0.05 / 0.63 / 1.37 / 4.12 | 0.06 / 0.27 / 0.11 / 0.05 / 0.03 | 0.82 / 0.74 | 16.3 / 20.3 | 1.67 / 1.61 | -0.04, 0.02, 0.05, 0.05, 0.02 |
| ETH | 3600 | 0.02 / 1.03 / 2.20 / 10.34 | 0.03 / 0.42 / 0.27 / 0.02 / 0.05 | 0.85 / 0.76 | 25.8 / 41.3 | 2.33 / 1.27 | 0.02, 0.10, 0.11, 0.13, 0.10 |
| SOL | 3600 | 0.79 / 1.70 / 3.54 / 12.50 | -0.00 / 0.08 / 0.22 / -0.02 / -0.01 | 0.78 / 0.70 | 63.6 / 83.1 | 0.84 / 0.75 | -0.36, 0.04, 0.03, 0.07, -0.00 |
| DOGE | 3600 | -1.30 / 2.12 / 5.06 / 12.39 | 0.05 / 0.09 / 0.20 / 0.02 / -0.01 | 0.69 / 0.59 | 59.5 / 90.9 | 0.93 / 0.72 | -0.18, -0.03, 0.03, 0.04, 0.05 |

#### Game metrics of the chosen lanes on the recorded hour: Supra path vs Binance path (D = 30)

| asset | tier | P(TP) Supra / Binance | P(timeout) Supra / Binance | house edge Supra / Binance | momentum:5 edge Supra / Binance | Binance-informed player on Supra, edge at entry delay 2 / 3 / 5 / 8 s (k = 5) |
|---|---|---|---|---|---|---|
| BNB | CRUISE | 6.4% / 9.3% | 92.2% / 89.0% | 2.46% / 2.27% | -3.52% / 0.85% | -6.6% / -6.5% / -6.1% / -4.7% |
| BNB | BOOST | 3.1% / 4.1% | 92.7% / 90.3% | 2.42% / 2.57% | -7.02% / 0.33% | -11.9% / -11.7% / -11.1% / -8.9% |
| BNB | HYPER | 0.3% / 0.4% | 96.0% / 94.9% | 3.89% / 4.22% | -4.92% / 1.67% | - |
| BNB | WARP | 0.0% / 0.0% | 96.3% / 95.3% | 4.63% / 5.12% | -3.94% / 3.16% | - |
| BTC | CRUISE | 5.6% / 8.9% | 93.8% / 90.5% | 1.81% / 2.20% | -3.14% / -0.32% | -5.5% / -5.0% / -3.9% / -2.4% |
| BTC | BOOST | 3.3% / 6.4% | 91.8% / 86.1% | 2.31% / 2.25% | -6.56% / -2.85% | -10.5% / -9.8% / -7.8% / -5.3% |
| BTC | HYPER | 0.2% / 0.3% | 94.8% / 92.2% | 5.47% / 5.09% | -2.10% / 0.67% | - |
| BTC | WARP | 0.0% / 0.0% | 95.8% / 93.0% | 6.11% / 5.60% | -0.92% / 1.77% | - |
| ETH | CRUISE | 9.1% / 13.7% | 88.9% / 82.7% | 2.99% / 3.38% | -2.16% / 2.78% | -4.7% / -3.8% / -2.3% / -0.4% |
| ETH | BOOST | 5.1% / 7.9% | 88.5% / 82.9% | 2.25% / 2.26% | -5.70% / 0.87% | -9.9% / -8.5% / -6.1% / -2.9% |
| ETH | HYPER | 1.0% / 1.3% | 92.6% / 89.5% | 3.07% / 3.53% | -4.77% / 2.54% | - |
| ETH | WARP | 0.0% / 0.0% | 93.6% / 90.8% | 3.78% / 4.54% | -3.77% / 4.35% | - |
| SOL | CRUISE | 25.2% / 39.8% | 68.0% / 48.0% | 5.23% / 3.37% | -2.12% / 3.53% | -7.9% / -6.9% / -5.2% / -2.1% |
| SOL | BOOST | 4.9% / 9.1% | 88.3% / 78.1% | 2.67% / 3.01% | -5.72% / 2.85% | -11.6% / -10.5% / -8.8% / -5.2% |
| SOL | HYPER | 0.9% / 1.2% | 92.9% / 85.9% | 3.33% / 4.45% | -4.75% / 4.31% | - |
| SOL | WARP | 0.0% / 0.0% | 93.8% / 87.1% | 3.21% / 4.34% | -4.99% / 4.45% | - |
| DOGE | CRUISE | 15.4% / 25.5% | 81.3% / 66.5% | 3.91% / 3.17% | -2.17% / 1.68% | -7.9% / -7.3% / -5.6% / -3.9% |
| DOGE | BOOST | 2.1% / 6.1% | 94.6% / 85.7% | 2.48% / 2.69% | -4.03% / 1.33% | -10.3% / -9.7% / -8.0% / -6.3% |
| DOGE | HYPER | 0.0% / 0.1% | 96.7% / 91.6% | 4.15% / 5.20% | -1.74% / 4.83% | - |
| DOGE | WARP | 0.0% / 0.0% | 97.4% / 93.8% | 4.22% / 4.99% | -1.33% / 4.69% | - |

### lane-params.json summary

| asset | pairId | σ1s (ppm) | gapMargin (ppm) | maxJumpPpm | D (s) | enabled tiers |
|---|---|---|---|---|---|---|
| BNB | 49 | 63.55 | 37.02 | 15000 | 30 | none |
| BTC | 0 | 52.67 | 30.69 | 10000 | 30 | none |
| ETH | 1 | 78.19 | 45.56 | 15000 | 30 | none |
| SOL | 10 | 111.65 | 65.05 | 20000 | 30 | CRUISE (T 240, S 461) |
| DOGE | 3 | 173.71 | 101.2 | 40000 | 30 | CRUISE (T 374, S 717) |
<!-- T4_TABLES:END -->

### 6.1 Result under the constraints as specified

With σ = plain stdev, `guard (M−1)S + max(0,M−2)·0.58σ ≤ T`, `S ≥ 4σ`, edge 2-6 % (target 3-4 %), worst-regime edge ≥ 0 and the P(TP) bands:
- **Only CRUISE on SOL and DOGE (D = 30) is feasible.**
- CRUISE on BNB, BTC and ETH reaches only 26-32 % P(TP) at D = 30.
- BOOST peaks at 21-25 %, HYPER at 4-5 %, and WARP below 1 %, for every asset.

`lane-params.json` records these results. Disabled tiers still carry the closest candidate's T, S and stats plus a `disabledReason`.

With the robust (bipower) σ in the `S ≥ 4σ` and gap rules, BNB BOOST at D = 30 and SOL CRUISE at D = 20 also pass (`results/lane-params-robust-sigma.json`). HYPER and WARP still fail.

### 6.2 Why HYPER and WARP cannot meet their bands at D ≤ 30 s (structural, not a data artefact) [I]

- Payouts are ≥ 0, so `P(TP)·M ≤ 1 − edge`. That gives P(TP) ≤ 19 % for WARP and ≤ 32 % for HYPER, even if every other outcome paid 0.
- Reaching those levels needs stop-outs in almost all non-winning rounds, which means a stop within about 0.3-0.5 σ_D. That is about 1.5-2.5 σ₁ₛ, which contradicts `S ≥ 4σ`.
- Conversely, `S ≥ 4σ` plus the guard forces `T ≥ 4(M−1)σ + …`. For WARP that is T ≥ 17.7σ₁ₛ, roughly 3.2-4 σ_D for D = 30-20, so P(TP) is well below 1 %.
- Real 1 s data makes this worse. Volatility clusters, so 48-57 % of seconds have zero change and the median |1 s move| of BTC is 0.12 ppm. Most rounds therefore time out in quiet hours [M].
- Independent check: a numpy re-implementation reproduces the JS simulator exactly (BTC CRUISE D = 20: pTP 0.22341, edge 0.05845) [M].

Product options (pick one):
1. Accept "lottery" bands for high tiers (HYPER about 5-9 %, WARP about 0.5-1 %).
2. Relax `S ≥ 4σ` for high tiers (tight stops, many instant stop-outs).
3. Give high tiers a longer D (WARP needs roughly D ≥ 100-150 s for P(TP) ≈ 15 % under `S ≥ 4σ`).
4. Ship CRUISE (and BOOST where it passes) only.

### 6.3 Momentum risk (important) [M]

1 s returns are positively autocorrelated.
- Binance 7 d: ACF(1) about 0.10-0.12 and VR(20) 1.3-1.6 for BNB, BTC and ETH; about 0 and 1.07 for SOL and DOGE.
- A trivial player can exploit this: go LONG if the price rose over the 5 s before the commit, else SHORT. With the spec's 2 s entry delay, the house edge for the chosen parameters turns **negative** on BOOST/HYPER/WARP for BTC, ETH and BNB (BTC BOOST −3.8 % to −4.0 %). CRUISE stays positive but shrinks, for example BTC CRUISE 6.0 % → 2.5 % at D = 30.
- A contrarian player loses 8-10 %, which confirms the effect is momentum.
- The edge recovers only slowly with a longer entry delay (sweep table).
- **The Supra feed looks even more autocorrelated than Binance** over the recorded hour. Its ACF at lags 2-10 is 0.00 to +0.13 and VR(20) is 1.7-2.3 for BNB, BTC and ETH (Binance, same hour: 1.1-1.6), consistent with a smoothed or lagging aggregate. The same momentum:5 rule is negative-edge for **all 20 lanes** on the Supra path in that hour (−0.9 % to −7.0 %).
- **Binance-informed player on the Supra path [M]** (last column of the recorded-hour table). The player commits at second c using Binance closes known at c; the entry is Supra round c + delay. This uses no look-ahead. Result for k = 5 s:
  - CRUISE: house edge −4.7 % to −7.9 % at delay 2 s, and −0.4 % to −4.7 % at delay 8 s.
  - BOOST: −9.9 % to −11.9 % at delay 2 s, and −3.0 % to −8.9 % at delay 8 s.
  - Every asset, every delay tested.
- **Mechanism [I].** Most rounds time out in quiet hours (P(timeout) 68-97 % in this hour). In a timeout the payout `V(r)` is almost linear in r, with slope about 1/S either side, so the game behaves like a linear forward with a 1 % fee. Any signal correlated with the 20-30 s return beats a 1 % fee once `ρ·σ_D/S ≳ 1 %`.
- One hour is a small sample (about 120 independent 30 s windows), but the sign is consistent across all assets and tiers.

**Lanes must be re-validated on ≥ 7 days of recorded Supra rounds, not only on Binance, before real value is at stake.** Treat every lane as unsafe against informed flow until then. Design levers to evaluate, all untested here:
- a less generous timeout payout (for example a flat `1 − fee` refund or a concave V);
- a higher fee;
- a longer or randomised entry delay;
- bet caps and rate limits;
- a feed or entry rule that is less predictable from Binance.

### 6.4 Binance as a proxy for Supra [M]

- **Level: good.** Supra and Binance agree within a few bps (see the proxy table: p95 |TE| 1.4-5.1 bps, max 4-12.5 bps).
- **1 s dynamics: poor.** Supra's σ₁ₛ is about 20-37 % lower (smoother). Contemporaneous 1 s return correlation is ≤ 0.05. It peaks when Binance leads by 1-2 s: 0.22-0.42 for BNB, BTC and ETH at lag −2, and 0.20-0.22 for SOL and DOGE at lag −1.
- **20 s return correlation (lag 0 / lag −2):** 0.70-0.76 / 0.78-0.85 for BTC, ETH and SOL, 0.59 / 0.69 for DOGE, and only 0.44 / 0.53 for BNB. BNB on Supra looks idiosyncratic.
- **Consequences:**
  1. Binance-calibrated barriers are too wide for Supra, giving fewer touches (P(TP) on the recorded hour is lower on Supra than on Binance for the same lanes).
  2. A player watching Binance sees Supra's next 1-2 s in advance. This is covered by `ENTRY_DELAY_SEC` and section 6.3.

### 6.5 Duration

**Recommend D = 30 s.** It enables more tiers (2 vs 0 strict; 3 vs 1 robust), and it cuts P(timeout) by about 5-13 pp compared with D = 20, so more rounds resolve by touch. D = 20 is viable only for SOL CRUISE, and only with the robust σ.

---

## 7. Misc facts (T5)

- **OpenZeppelin [M].** `utils/ReentrancyGuardTransient.sol` has existed since **v5.1.0** and `utils/NoncesKeyed.sol` since **v5.2.0**; both are in every release up to the latest **v5.7.0** (2026-07-29). `forge soldeer install @openzeppelin-contracts~5.7.0` works, as do 5.6.1 and 5.2.0. The Soldeer package root is OZ's `contracts/` folder, so remap `@openzeppelin/contracts/=dependencies/@openzeppelin-contracts-5.7.0/`. A test contract using `ReentrancyGuardTransient`, `NoncesKeyed` and `MerkleProof.multiProofVerify` compiled with solc 0.8.28 / cancun.
- **RTT**: see the section 2 tables (`results/t5-rtt.json`).
- **Historical `/get_proof` [M].** Not supported. Adding any extra JSON field (`round`, `timestamp`, `round_id`, `rounds`, `start_time`/`end_time`, `block`) gives HTTP 400 `{"message":"Invalid JSON body"}`, because unknown fields are rejected. `GET` gives 405. Other paths tried (`/get_historical_proof`, `/get_proof_by_round`, `/history`, `/get_price`, `/docs`, `/openapi.json`, `/health`, …) give 404. The gRPC `PullRequest` has only `pair_indexes` and `chain_type`. `chain_type` also accepts `sui` (different proof format).
- **Gas price [M].** `eth_gasPrice` = 0.1 gwei, base fee 0.

---

## 8. Risks and open questions

1. **Undocumented verifier entry point [I].** Supra could restrict or alter `requireHashVerified_V2`, or rotate keys. Mitigation: a configurable verifier, upgrade and key monitoring, void-on-unverifiable, and optionally a fallback that accepts Supra's stateful verify only when the returned `round` equals the proof's round.
2. **Single archive [M/I].** Supra REST is latest-only, so a second not captured by any recorder is lost and the round is voided. Run ≥ 2 recorders on different networks. Consider letting clients (the player's app) submit proofs they observed, since stateless recording is permissionless.
3. **Momentum and lag front-running [M].** This is the biggest economic risk (section 6.3). A Binance-watching player had a positive expectation on every tested lane on the recorded Supra hour, even at an 8 s entry delay. It is not an oracle-integrity issue, but it decides whether the house edge survives. It needs Supra-native calibration (≥ 7 d of recorded rounds) and a payout or entry design change, not just constant tuning.
4. **Lane feasibility [M/I].** HYPER and WARP are infeasible under the stated constraints at D ≤ 30 s (section 6.2). This is a product decision.
5. **Recording cost [I].** Recording 24/7 costs about 2.4-4 tBNB/day. Record on demand and/or batch.
6. **Inclusion latency not measured [I].** No tx was allowed, so tx-to-inclusion latency on chain 97 is inferred from block time (450 ms [M]) and RPC/WSS lag. Measure it with a funded key before tuning `EXIT_DELAY_SEC`.
7. **Public RPC quality [M].** The HTTP `latest` block is about 1.9 s stale on the bnbchain.org RPCs. publicnode has multi-second p95 RTT spikes. Use WSS heads plus two RPCs for sending.
8. **Short sample windows.** T1 covered 60 min on a Saturday (quiet hours); the Binance data covers 7 d. The edge standard error is about ±0.3-0.6 pp. Re-run the recorder over a weekday and high-volatility hours.
9. **Supra stateful-path griefing (if anyone uses it) [I].** Under F1, whoever pushes a newer proof first makes older rounds unrecordable through `verifyOracleProofV2`. This is another reason to go stateless.

---

## 9. Files

| path | what |
|---|---|
| `research/spike-report.md` | this report |
| `research/lane-params.json` | per-asset lanes (strict constraints, D = 30) + methodology + dataWindow |
| `research/fixtures/supra-97-1790414769.json` | 23-second consecutive proof fixture (T2) |
| `research/poc/src/StatelessSupraVerifier.sol` | stateless verification PoC (library + deployable + constructor-only eth_call variant) |
| `research/results/t1-metrics.json` | recorder metrics (60 min main + 10 Hz burst) |
| `research/results/t3-onchain.json` | on-chain test results (real-chain eth_call + fork) |
| `research/results/t4-calibration-full.json` | full calibration: σ/ACF/VR per asset, all tiers for D = 20/30, regimes, strategy stress, entry-delay sweep, Supra proxy check |
| `research/results/t4-calibration-robust-sigma.json`, `research/results/lane-params-robust-sigma.json` | sensitivity run with the robust σ |
| `research/results/t5-rtt.json` | RTT measurements |
| `research/scripts/*.mjs` | recorder, analysis, fixture capture, on-chain tests, Binance fetch, calibration, RTT, report tables |
| `research/abi/oracleProofV2.json` | Supra OracleProofV2 ABI (from Entropy-Foundation/oracle-pull-example) |
| `research/package.json`, `research/pnpm-lock.yaml` | standalone deps (viem only; `pnpm install --ignore-workspace`) |

Raw data (NDJSON recordings, proofs sidecar, Binance binaries, about 150 MB) is in `research/data/`. It is gitignored and regenerable with the scripts.
