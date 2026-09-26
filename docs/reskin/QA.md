# QA — `feat/lucky-reskin`

Reviewers (read-only): design fidelity (all 29 scenes, normal + reduced motion), motion audit (`work:creative-dev:auditor`), code audit (`work:frontend:reviewer`). 41 findings.

**Rejected / adjusted**
- M5 (countdown ring in info blue) — rejected: blue only means SHORT; ring is neutral `control-ring`.
- DF-14 (no coin on profile XP header) — rejected: BalanceHeader + coin is the DS pattern.
- DF-17 (timer warning amber) — adjusted: amber means loss, so the ≤5 s timer turns bold `ink`.
- CA-12 — deferred (no second consumer yet).

**Fixed (round 1, `1d764bc`)** — highlights
- PIX bubble no longer covers canvas labels or the rocket (DF-01).
- Canvas entry line, BscScan links, non-BNB asset discs neutral — blue only means SHORT (DF-04/05/06/07/16).
- Compact active-position banner keeps the stop line visible (DF-02).
- Live P&L aura removed; outcome card opaque; no unsigned delta badge after a loss (DF-03/08/09).
- No replay nudge after a loss; cash-out uses clover art; mission toast clears the result card (DF-11/12/15).
- Heartbeat and hazard strobes capped at 2.5 Hz; real-dt rocket clock; static resolving dot (M2/M3/M4).
- HoldButton ring opacity via MotionValue; WalletRow modes; RewardTile/Badge a11y; centred SheetHeader (CA-01/02/03/08, DF-13).

**Fixed (round 2, `53b8213`)** — rows rebuilt on WalletRow, banner label no longer truncates, workarounds removed.

**Verification**: typecheck, 27 tests and build green; raw-color / legacy-token / emoji gates empty; all P1s confirmed resolved in re-shot scenes.
**Not done by request**: end-to-end / flow testing — the product owner tests flows.
