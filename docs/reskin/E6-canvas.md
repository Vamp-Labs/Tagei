# E6 — Canvas world (track, rocket, particles)

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e6-canvas` | `Tagei-worktrees/reskin-e6` | 5186 | tag `reskin-e0` |

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
- [ ] **E6-1 `src/canvas/theme.ts`**
  - A role map built from `palette.ts`, holding precomputed `rgba` strings for every alpha actually used.
  - It replaces every literal in the four files, the `${hex}88/66/99/bb` alpha suffixes (`renderer.ts:423,533,546`, `rocket.ts:593,608`), the charge/damage RGB ladders (`rocket.ts:10-23`) and `TIER_COLORS` (`rocket.ts:121`).
  - Clear the `gradCache` (`rocket.ts:105,160-168`) only if the palette ever changes at runtime; it doesn't today.
- [ ] **E6-2 Track** (`MarketTrackCanvas.tsx:192-217`)
  - No active round: an `ink-soft` line with a `frame`-blue glow (not gold).
  - Active round: `profit` when P&L ≥ 0, `loss` when below. Only the fill alpha changes.
  - Pass the colors through a ref, so the render loop does not restart on every tick.
- [ ] **E6-3 Markers** (`renderer.ts:280-481`)
  - Zones in `lucky` / `amber` at low alpha, labeled "PROFIT ZONE" / "STOP ZONE" with no ▲▼ glyphs (Figtree lacks them; draw a small triangle path if you need one).
  - Entry: an `info` dashed line and ring, with an `ink` "ENTRY 611.96" tag on `tile`.
  - The delta badge reads "+1.37 USDT".
- [ ] **E6-4 Real labels**
  - Add an optional trailing `labels?: {target: string; stop: string}` parameter to `renderMarkers` (the shape A6 already plans).
  - `MarketTrackCanvas` computes them from `activeRound` + `DEFAULT_CONFIG`: "TARGET +2.16 USDT · 619.31" and "STOP −1.62 USDT · 606.46".
  - The burst text uses the real P&L; remove the `'+$18.40'` defaults (`renderer.ts:448,478`, `MarketTrackCanvas.tsx:119`, `particles.ts:96`).
- [ ] **E6-5 Direction vs outcome**
  - The projected SHORT path is `info`, not red (`renderer.ts:494`).
  - The thruster color follows the outcome only (`rocket.ts:254-268`).
  - The trail color follows the P&L sign, not screen motion (`rocket.ts:532-535`).
  - The last-round marker is `lucky` / `amber`.
- [ ] **E6-6 World**
  - Background gradient `canvas → lobby → lobby-active` (`renderer.ts:63-65`). The win "boom" tints toward `lucky`, not gold.
  - Stars in `ink` / `hero-sky`; grid lines in `line`.
  - Hull in `ink-soft` metal with `lobby-raised` / `lobby-active` fins, and the BNB stripe in `gold` (`rocket.ts:777`).
  - Coin particles in `gold` / `gold-deep` / `gold-bright`, and `particles.ts:724` must use `p.color`.
  - Every loss effect (mist, sparks, embers, hazard lamps, arcs, scorch) uses the amber family: `amber`, `gold-deep`, `ink-muted`. No red, magenta or cyan remains.
- [ ] **E6-7 Reduced motion and flashing**
  - Gate the render-time jitter (`rocket.ts:553-558`).
  - Replace per-frame random colors (`rocket.ts:581`, `:1063`) with a stable amber.
  - Arcs and flame sputter are off under reduced motion.
  - The hazard lamp strobe stays at or below 2.5 Hz (it reaches 3.5 Hz today).
  - Don't use confetti here.
- [ ] **E6-8 Text and accessibility**
  - Every `ctx.font` uses `canvasFont(800, px)` (Figtree) with a minimum of 13px. Canvas can't do `tnum`, so either use a fixed digit advance (`measureText('0')`) or anchor numbers left or right, so that ticking numbers don't shift.
  - Size tag widths with `measureText`.
  - Give `<canvas>` `role="img"` and an `aria-label` that changes by stage.
- [ ] **E6-9 Performance:** keep every decay constant and timing. Precompute color strings; add no per-frame allocations. Keep the 2x pixel-ratio cap.

## Acceptance
- The gates in OWNERSHIP.md pass on `src/canvas/**`: no hex or rgba literals, no `monospace`, no glyphs.
- `pnpm typecheck` and `pnpm test` are green.
- All scenes above have been shot and self-reviewed:
  - direction and outcome read correctly (a winning SHORT is lucky, not blue or amber);
  - no red, magenta, cyan or hot remains;
  - the labels match the engine values;
  - reduced-motion shots show no jitter or flicker.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
