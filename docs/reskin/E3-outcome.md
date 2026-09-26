# E3 — Outcome, settlement, result, mission

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| done | `reskin/e3-outcome` | `Tagei-worktrees/reskin-e3` | 5183 | tag `reskin-e0` |

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
- [x] **E3-1 Win banner** (`OutcomeBannerOverlay.tsx:39-115`)
  - Card: `.lg-card` (`bg-sheet` at about 92%, `frame-muted` outline, `radius-xl`, `lift`), replacing `glass-panel`.
  - `ART['reward-crown']` as the first stagger child.
  - "TARGET HIT" in `lucky` (no "!"), "+2.16 USDT" as a `display` `SignedAmount`, and a "1.22x payout" caption.
  - Keep HERO, the 0.07/0.05 stagger and the 0.32s pop; add `role="status"`.
- [x] **E3-2 Loss banner** (lines 116-157)
  - "ROUND COMPLETE" in `ink-soft`, with no ShieldAlert and no glow.
  - The amount "−1.62 USDT" in `loss`, with the caption "Stop loss reached as planned."

### Settlement
- [x] **E3-3 Settlement overlay**
  - Scrim via `Scrim tone="dim"`; card `.lg-card`.
  - Progress ring: `gold` (the BNB checkpoint), switching to `lucky-bar` with `Icon check` when confirmed. `glow-gold` only on the center tile.
  - Titles: "Settling on BNB Chain…" / "Confirmed on BNB Chain".
  - Tx row on `bg-well`, with an `info` "BscScan" link that has an `aria-label` and a `formatHash` hash.
  - Keep the step timings and the dots.

### Result panel
- [x] **E3-4 Count-up bug** (`ResultPanel.tsx:79-172`). Split the effect in two:
  - (a) Once-per-`result.id` side effects (win confetti via `useConfetti`), guarded by a ref.
  - (b) The P&L and XP animation, with no early return and a full cleanup, so StrictMode's mount → cleanup → mount restarts it and it lands on the exact value.
  - Level-up sound and confetti fire when (b) completes, guarded per result.
  - Under `useMotionPref()`, show the final values immediately.
  - Replace `useReducedMotion` with `useMotionPref`.
- [x] **E3-5 Result card**
  - Outcome label: TARGET HIT, CASHED OUT, TIME UP or ROUND COMPLETE. The label accent is `lucky`, `ink`, `ink-muted` or `ink-soft`; the amount carries the profit or loss tone.
  - Art: `reward-crown` for a win, `coin` for a profitable cash-out, none after a loss.
- [x] **E3-6 Rows and XP**
  - The table becomes a `StatTable` built from the existing `rows` array (A6 will add Duration).
  - XP becomes a `Panel` with a `ProgressBar` (next level = level + 1) and "720 → 770 XP".
  - Level-up variant: a `gold` "LEVEL UP" and the `coin` art, with a gold `ProgressBar`.
- [x] **E3-7 CTA rule**
  - P&L ≥ 0: a hot "TRADE AGAIN!" with its one-shot pulse (off under reduced motion).
  - P&L < 0: a secondary "Trade again" with no pulse, and the "View details" link becomes "Review round".
  - The mission copy moves out of the button into a 13px caption.
  - Home and BscScan are icon buttons with `aria-label`s. Keep the scrim and drag-to-dismiss exactly as they are.

### Mission toast
- [x] **E3-8 MissionToast**
  - Keep the drag, the 3200ms auto-dismiss and STANDARD.
  - `ART['reward-gift']`, a "DAILY MISSION" eyebrow, the title "Mission Complete", a check `Badge`, `role="status"`.
  - Confetti via `useConfetti().burst('mission')`.
- [x] **E3-9** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and glyph in the owned files. No `glass-panel` or `glow-*` classes.

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
| File | Change | Why | Workaround |
|---|---|---|---|
| `src/ui/lucky/Icon.tsx` | Add `home`, `external`, `shield-check`, `arrow-right`, plus the settlement step glyphs (`bolt`, `key`, `broadcast`) | The result footer, the BscScan links and the settlement ring need glyphs `Icon` doesn't draw | `lucide-react` (already a dependency) at `strokeWidth={2.4}` (`GLYPH_STROKE` in `outcome/tokens.ts`); the XP arrow is `Icon name="back"` rotated 180° |
| `src/ui/motion.ts` | Export `POP_EASE` `[0.34,1.56,0.64,1]` and a `POP` 320 ms transition | MOTION.md says hoisting it needs an E0a request; the banner and the result both use it | `src/components/outcome/tokens.ts` (`POP_EASE`, `POP_SECONDS`, `POP`, `REDUCED_FADE`) |

## Notes / open issues
- **Mission confetti: none.** E3-8 asks for `burst('mission')`, but MOTION.md §4 (rank 4: "the toast slides in and the check pops. Nothing else.") and CONTRACTS.md ("cash-out, timeout, mission and loss get none") both say no. The run brief said to follow MOTION.md, so the toast keeps its sound and check pop and fires no confetti. Adding it back is one line in `MissionToast.tsx`.
- **Cash-out confetti removed.** The old code also fired win confetti on a profitable cash-out; MOTION.md §4 ranks that 3 (no confetti). `win` fires only on `outcome === 'win'`, and `levelUp` fires when the XP count lands on a level-up. Each is guarded per `result.id`.
- **Count-up fix (E3-4).** `outcome/useResultCounters.ts` runs one rAF loop (P&L 650 ms ease-out cubic, XP 800 ms linear, unchanged), with no early return and a full cleanup, so StrictMode's mount → cleanup → mount restarts it. Verified in dev under StrictMode: every result scene lands on the exact P&L and XP, and the level-up scene shows LEVEL UP. Under `useMotionPref()` the final values render on the first paint.
- **Result scrim.** The inline `rgba()` radial is now `Scrim tone="game"` (same radial shape, lighter: 0.55 at the bottom vs 0.90). The tap-to-close and drag-to-dismiss (120 px / 500 px/s, now the `DISMISS_*` constants) are unchanged. The card itself is opaque, so contrast holds.
- **Pulse.** `lg-pulse-hot` goes on the hot CTA only when the rounded P&L is > 0 and motion is on. The hot CTA shows at P&L ≥ 0 (rounded), per CONTRACTS.
- **Settlement.** The step caption now rises 8 px (MOTION.md §2); its spring is unchanged. The ring's dash offset snaps under reduced motion.
- **Mission toast overlaps the top of the result card** (the crown) in `mission-toast`. That's the pre-existing `top: calc(var(--sa-top) + 4.75rem)`, and the toast auto-dismisses after 3.2 s. Left as is.
- **Seen in my scenes, owned elsewhere:** the PIX bubble "Nice landing!" renders a missing-glyph box (emoji, E5); the canvas labels still read "TARGET WIN +$18.40 ($621.41)" in the legacy style, and the stop line is red-pink (E6).
- **Per-frame `setState`.** The 800 ms count-up re-renders `ResultPanel` each frame, as it did before. It's cheap here, but a MotionValue-driven text node would avoid it.
