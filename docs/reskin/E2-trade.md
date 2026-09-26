# E2 — Trade flow (setup, live, position details, launch countdown)

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e2-trade` | `Tagei-worktrees/reskin-e2` | 5182 | tag `reskin-e0` |

## Goal
The core loop covers picking a direction and stake, holding to launch, watching live P&L, and holding to cash out. It should feel like a Lucky game show:
- one hot hold button;
- direction always in `dir-long` / `dir-short` (lucky ▲ / info ▼), never in an outcome color;
- P&L in `profit` / `loss` (lucky / amber), exact, with the code after the amount.

This epic also fixes the stuck countdown.

## Owned files
- `src/components/PreTradePanel.tsx`
- `src/components/LiveTradeOverlay.tsx`
- `src/components/PositionDetails.tsx`
- `src/components/LaunchCountdown.tsx` (nothing mounts it yet; A6 will mount it at `LAUNCHING`)
- `src/components/trade/**` (new)
- this doc

Before-shots: `08-trade-setup.png`, `variants/08-trade-setup.png`, `09-live-trade.png`, `variants/10-live-trade.png`, `variants/13-live-trade-loss.png`, `10-position-details.png`.
Scenes: `trade-setup`, `trade-setup-empty`, `trade-setup-short`, `live-profit`, `live-loss`, `live-short`, `live-near-target`, `position-details`.

## Contracts consumed
`HoldButton variant="hot"`, `SegmentedTabs` (radiogroup, long/short tones, sheet surface), `DirectionChip`, `SignedAmount`, `StatTable`, `Pill`, `Button`, `Icon` (plus, minus, tri-up, tri-down), `SheetHeader`, `AssetDisc`, `format.ts`, `useMotionPref`, `MICRO`/`STANDARD`.

Placement:
- The Sheet chrome around PreTradePanel comes from App (`Sheet variant="game"`).
- Band A is the top 0–56px of `#track-stage`. It is yours, for the portaled LIVE pill and the timer. PIX lives in band B (`top-16`).

## Tasks

### PreTradePanel
- [ ] **E2-1 LONG/SHORT** (`PreTradePanel.tsx:74-120`): new `trade/DirectionToggle.tsx` built on `SegmentedTabs`, with `role="radiogroup"`, `surface="sheet"` and `value={selectedDirection}` (`null` means none).
  - Only the selected cell takes its tone. LONG is `dir-long` with a tri-up icon; SHORT is `dir-short` with a tri-down icon. The other cell stays `ink-secondary`. Never color both.
  - Keep the 0.97 tap scale (MICRO) and the sound call.
  - Move the four SHORT-direction uses of `--color-short` here to `dir-short`.
- [ ] **E2-2 Amount** (lines 122-168)
  - ± as 48px `Button variant="icon"` discs.
  - The value "10 USDT" in `text-numeral tabular-nums`, optionally with the `usdt` currency disc.
  - Preset chips 5 / 25 / 50: selected = `lucky-tint` background with `aria-pressed`.
  - Keep the 25ms number roll and every handler.
- [ ] **E2-3 Leverage** (lines 170-195)
  - Keep the `LEVERAGE_OPTIONS` map as it is (A6 will enable tiers). The chips get `aria-disabled`.
  - "Active 18x" becomes a neutral `Pill` (not gold, not hot) with a "fixed by the game engine" micro caption.
- [ ] **E2-4 Launch button** (lines 197-211): `HoldButton variant="hot"` with the label "HOLD TO LAUNCH!" and holding label "HOLDING…".
  - Disabled (no direction): `bg-control` with "SELECT LONG OR SHORT", not hot.
  - The one-shot pulse runs only when not in reduced motion.
- [ ] **E2-5 Summary line** (lines 213-217): a small `DirectionChip` plus "BNB · 10 USDT · 18x" in 13px `ink-muted`.

### LiveTradeOverlay
- [ ] **E2-6 Timer bug** (lines 114-130)
  - Hold `onTimeout` in a ref (the same pattern as `MissionToast.tsx:23-24`); the interval effect depends only on `[autoResolveEnabled]`.
  - The state updater only decrements. A separate effect calls the timeout once when `timeLeft === 0`, guarded by a fired-ref. Never call callbacks inside a state updater, because StrictMode runs it twice.
  - Verify under `pnpm dev` (StrictMode): 00:20 counts down to 00:00, and exactly one settlement happens.
- [ ] **E2-7 Portaled HUD in band A** (lines 143-162)
  - `Pill`s on `bg-panel`: "BNB · LIVE" in 13px uppercase 800 with a lucky dot (the pulse stops under reduced motion).
  - Timer in `tabular-nums`, `loss` tone at 5s or less (no blinking); "∞" when auto-resolve is off.
- [ ] **E2-8 P&L hero** (lines 168-234)
  - `SignedAmount` in `text-display`. Drop `text-glow-*`; the aura uses tokens (`profit`/`loss` at low alpha).
  - Delta pops: "+0.12" at 13px, keeping the 700ms / 0.15s timings.
- [ ] **E2-9 Direction and cash-out**
  - Lines 236-250 become a `DirectionChip` plus "18x"; move the SHORT use (line 239) to `dir-short`.
  - Lines 253-271: always a hot `HoldButton` labeled "HOLD TO CASH OUT!". It pulses only while P&L ≥ 0, as today.
  - The "Position details" link is a `ghost` button, at least 44px.

### PositionDetails and LaunchCountdown
- [ ] **E2-10 PositionDetails**
  - `SheetHeader` "Position Details" / "live · BNB/USDT", with a `DirectionChip` in the action slot.
  - Big P&L as a `SignedAmount` percentage and amount.
  - `StatTable` built from the existing `rows` array: Target in `profit`, Stop Loss in `loss`, prices like "611.96 USDT".
  - Move the SHORT use (line 56) to `dir-short`, and remove the rgba at line 57.
- [ ] **E2-11 LaunchCountdown:** tokens only (lucky ring, no cyan, no hex). Typecheck it even though nothing mounts it.
- [ ] **E2-12** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and glyph in the owned files.

## Copy table
| Old | New |
|---|---|
| Hold to Launch / Holding… | HOLD TO LAUNCH! / HOLDING… |
| Select Long or Short | SELECT LONG OR SHORT |
| Hold to Cash Out | HOLD TO CASH OUT! |
| +$1.37 | +1.37 USDT |
| Amount $10 | AMOUNT · 10 USDT |
| Active: 18x | 18x · fixed by the game engine |
| BNB · LIVE | BNB · LIVE (13px) |

## Acceptance
- The gates in OWNERSHIP.md pass; `pnpm typecheck` and `pnpm test` are green.
- The timer fix is verified in dev: it counts down and settles exactly once.
- All eight scenes have been shot in normal and `--reduced` mode and self-reviewed. Each shows exactly one hot element. A mid-press shot with `--hold "<launch selector>":250` shows the ring.
- Hold, slip-cancel, mouse/keyboard instant commit and haptics behave as before.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
