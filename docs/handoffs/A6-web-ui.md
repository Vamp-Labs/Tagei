# A6 — Web UI & motion (W2)

**Branch:** `feat/a6-web-ui` · **Worktree:** `…/Tagei-worktrees/a6-web-ui` · **Owns:** `src/App.tsx`, `src/components/**`, `src/canvas/**`, `src/ui/**`, `src/index.css`, `test/ui/**`

## Read first

- `CLAUDE.md` and `docs/spec/F0-repo.md`
- **`docs/spec/F1c-stage-machine.md`**
- `docs/spec/F1d-progression.md`
- The PRD (`bnb_play_prd_v0_2_ui_motion.md`) plus `docs/UI_UX_SPEC.md`, `docs/ASSET_MOTION_SPEC.md`, `docs/DESIGN_TOKENS.md`
- A5's handoff: you consume `roundService` / `FakeRoundService`, `marketFeed.subscribeRounds`, `fxPnl`, `web3Service`, and the API types

## Deliverables

1. **`App.tsx` stage machine per F1c** (Live via `roundService`, Practice via the local engine):
   - `LAUNCHING` renders `LaunchCountdown`;
   - fix the per-tick re-subscribe loop (one `subscribeRounds` subscription per round id, with a ref for the round);
   - exit and P&L come from the same exact round;
   - resume from `hello`;
   - remove every hardcode (18.4, 12.5, −4.2, 2.8, 2.84, the fake hashes);
   - render the SIM bar **only in Practice**.
2. **Components:**
   - `LaunchCountdown`: event-driven phases with minimum durations; Practice keeps 780 ms.
   - `LiveTradeOverlay`: timer from `endSec` via `serverNow`; tier label; frozen "≈" snapshot on cash-out.
   - `SettlementOverlay`: real steps, an explicit `failed` state with the PRD §27 copy, the testnet link via `explorerTxUrl`, and a Practice variant.
   - `ResultPanel`: chain values, XP from `progression.updated`, a voided state, a Duration row.
   - `PreTradePanel`: enabled tier chips from config; copy computed from the lane ("Target +0.05% · Stop −0.04% · 2x").
   - `PositionDetails`: Tier / Payout at target / Cash-out now / Fee / Ends in (drop Est. Liquidation).
   - `PilotProfileDrawer`, `Menu`, `MissionToast`: server data; guest-key export; Practice-mode toggle replaces the Binance toggle.
   - `PixChat`: a real input with streaming.
   - `PixCompanion`: thresholds via `fxPnl`.
   - New `ConnectSheet`: Play as Guest / Browser wallet / WalletConnect.
3. **Canvas:**
   - lane labels passed into `renderMarkers` (no hardcoded dollars);
   - `fxPnl` for FX thresholds and rocket intensity;
   - the burst text shows the real payout;
   - the last-round marker sits at the real exit tick;
   - span floor 0.4% → 0.03%;
   - the engine is active during LAUNCHING.
   - `rocket.ts` / `particles.ts` stay untouched.
4. **`HoldButton`**: default 700 ms.

## Definition of done

- `pnpm typecheck && pnpm test && pnpm build` green.
- With `FakeRoundService`, every F1c path is demonstrable: win, loss, timeout, cash-out, open failure, settle failure, void, resume.
- **Motion parity:** Practice-mode screenshots match the baseline tag for Home/PreTrade/Live/Result (capture with the existing screenshot flow or Playwright, 390×844). The `work:frontend:reviewer` or `design-review` pass finds no regressions.

## Constraints

- Before starting, A0 confirms that the other Claude session working on the main checkout ("fix-hold-launch-trade-again") has its changes merged into `integration`. You edit the same files.
- Never edit `src/services/**`, `src/types/**` or `src/web3/**` (A5). Request API changes through the final report.
