# A1 — Spike (W1) → QA/E2E (W4)

**Branch:** `feat/a1-spike` · **Worktree:** `…/Tagei-worktrees/a1-spike` · **Owns:** `research/**`, later `e2e/**`, `server/test/{integration,fakes}/**`, `tools/demo-check.ts`

## W1 — Supra go/no-go + lane calibration (dispatched)

Deliverables, all under `research/`:
- `spike-report.md` — GO/NO-GO, metrics, F1 confirmation, stateless-verification finding, recommended constants
- `fixtures/supra-97-<unixSec>.json` — ≥ 21 consecutive 5-pair proofs + decode + the capture block
- `lane-params.json` — per asset σ₁ₛ, gapMarginPpm, maxJumpPpm, duration, tiers (M/T/S/fee + backtest stats)
- `scripts/` — recorder, analysis, calibration (reproducible; raw data in gitignored `research/data/`)

Gate G0 needs the report to say GO, or give a clear fallback (`SignedPriceVerifier`).

## W4 — QA (after M2)

- `e2e/` Playwright projects Pixel 7 (Chromium) + iPhone 15 (WebKit).
  - `@anvil` suite against a compose stack (Postgres + anvil + server + FakeSupra + `vite preview`) with scripted price paths: win, loss, timeout, cash-out, open failure, void, reload-resume.
  - `@testnet` smoke against staging: guest → faucet → open → cash-out → result → profile; assert the UI matches the chain receipt.
- `server/test/fakes/fakeSupra.ts`: serves `/get_proof` from scripted paths using the real `OracleProofV2` encoding.
- `tools/demo-check.ts`: relayer/recorder/ops balances, oracle lag/status, RPC, faucet, on-chain lanes, last-10-min touch rate per asset.
