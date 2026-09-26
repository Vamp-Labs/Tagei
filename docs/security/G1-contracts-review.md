# G1 — contract security review (2026-09-27, integration @ 1fdc695)

**Verdict: PASS with fixes.** The review confirmed these are correct: settlement mirrors `path.ts`, the ledger conserves its four buckets, EIP-712 and keyed nonces, stateless Supra verification (LE leaves, OZ multiproof, 3000 ms future bound), reentrancy/CEI, pause semantics, rounding toward the house, and the EIP-170 size (1,209 B headroom). 98/98 tests and 7 PoCs passed; the PoCs live in the session scratchpad `g1/`.

| ID | Sev | Finding | Status |
|---|---|---|---|
| H1 | High | The ops hot key (CONFIG) can register an oracle, raise the limits and a 10x lane, and drain the house in one block (PoC: 1M tUSD → 0) | **fixing (A2)**: CONFIG goes cold/admin; ops gets a bounded `tuneLane` only |
| H2 | High (econ) | Informed flow beats the lanes. Supra lags Binance by 1–2 s; cash-out exit ≈ lag | **before mainnet**: randomised/longer delays, a concave interior, Supra-native recalibration (F1e P1) |
| M1 | Med | Whoever records holds a free option to void (censor a touch → Stalled void) | **before mainnet**: client proof archiving/self-record, block opens while the oracle is stale |
| M2 | Med | The relayer picks the entry/exit second within the intent TTL | **fixed (A0)**: `INTENT_TTL_SEC` open 6 s / cash-out 4 s |
| L1 | Low | A late conflicting proof (DISPUTED) can flip a decided outcome | **fixing (A2)**: a disputed second voids |
| L2 | Low | `setAsset` does not bump lane versions (a signed intent can be re-pointed) | **fixing (A2)** |
| L3 | Low | `settleMany` is not fault-isolated | **fixing (A2)** |
| L4 | Low | The deployer EOA holds every role, with no timelock | **before mainnet**: multisig + timelock; revoke the extras |
| L5 | Low | The testnet minter can overflow the uint128 buckets | testnet-only, accepted |
| Info | – | `VOID_STALE_MIN_GAS` margin ≈ 35 % → raise to ~1.5M; monitor Supra proxy `Upgraded`; invariant gaps (liveness, admin paths) | **fixing (A2)** / monitor exists (A3 `supraMonitor`) |
