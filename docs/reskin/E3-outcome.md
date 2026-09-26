# E3 — Outcome, settlement, result, mission

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e3-outcome` | `Tagei-worktrees/reskin-e3` | 5183 | tag `reskin-e0` |

## Goal
The payoff moments are the target-hit banner, on-chain settlement, the result card and the daily-mission toast. They should celebrate like a Lucky game show when the player wins, and stay calm and respectful when they lose (PRD §22-24): amber numbers, no pulse, no retry pressure. This epic also fixes the result count-up that shows ±0.00 in dev.

## Owned files
- `src/components/OutcomeBannerOverlay.tsx`
- `src/components/SettlementOverlay.tsx`
- `src/components/ResultPanel.tsx`
- `src/components/MissionToast.tsx`
- `src/components/outcome/**` (new)
- this doc

Before-shots: `11-outcome-banner.png`, `variants/17-stop-loss-hit.png`, `12-settlement.png`, `13-result.png`, `variants/18-result-loss.png`, `variants/20-result-cashed-out.png`.
Scenes: `outcome-win`, `outcome-loss`, `settlement`, `result-win`, `result-loss`, `result-cashout`, `result-timeout`, `result-levelup`, `mission-toast`.

## Contracts consumed
`.lg-card`, `Badge` (check), `Button` (hot, secondary, ghost), `SignedAmount`, `StatTable`, `Panel`, `ProgressBar` (gold for level-up), `Pill`, `Icon`, `Scrim`, `useConfetti`, `ART` (`reward-crown`, `coin`, `reward-gift`), `format.ts` (`formatMultiplier`, `formatXp`, `formatHash`), `useMotionPref`, `HERO`/`MICRO`/`STANDARD`, and the stagger variants.

The hot CTA on the result screen appears only when P&L ≥ 0.

## Tasks

### Outcome banner
- [ ] **E3-1 Win banner** (`OutcomeBannerOverlay.tsx:39-115`)
  - Card: `.lg-card` (`bg-sheet` at about 92%, `frame-muted` outline, `radius-xl`, `lift`), replacing `glass-panel`.
  - `ART['reward-crown']` as the first stagger child.
  - "TARGET HIT" in `lucky` (no "!"), "+2.16 USDT" as a `display` `SignedAmount`, and a "1.22x payout" caption.
  - Keep HERO, the 0.07/0.05 stagger and the 0.32s pop; add `role="status"`.
- [ ] **E3-2 Loss banner** (lines 116-157)
  - "ROUND COMPLETE" in `ink-soft`, with no ShieldAlert and no glow.
  - The amount "−1.62 USDT" in `loss`, with the caption "Stop loss reached as planned."

### Settlement
- [ ] **E3-3 Settlement overlay**
  - Scrim via `Scrim tone="dim"`; card `.lg-card`.
  - Progress ring: `gold` (the BNB checkpoint), switching to `lucky-bar` with `Icon check` when confirmed. `glow-gold` only on the center tile.
  - Titles: "Settling on BNB Chain…" / "Confirmed on BNB Chain".
  - Tx row on `bg-well`, with an `info` "BscScan" link that has an `aria-label` and a `formatHash` hash.
  - Keep the step timings and the dots.

### Result panel
- [ ] **E3-4 Count-up bug** (`ResultPanel.tsx:79-172`). Split the effect in two:
  - (a) Once-per-`result.id` side effects (win confetti via `useConfetti`), guarded by a ref.
  - (b) The P&L and XP animation, with no early return and a full cleanup, so StrictMode's mount → cleanup → mount restarts it and it lands on the exact value.
  - Level-up sound and confetti fire when (b) completes, guarded per result.
  - Under `useMotionPref()`, show the final values immediately.
  - Replace `useReducedMotion` with `useMotionPref`.
- [ ] **E3-5 Result card**
  - Outcome label: TARGET HIT, CASHED OUT, TIME UP or ROUND COMPLETE. The label accent is `lucky`, `ink`, `ink-muted` or `ink-soft`; the amount carries the profit or loss tone.
  - Art: `reward-crown` for a win, `coin` for a profitable cash-out, none after a loss.
- [ ] **E3-6 Rows and XP**
  - The table becomes a `StatTable` built from the existing `rows` array (A6 will add Duration).
  - XP becomes a `Panel` with a `ProgressBar` (next level = level + 1) and "720 → 770 XP".
  - Level-up variant: a `gold` "LEVEL UP" and the `coin` art, with a gold `ProgressBar`.
- [ ] **E3-7 CTA rule**
  - P&L ≥ 0: a hot "TRADE AGAIN!" with its one-shot pulse (off under reduced motion).
  - P&L < 0: a secondary "Trade again" with no pulse, and the "View details" link becomes "Review round".
  - The mission copy moves out of the button into a 13px caption.
  - Home and BscScan are icon buttons with `aria-label`s. Keep the scrim and drag-to-dismiss exactly as they are.

### Mission toast
- [ ] **E3-8 MissionToast**
  - Keep the drag, the 3200ms auto-dismiss and STANDARD.
  - `ART['reward-gift']`, a "DAILY MISSION" eyebrow, the title "Mission Complete", a check `Badge`, `role="status"`.
  - Confetti via `useConfetti().burst('mission')`.
- [ ] **E3-9** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and glyph in the owned files. No `glass-panel` or `glow-*` classes.

## Copy table
| Old | New |
|---|---|
| TARGET HIT! WIN | TARGET HIT |
| +2.8x PAYOUT | 1.22x payout |
| ROUND COMPLETE / Stop Loss Threshold Honored | ROUND COMPLETE / Stop loss reached as planned. |
| SETTLING ON BNB CHAIN... / CONFIRMED ON-CHAIN | Settling on BNB Chain… / Confirmed on BNB Chain |
| Trade Closed / Cashed Out / Time Up / Round Complete | TARGET HIT / CASHED OUT / TIME UP / ROUND COMPLETE |
| Trade Again (always pulsing) | TRADE AGAIN! (win) / Trade again (loss, no pulse) |
| View details | View details (win) / Review round (loss) |
| MISSION COMPLETE! / DONE | DAILY MISSION · Mission Complete |

## Acceptance
- The gates in OWNERSHIP.md pass; `pnpm typecheck` and `pnpm test` are green.
- Count-up verified in dev (StrictMode): the result number lands on the exact P&L.
- All nine scenes have been shot in normal and `--reduced` mode and self-reviewed.
  - There is no hot element on loss, timeout (if negative), settlement or banner scenes.
  - There is one hot element on result-win, result-cashout and result-levelup.
- The confetti, drag-dismiss and auto-dismiss timings are unchanged.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
