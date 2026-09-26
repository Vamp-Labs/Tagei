# E6 — Canvas world (track, rocket, particles)

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| done | `reskin/e6-canvas` | `Tagei-worktrees/reskin-e6` | 5186 | tag `reskin-e0` |

## Goal
The market track and rocket sit behind every screen. Today they paint BNB yellow, neon green, magenta and cyan from about 145 hardcoded literals, and print fake dollar labels. This epic moves the whole canvas onto Lucky roles:
- a blue-lobby stage;
- an `ink-soft` idle track, lucky or amber when active;
- an `info` entry marker, a lucky target and an amber stop;
- gold coins and a gold BNB stripe;
- no red and no hot anywhere.

It also prints real amounts ("TARGET +2.16 USDT") and makes every effect respect reduced motion. The canvas counts as illustration, so gradients are fine here.

## Owned files
- `src/canvas/**`: `MarketTrackCanvas.tsx`, `renderer.ts`, `rocket.ts`, `particles.ts`, and the new `theme.ts`
- this doc

Before-shots: `01-landing.png`, `02-home.png`, `08-trade-setup.png`, `09-live-trade.png`, `variants/13-live-trade-loss.png`, `11-outcome-banner.png`, `variants/17-stop-loss-hit.png`.
Scenes: `landing`, `home`, `home-last-win`, `home-last-loss`, `trade-setup`, `trade-setup-short`, `live-profit`, `live-loss`, `live-short`, `live-near-target`, `outcome-win`, `outcome-loss`. Also shoot `live-loss` and `outcome-win` with `--reduced`.

## Contracts consumed
- `src/ui/lucky/palette.ts`: `TOKENS`, `ROLE`, `CANVAS`, `hexA`, `rgba`, `mix`, `canvasFont`, `FONT_FAMILY`.
- `src/ui/lucky/format.ts`: `formatAmount`, `formatPrice`.
- A read-only import of `DEFAULT_CONFIG` from `src/services/settlementEngine`.
- The `reducedMotion` prop, which App now feeds with the unified value (in-app setting OR OS setting).
- The props interface (`MarketTrackCanvas.tsx:10-23`) stays unchanged.

## Tasks
- [x] **E6-1 `src/canvas/theme.ts`**
  - A role map built from `palette.ts`, holding precomputed `rgba` strings for every alpha actually used.
  - It replaces every literal in the four files, the `${hex}88/66/99/bb` alpha suffixes (`renderer.ts:423,533,546`, `rocket.ts:593,608`), the charge/damage RGB ladders (`rocket.ts:10-23`) and `TIER_COLORS` (`rocket.ts:121`).
  - Clear the `gradCache` (`rocket.ts:105,160-168`) only if the palette ever changes at runtime; it doesn't today.
- [x] **E6-2 Track** (`MarketTrackCanvas.tsx:192-217`)
  - No active round: an `ink-soft` line with a `frame`-blue glow (not gold).
  - Active round: `profit` when P&L ≥ 0, `loss` when below. Only the fill alpha changes.
  - Pass the colors through a ref, so the render loop does not restart on every tick.
- [x] **E6-3 Markers** (`renderer.ts:280-481`)
  - Zones in `lucky` / `amber` at low alpha, labeled "PROFIT ZONE" / "STOP ZONE" with no triangle glyphs (Figtree lacks them; draw a small triangle path if you need one).
  - Entry: an `info` dashed line and ring, with an `ink` "ENTRY 611.96" tag on `tile`.
  - The delta badge reads "+1.37 USDT".
- [x] **E6-4 Real labels**
  - Add an optional trailing `labels?: {target: string; stop: string}` parameter to `renderMarkers` (the shape A6 already plans).
  - `MarketTrackCanvas` computes them from `activeRound` + `DEFAULT_CONFIG`: "TARGET +2.16 USDT · 619.31" and "STOP −1.62 USDT · 606.46".
  - The burst text uses the real P&L; remove the `'+$18.40'` defaults (`renderer.ts:448,478`, `MarketTrackCanvas.tsx:119`, `particles.ts:96`).
- [x] **E6-5 Direction vs outcome**
  - The projected SHORT path is `info`, not red (`renderer.ts:494`).
  - The thruster color follows the outcome only (`rocket.ts:254-268`).
  - The trail color follows the P&L sign, not screen motion (`rocket.ts:532-535`).
  - The last-round marker is `lucky` / `amber`.
- [x] **E6-6 World**
  - Background gradient `canvas → lobby → lobby-active` (`renderer.ts:63-65`). The win "boom" tints toward `lucky`, not gold.
  - Stars in `ink` / `hero-sky`; grid lines in `line`.
  - Hull in `ink-soft` metal with `lobby-raised` / `lobby-active` fins, and the BNB stripe in `gold` (`rocket.ts:777`).
  - Coin particles in `gold` / `gold-deep` / `gold-bright`, and `particles.ts:724` must use `p.color`.
  - Every loss effect (mist, sparks, embers, hazard lamps, arcs, scorch) uses the amber family: `amber`, `gold-deep`, `ink-muted`. No red, magenta or cyan remains.
- [x] **E6-7 Reduced motion and flashing**
  - Gate the render-time jitter (`rocket.ts:553-558`).
  - Replace per-frame random colors (`rocket.ts:581`, `:1063`) with a stable amber.
  - Arcs and flame sputter are off under reduced motion.
  - The hazard lamp strobe stays at or below 2.5 Hz (it reaches 3.5 Hz today).
  - Don't use confetti here.
- [x] **E6-8 Text and accessibility**
  - Every `ctx.font` uses `canvasFont(800, px)` (Figtree) with a minimum of 13px. Canvas can't do `tnum`, so either use a fixed digit advance (`measureText('0')`) or anchor numbers left or right, so that ticking numbers don't shift.
  - Size tag widths with `measureText`.
  - Give `<canvas>` `role="img"` and an `aria-label` that changes by stage.
- [x] **E6-9 Performance:** keep every decay constant and timing. Precompute color strings; add no per-frame allocations. Keep the 2x pixel-ratio cap.

## Acceptance
- The gates in OWNERSHIP.md pass on `src/canvas/**`: no hex or rgba literals, no mono fonts, no glyphs.
- `pnpm typecheck` and `pnpm test` are green.
- All scenes above have been shot and self-reviewed:
  - direction and outcome read correctly (a winning SHORT is lucky, not blue or amber);
  - no red, magenta, cyan or hot remains;
  - the labels match the engine values;
  - reduced-motion shots show no jitter or flicker.
- The ownership diff is clean. One commit.

## Integration requests
None. Everything was built from `palette.ts`, `format.ts` and `DEFAULT_CONFIG` as they stand.

## Notes / open issues
- **Stage gradient:** `stageTop` (lobby) at 0, `lobby-active` at 0.55, `stageBottom` (canvas) at 1. That blends with the bg-lobby header, which closes the foundation's seam issue, and it still uses the canvas → lobby → lobby-active family. The win boom mixes each stop toward `lucky` (16 precomputed steps).
- **theme.ts:** a `Tone` gives each colour a lazily built 65-step alpha ramp (`tone.a(alpha)`), plus a `lift` toward ink. The charge ladder is quantised into 8 fraction steps. `TextMemo` caches a label's text and width, and re-measures only when the value, the font or `document.fonts` changes. Font strings come from a `font(px)` table with a 13px floor. Nothing in the frame loop builds a colour string any more. The only new per-frame work is object destructuring.
- **Render loop:** it reads props from a ref that a layout effect writes, so it no longer restarts on every price tick. The `onSurge`/`onTier` callbacks are set once per mount, not once per frame.
- **Labels:** "TARGET +2.16 USDT · 621.41" / "STOP −1.62 USDT · 608.51" come from `stake × pct × DEFAULT_CONFIG.multiplierLeverage`, memoised on the round's static fields. The entry tag is "ENTRY 614.04" (seed 7 gives an entry of 614.04 rather than the 611.96 in the doc). The delta badge is `formatAmount(pnl)`. The burst text is the real P&L, or no amount text when there is no round. "TARGET HIT!" became "TARGET HIT", per the copy rules.
- **Numbers:** tag boxes are sized by measuring the label with every digit replaced by "0", and the text is left-anchored inside. The rocket P&L tracker is left-anchored on the same stable width, so its box never jitters.
- **Zone labels** now sit on the left, at the vertical middle of each zone, with a drawn triangle. On the right they collided with the rocket, the tracker and the target beacon.
- **Delta badge:** it is skipped when it would overlap the rocket P&L tracker (the rocket sits 20–116 px below entry). The tracker already shows the same amount there. The bracket lines still draw.
- **Text glows** were removed, per rubric 6. Canvas text uses a 3px `canvas`-at-85% stroke halo for legibility over the track.
- **Reduced motion:**
  - The target-hit burst, loss mist, cash-out sparkle and warp streaks are skipped.
  - The render-time jitter now reuses the jitter `update()` computes, which is already gated.
  - Flame flicker, sputter and shock-diamond pulse are off, as are the shield pulse and spin, the beacon pulse and the arcs.
  - The loss flame and the arcs use one stable amber.
  - The lamp holds at 0.55. Its frequency is `min(2.5, 0.9 + 2.6·dmg)`.
- **Colour roles:**
  - Track: idle is `ink-soft` with a `frame` glow; a round is lucky or amber.
  - Entry is `info`. The projected path is `dir-long` / `dir-short`.
  - Flame: gold when idle, then lucky or amber by outcome only. At P&L ≥ 8 it is `gold-bright` (CANVAS.flame).
  - The trail colour follows the P&L sign.
  - Tier rings use `CANVAS.tiers`.
  - Hull: `ink`→`ink-soft`→`ink-muted`, with `lobby-active` fins and `frame-muted` fin edges. The spec's `lobby-raised` edge vanished on the lobby stage.
  - The stripe and coins are gold, the coin rim `gold-bright`, and `p.color` drives the coin fill.
  - Every loss effect uses `amber`, `gold-deep`, `ink-muted` and `ink-faint`.
  - `canvas`/`role="img"` now has a stage-dependent `aria-label`.
- **Open:** the live edge "heartbeat" border can reach about 3.3 Hz at a loss of −9, but at stake 10 the stop caps the loss at −1.62, which is about 1.5 Hz. The timing was left as is.
- **Open:** many FX thresholds are still in the old "$" scale (damage at ≤ −2.5, arcs at ≤ −6, hyperdrive at ≥ 8, tiers every 2.50). At stake 10 with an 18x stop they never fire, so the loss side shows only the amber track, flame and trail. The timing and constants were kept, as required.
