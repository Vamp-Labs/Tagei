# E2 — Trade flow (setup, live, position details, launch countdown)

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| done | `reskin/e2-trade` | `Tagei-worktrees/reskin-e2` | 5182 | tag `reskin-e0` |

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
- [x] **E2-1 LONG/SHORT** (`PreTradePanel.tsx:74-120`): new `trade/DirectionToggle.tsx` built on `SegmentedTabs`, with `role="radiogroup"`, `surface="sheet"` and `value={selectedDirection}` (`null` means none).
  - Only the selected cell takes its tone. LONG is `dir-long` with a tri-up icon; SHORT is `dir-short` with a tri-down icon. The other cell stays `ink-secondary`. Never color both.
  - Keep the 0.97 tap scale (MICRO) and the sound call.
  - Move the four SHORT-direction uses of `--color-short` here to `dir-short`.
- [x] **E2-2 Amount** (lines 122-168)
  - ± as 48px `Button variant="icon"` discs.
  - The value "10 USDT" in `text-numeral tabular-nums`, optionally with the `usdt` currency disc.
  - Preset chips 5 / 25 / 50: selected = `lucky-tint` background with `aria-pressed`.
  - Keep the 25ms number roll and every handler.
- [x] **E2-3 Leverage** (lines 170-195)
  - Keep the `LEVERAGE_OPTIONS` map as it is (A6 will enable tiers). The chips get `aria-disabled`.
  - "Active 18x" becomes a neutral `Pill` (not gold, not hot) with a "fixed by the game engine" micro caption.
- [x] **E2-4 Launch button** (lines 197-211): `HoldButton variant="hot"` with the label "HOLD TO LAUNCH!" and holding label "HOLDING…".
  - Disabled (no direction): `bg-control` with "SELECT LONG OR SHORT", not hot.
  - The one-shot pulse runs only when not in reduced motion.
- [x] **E2-5 Summary line** (lines 213-217): a small `DirectionChip` plus "BNB · 10 USDT · 18x" in 13px `ink-muted`.

### LiveTradeOverlay
- [x] **E2-6 Timer bug** (lines 114-130)
  - Hold `onTimeout` in a ref (the same pattern as `MissionToast.tsx:23-24`); the interval effect depends only on `[autoResolveEnabled]`.
  - The state updater only decrements. A separate effect calls the timeout once when `timeLeft === 0`, guarded by a fired-ref. Never call callbacks inside a state updater, because StrictMode runs it twice.
  - Verify under `pnpm dev` (StrictMode): 00:20 counts down to 00:00, and exactly one settlement happens.
- [x] **E2-7 Portaled HUD in band A** (lines 143-162)
  - `Pill`s on `bg-panel`: "BNB · LIVE" in 13px uppercase 800 with a lucky dot (the pulse stops under reduced motion).
  - Timer in `tabular-nums`, `loss` tone at 5s or less (no blinking); "∞" when auto-resolve is off.
- [x] **E2-8 P&L hero** (lines 168-234)
  - `SignedAmount` in `text-display`. Drop `text-glow-*`; the aura uses tokens (`profit`/`loss` at low alpha).
  - Delta pops: "+0.12" at 13px, keeping the 700ms / 0.15s timings.
- [x] **E2-9 Direction and cash-out**
  - Lines 236-250 become a `DirectionChip` plus "18x"; move the SHORT use (line 239) to `dir-short`.
  - Lines 253-271: always a hot `HoldButton` labeled "HOLD TO CASH OUT!". It pulses only while P&L ≥ 0, as today.
  - The "Position details" link is a `ghost` button, at least 44px.

### PositionDetails and LaunchCountdown
- [x] **E2-10 PositionDetails**
  - `SheetHeader` "Position Details" / "live · BNB/USDT", with a `DirectionChip` in the action slot.
  - Big P&L as a `SignedAmount` percentage and amount.
  - `StatTable` built from the existing `rows` array: Target in `profit`, Stop Loss in `loss`, prices like "611.96 USDT".
  - Move the SHORT use (line 56) to `dir-short`, and remove the rgba at line 57.
- [x] **E2-11 LaunchCountdown:** tokens only (lucky ring, no cyan, no hex). Typecheck it even though nothing mounts it.
- [x] **E2-12** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and glyph in the owned files.

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
- **`src/ui/HoldButton.tsx`**
  - Change: drive the ring rect's `opacity` through a MotionValue, `animate`, or a plain attribute, not a static `style` value.
  - Why: Motion memoises an SVG element's static `style` at mount, so `style={{ opacity: isHolding ? 1 : 0 }}` on the `motion.rect` stays at 0. The hold ring never shows. This was already true before E0.
  - Workaround: `src/components/trade/holdRing.ts` exports `HOLD_RING_VISIBLE` (`[&>svg>rect]:!opacity-100`). Both hot hold buttons use it. At rest the ring is fully dash-offset, so it stays invisible.
- **`src/ui/lucky/SegmentedTabs.tsx`**
  - Change: an optional per-cell press scale (for example `pressScale?: number`, applied with `whileTap` and MICRO).
  - Why: the LONG/SHORT cells must keep their 0.97 MICRO tap scale, and the primitive renders plain buttons.
  - Workaround: `trade/DirectionToggle.tsx` wraps the tabs in a `useAnimate` scope and scales the pressed `.lg-tab` on pointer down and up. This is skipped under reduced motion.
- **`src/ui/lucky/SignedAmount.tsx`**
  - Change: accept a `MotionValue<number>`, or export a `useSignedAmountText(mv)` helper.
  - Why: the live P&L glides on a spring and must not re-render React every frame.
  - Workaround: `LiveTradeOverlay` renders `useTransform(pnlMV, v => formatAmount(v, null))` into a `motion.span`, with the colour from `useTransform(pnlMV, …ROLE.profit/loss)`.

## Notes / open issues
- **Timer (E2-6), checked in `pnpm dev` under StrictMode** with `/?scene=live-profit&delta=0`, not frozen, the feed stopped and `web3Service.executeSettlement` wrapped with a counter. Two seeds both ran 00:19 → 00:01, then "TIME UP", with **exactly one** settlement each.
- **Double settlement on a target hit (App, deferred to A6).** One non-frozen run hit the target instead, and `executeSettlement` ran **twice**. The App tick loop re-subscribes on every `activeRound` change (`App.tsx:283-311`), so two ticks can each schedule `finalizeRound('win')`. Fix: guard with a `resolvingRef`, or return early once `stage !== 'LIVE_TRADE'`.
- **LIVE render loop (E2-8).** The per-frame `setState` inside `useMotionValueEvent` is gone. The P&L text, colour and pop scale are MotionValues. The "Maximum update depth" logs left in LIVE scenes come from App's tick effect (A6).
- **Cash-out pulse.** It is decided once, at mount (`pnl ≥ 0`). It does not re-fire when the sign flips, per the MOTION §3 hot-pulse rule. Before, it re-triggered every time the P&L crossed back above zero.
- **Motion.** Loss-side pops now use `EASE_OUT`; gains keep `POP_EASE`. Durations are unchanged. Under reduced motion:
  - the P&L and stake snap;
  - there is no pop scale and no tap scale;
  - the live dot is solid;
  - LaunchCountdown drops its ring and shows "ENTRY LOCKED".
- **Copy.** LaunchCountdown's "LIFTOFF!" became "LIFTOFF", because "!" is reserved for the hot CTA. PositionDetails' subtitle reads "closed · …" once `round.outcome` is set, because the sheet also opens from RESULT.
- **Layout.** The PositionDetails title sits about 20px left of centre, because the SheetHeader grid pairs a 48px spacer with a wider action chip. The Trade Setup sheet is about 60px taller than before, because the preset chips now have their own 44px row.
- **Canvas.** Labels in the canvas (legacy "$" and mono text, magenta stop line) belong to E6.

