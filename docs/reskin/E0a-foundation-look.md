# E0a — Foundation: look

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `feat/lucky-reskin` | `Tagei-worktrees/reskin-integrate` | 5180 | `00b1c44` + docs commit |

## Goal
Replace BNB PLAY's token layer, fonts and shared UI primitives with the Lucky Games system. Every screen shifts palette the moment this lands, and the six feature epics can then rebuild their screens from ready-made, typed parts. This runs at the same time as E0b (tooling), so don't touch E0b's files (see OWNERSHIP.md).

## Owned files
Owned:
- `src/index.css`, `index.html`, `gallery.html` (new)
- `public/fonts/**`, `public/lucky/**` (already populated with the 18 PNGs), `public/favicon.*`
- `src/ui/**`
- `src/components/Header.tsx`, `src/components/SimulationBar.tsx`
- `docs/DESIGN_TOKENS.md`, `docs/reskin/{E0a-foundation-look,TOKEN_MAP,CONTRACTS,MOTION}.md`, `docs/reskin/TOKEN_MAP.legacy.txt`

App.tsx, only in these regions:
- imports right after `import { Sheet } from './ui/Sheet';`
- reduced-motion code right after the `settings` state
- the JSX from `<MotionConfig …>` through the end of the bottom HUD stack (lines 436-531)
- the `reducedMotion` value passed to the canvas

## Inputs
- `docs/reskin/lucky-ds/` (tokens.json, bundle.css, bundle.js, index.d.ts, component READMEs)
- The director's motion spec, passed in your prompt. Save it as `docs/reskin/MOTION.md`.
- User decisions in `docs/reskin/README.md`.

## Tasks

### 1. Tokens: `src/index.css`
- [ ] Replace the `@theme` block with one **`@theme static`** block. Every variable must be emitted, because JS and the canvas read them.
  - **Surfaces**, named without the DS's `bg-` prefix so the utilities read `bg-sheet`, `bg-panel` and so on: `--color-canvas #030d19`, `--color-sheet #111b2d`, `--color-panel #1a263b`, `--color-well #0e1726`, `--color-tile #0a111c`, `--color-control #1b263e`, `--color-control-hover #232d44`, `--color-lobby #0a1e42`, `--color-lobby-raised #172747`, `--color-lobby-active #142959`, `--color-hero-sky #b0c4f5`, `--color-hero-indigo #4452a8`, `--color-frame #255bd0`, `--color-frame-muted #2d5295`, `--color-line #243149`, `--color-control-ring #667490`.
  - **Text:** `--color-ink #ffffff`, `--color-ink-soft #d8e4f2`, `--color-ink-secondary #bcd1ef`, `--color-ink-muted #9eb4d0`, `--color-ink-faint #61769a`.
  - **Accents:**
    - `--color-lucky #1ef66d`, `--color-lucky-bar #04f233`, `--color-lucky-tint #123326`, `--color-on-lucky #041a0c`
    - `--color-gold #fcbe20`, `--color-gold-bright #fbd50b`, `--color-gold-deep #c37f09`, `--color-on-gold #1b1405`
    - `--color-hot #f80757`, `--color-hot-light #fd3b73`, `--color-on-hot #ffffff`
    - `--color-info #2dbdf1`, `--color-amber #f08204`, `--color-focus #1ef66d`
    - coins: `--color-coin-usd #feb300`, `--color-coin-eur #1d47b9`, `--color-coin-btc #fd9600`, `--color-coin-usdt #02af88`
  - **Roles:** `--color-cta: var(--color-hot)`, `--color-cta-light`, `--color-on-cta`, `--color-brand: var(--color-lucky)`, `--color-premium: var(--color-gold)`, `--color-dir-long: var(--color-lucky)`, `--color-dir-short: var(--color-info)`, `--color-profit: var(--color-lucky)`, `--color-loss: var(--color-amber)`.
  - **Legacy bridge**, marked `/* LEGACY BRIDGE — deleted in E0-final */`:
    - `--color-bnb-yellow: var(--color-gold)`, `--color-bnb-yellow-bright: var(--color-gold-bright)`
    - `--color-long: var(--color-lucky)`, `--color-short: var(--color-amber)`. About 16 of short's 22 uses mean loss; E2 moves the 6 SHORT-direction uses to `dir-short`.
    - `--color-bg-0: var(--color-canvas)`, `--color-bg-1: var(--color-well)`, `--color-panel-soft: var(--color-control)`
    - `--color-text-1: var(--color-ink)`, `--color-text-2: var(--color-ink-secondary)`, `--color-text-3: var(--color-ink-muted)`
    - `--color-panel` and `--color-line` keep their names with the Lucky values.
  - **Type:**
    - `--font-sans: "Figtree", ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif`
    - Legacy: `--font-mono: var(--font-sans)` plus `--font-mono--font-feature-settings: "tnum"`.
    - Lucky styles, each with `--line-height` and `--font-weight` companions (and `--letter-spacing` where the DS has one):
      `display 2.25rem/2.5rem/800/-0.01em`, `amount 1.875rem/2.125rem/700`, `title 1.625rem/1.875rem/700`, `section 1.375rem/1.75rem/600`, `body 1.25rem/1.625rem/500`, `label 1.125rem/1.375rem/600/0.01em`, `caption 1rem/1.25rem/500`, `micro 0.8125rem/1rem/500`, `numeral 1.375rem/1.5rem/800`.
    - Legacy aliases, sized as before so nothing jumps unexpectedly: `--text-hero-price → display`, `--text-screen-title → section`, `--text-cta → label`, `--text-metadata → micro`.
    - Never give a color and a text style the same name. With `--color-X` and `--text-X` both defined, `text-X` becomes a color.
  - **Radius:** `--radius-sm 0.625rem`, `--radius-md 0.875rem`, `--radius-lg 1.25rem`, `--radius-xl 2.25rem`. These override the `rounded-*` keywords on purpose.
  - **Shadows:** `--shadow-glow-lucky: 0 0 0 2px #04f233, 0 0 18px rgb(4 242 51 / .35)`, `--shadow-glow-hot: 0 6px 18px rgb(248 7 87 / .45)`, `--shadow-glow-gold: 0 8px 24px rgb(252 190 32 / .35)`, `--shadow-lift: 0 12px 32px rgb(0 0 0 / .45)`.
- [ ] **`@layer base`:**
  - `:root` variables (`--tap-min`, `--tap-primary`, safe areas).
  - `html, body` flat `background: var(--color-canvas)` (delete the three radial gradients) and `color: var(--color-ink)`.
  - Global focus ring `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }`.
  - `::selection` in lucky / on-lucky, and scrollbar hiding.
  - The reduced-motion rules, under both `@media (prefers-reduced-motion: reduce)` and `:root[data-motion="reduce"]`.
- [ ] **`@layer components`:**
  - `@import "./ui/lucky/lucky.css"`.
  - `.app-frame` gets `contain: layout`, so the existing `fixed` overlays position against the phone frame.
  - `.pad-safe-*` and `.pilot-drawer`.
  - Re-point the legacy classes still in use:
    - `.glass-panel` → panel + line border, no blur
    - `.glow-green` → `var(--shadow-glow-lucky)`
    - `.glow-magenta*` and `.text-glow-*` → `none`
    - `pulseGlow` keyframes animate only a hot `box-shadow`, never `transform` (today it fights motion's inline transforms).
  - Delete the unused classes: `.glow-yellow*`, `.text-glow-yellow`, `.glass-panel-subtle`, `.animate-slide-*`.
- [ ] **Cascade trap:** once `.app-frame` is layered, the `relative` class on the same element (App.tsx:437) wins and collapses the fixed shell. Remove `relative` in the same change.

### 2. Fonts and `index.html`
- [ ] Vendor Figtree:
  - Download the latin variable woff2 (weights 400–900) from Google Fonts into `public/fonts/figtree/`.
  - Add an `@font-face` with `font-display: swap` and `font-weight: 400 900`.
  - Verify the `tnum` feature with fontTools (`python3 -c "from fontTools.ttLib import TTFont; …"`) and note the result in CONTRACTS.md.
- [ ] `index.html`:
  - Remove the Plus Jakarta Sans and JetBrains Mono links and the dead `class="dark"`.
  - Body classes: `bg-canvas text-ink antialiased selection:bg-lucky selection:text-on-lucky`.
  - `theme-color #030d19`.
  - A favicon: a small gold disc SVG in `public/`.

### 3. `src/ui/cn.ts`
- [ ] Use `extendTailwindMerge` and register the text sizes `display, amount, title, section, body, label, caption, micro, numeral` plus the legacy ones, and the shadows `glow-lucky, glow-hot, glow-gold, lift`. By default, tailwind-merge treats `text-micro` as a color and drops it when merged with `text-ink`.

### 4. `src/ui/lucky/`: primitives (typed TSX over `lucky.css`, barrel `index.ts`)
- [ ] **`lucky.css`:** port `lucky-ds/components/bundle.css` inside `@layer components`, keeping the `lg-*` class names.
  - Rename the variables to ours: `--bg-panel` → `--color-panel`, `--glow-hot` → `--shadow-glow-hot`, and so on.
  - Drop the font `@import`, the `body` rule and `.lg-stage*`.
  - Add: disabled hot button, `ghost` button, `md` sizes; tabs `--sheet` and `--sm` variants with a `data-tone` indicator; `.lg-progress--sm`, `.lg-wallet--compact`.
  - New classes: `.lg-pill`, `.lg-dir`, `.lg-stats`, `.lg-stat-tile`, `.lg-switch`, `.lg-disc`, `.lg-stripes`, `.lg-card` (sheet, frame-muted outline, radius-xl, lift), `.lg-sheet`.
- [ ] **Components** (props are a contract; document every one in CONTRACTS.md):

| Export | Props |
|---|---|
| `Icon` | `{name: 'back'\|'grid'\|'plus'\|'minus'\|'check'\|'lock'\|'close'\|'chevron-left'\|'chevron-right'\|'chevron-up'\|'chevron-down'\|'tri-up'\|'tri-down'; size?=24; strokeWidth?=2.4; className?}` |
| `Button`, `buttonClass(variant, size?, block?)` | `ButtonHTMLAttributes & {variant?: 'hot'\|'secondary'\|'icon'\|'arrow'\|'ghost'; size?: 'md'\|'lg'; icon?; block?}`. Use `buttonClass` on a `motion.button`. |
| `Badge` | `{tone?: 'pro'\|'count'\|'check'; label?; children?; className?}` |
| `SheetHeader` | `{title; subtitle?; eyebrow?; onBack?; action?; grabber?=false}`. Sheet already draws the grabber. |
| `Panel` | `{title?; tone?: 'panel'\|'well'; as?; className?; children}` |
| `SegmentedTabs<T>` | `{items: {value: T; label; eyebrow?; icon?; tone?: 'default'\|'long'\|'short'}[]; value?: T\|null; onChange?; surface?: 'lobby'\|'sheet'; size?: 'md'\|'sm'; role?: 'tablist'\|'radiogroup'; ariaLabel}`. `null` means nothing is selected. |
| `ProgressBar` | `{value; max?; next?; label; size?: 'lg'\|'sm'; tone?: 'lucky'\|'gold'}` |
| `RewardTile` | DS props + `className` |
| `WalletRow` | `{icon?: ReactNode\|string; amount; currency?; title?; bonus?; bonusTone?: 'lucky'\|'info'\|'amber'\|'muted'; trailing?; selected?; onSelect?; compact?}` (`role=radio`) |
| `BalanceHeader` | `{brand; word; value; unit?; art?}` |
| `DirectionChip` | `{direction: 'LONG'\|'SHORT'; leverage?; size?: 'sm'\|'md'}`. Renders a tri icon + "LONG · 18x" in the `dir-*` color. |
| `SignedAmount` | `{value; unit?='USDT'; decimals?=2; sign?: 'always'\|'auto'; tone?: 'auto'\|'ink'; className?}`. `auto` tone means profit when ≥0 and loss when <0. |
| `StatTable` | `{rows: {label; value: ReactNode; tone?: 'ink'\|'profit'\|'loss'\|'long'\|'short'\|'muted'}[]}` (`bg-well` rows) |
| `StatTile` | `{value; label; art?; icon?}` |
| `Pill` | `{tone?: 'neutral'\|'lucky'\|'gold'\|'info'\|'amber'\|'long'\|'short'; icon?; dot?: boolean\|'pulse'; size?; children}` |
| `Toggle` | `{checked; onChange(next); label; description?; disabled?}` (`role=switch`, lucky when on) |
| `AssetDisc` | `{symbol; size?=40}`. Uses `btc.png` for BTC; other assets get a flat disc in their `SUPPORTED_ASSETS` color with the initial in ink. |
| `Scrim` | `HTMLMotionProps<'div'> & {tone?: 'dim'\|'game'\|'none'}` |
| `ConfettiLayer`, `useConfetti()` | `burst('connect'\|'win'\|'levelUp'\|'mission', opts?)`. Keep today's particle counts and spreads, use palette colors, do nothing under reduced motion, and pass `disableForReducedMotion`. |

- [ ] **`format.ts`:**
  - `formatAmount(v, unit='USDT', {sign='always', decimals=2})` gives "+2.16 USDT" / "−1.62 USDT". It uses U+2212, rounds before signing, and prints zero without a sign.
  - `formatPrice(v, {unit?, decimals?})` uses fixed `en-US` grouping.
  - Also `formatPct`, `formatMultiplier` ("1.22x"), `formatLeverage` ("18x"), `formatXp`, `formatTimer` ("00:17"), `formatHash`, `signOf`, and the constant `MINUS`.
- [ ] **`palette.ts`:** the single JS source of colors, for the canvas and confetti.
  - Types: `Swatch = {hex: '#rrggbb'; rgb: [r,g,b]; css: 'var(--color-…)'}`.
  - `TOKENS` is keyed by the names above in camelCase; `ROLE` holds `{cta, brand, premium, dirLong, dirShort, profit, loss}`.
  - `CANVAS` roles: `stageTop` (lobby), `stageBottom` (canvas), `grid` (line), `star` (ink), `starTint` (heroSky), `track` (inkSoft), `trackGlow` (frame), `entry` (info), `target` (lucky), `targetZone` (luckyTint), `stop` (amber), `labelBg` (tile), `labelText` (ink), `labelMuted` (inkMuted), `rocketBody` (inkSoft), `rocketTrim` (gold), `flame` [ink, goldBright, gold], `tiers` [gold, lucky, goldBright, ink], `charge` [luckyBar, lucky, ink], `damage` [amber, goldDeep, inkMuted], `coin` (gold), `coinRim` (goldDeep), `coinShine` (goldBright), `boomWin` (lucky), `boomLoss` (amber).
  - `CONFETTI = {connect, win, levelUp, mission}` as hex arrays.
  - Helpers `hexA(c, a)`, `rgba(c, a)`, `mix(a, b, t)`, `FONT_FAMILY`, `canvasFont(weight, px)`.
  - The canvas never gets `hot`, and there is no red anywhere.
- [ ] **`assets.ts`:** `ART` and `CURRENCY` maps: `{src: '/lucky/…', w, h, surface: 'tile'|'hero-sky'|'room'|'any', alt}`. Record the real pixel sizes (for example `coin` 76×78, `reward-crown` 70×60, `usdt` 54×54).
- [ ] **Tests** `src/ui/lucky/*.spec.ts`:
  - `format` cases;
  - `cn('text-micro', 'text-ink')` keeps both classes;
  - palette↔CSS sync: parse `src/index.css` and compare it with `TOKENS`.
- [ ] **`Gallery.tsx`** plus a dev-only `gallery.html` entry at the repo root. It shows every primitive in every state on `bg-sheet` (and tabs on `bg-lobby`), and sets `document.documentElement.dataset.sceneReady = '1'` once `document.fonts.ready` resolves.

### 5. Behavior modules (props unchanged)
- [ ] **`src/ui/motion.ts`:** add `export const useMotionPref = () => !!useReducedMotionConfig();`. Keep `MICRO`, `STANDARD`, `HERO` and the variants exactly.
- [ ] **`Sheet.tsx`:**
  - Scrim: `absolute inset-0 z-40 flex items-end`. The `app` variant is `bg-canvas/60` with no blur. The `game` variant keeps its radial vignette, recolored to rgb(3 13 25).
  - Panel: `.lg-sheet` (`bg-sheet`, `rounded-t-[var(--radius-xl)]`, 1px `frame-muted` border on all sides but the bottom, `lift` shadow, no backdrop blur), full width up to 28rem.
  - Grabber: `.lg-grabber` in a `pt-3 pb-2` strip.
  - Body: bottom padding `calc(var(--sa-bottom) + 12px)`.
  - Keep exactly: 85vh, 120px / 500px/s dismiss, the scroll-top guard, STANDARD in / MICRO out, zIndex 40 dropping to 10, click-outside, the `className` passthrough.
- [ ] **`HoldButton.tsx`:** add the optional prop `variant?: 'bare'|'hot'`. The default `'bare'` renders exactly as today.
  - `hot`:
    - `lg-btn lg-btn-hot` (gradient, `radius-sm`, 20px/800 uppercase, `on-hot` label, glow-hot shadow).
    - Disabled: `bg-control`, `ink-muted`, no glow.
    - The ring defaults to `text-on-hot`; the release burst uses `var(--color-ink)`.
    - The "hold to confirm" hint swaps the label to `HOLD TO CONFIRM` for the existing 1.4s, with an `aria-live` echo. White 13px text on hot is not allowed.
  - `bare`: the hint becomes `text-micro font-semibold uppercase` in Figtree.
  - Replace `useReducedMotion` with `useMotionPref`.
  - Unchanged: 400ms hold, 24px slip tolerance, instant commit for mouse and keyboard, haptics, 1.015 press scale, 320ms burst.

### 6. App shell (App.tsx, in the regions you own only)
- [ ] **Reduced motion:**
  - After the `settings` state: `const osReduced = useReducedMotion(); const reduced = settings.reducedMotion || !!osReduced;`, plus an effect that sets `document.documentElement.dataset.motion = reduced ? 'reduce' : 'full'`.
  - Render `<MotionConfig reducedMotion={reduced ? 'always' : 'never'}>`.
  - Pass `<MarketTrackCanvas reducedMotion={reduced}>`.
- [ ] Frame div: remove `relative`; use `bg-lobby sm:border-x sm:border-frame`.
- [ ] Delete the ambient vignette (line 459). Stage depth now comes from the canvas.
- [ ] Bottom HUD stack (line 484): `px-6` (Lucky screen margin). Children are full width.
- [ ] Inline "Resolving round" (lines 521-529): `role="status" aria-live="polite"`, `text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted`, with a lucky pulsing dot that stops under reduced motion.
- [ ] Mount `<ConfettiLayer/>` inside the frame at `z-[45]`.
- [ ] **Z scale** (write it into CONTRACTS.md): 0 canvas · 15 swipe layer · 20 HUD / PIX / bottom stack · 30 header · 35 outcome banner · 40 sheets / result / settlement · 45 confetti · 50 modal / drawer / toast · 60 dev tools.
- [ ] No logic changes. Don't touch the line right before `return (`, `type ActiveSheet`, or the SimulationBar mount: those belong to E0b.

### 7. Header and SimulationBar
- [ ] **`Header.tsx`:** keep the same elements in the same order (the wallet session will merge into this file later) and change classes only.
  - Wordmark "BNB PLAY" in uppercase 800, with a small gold disc mark between the words.
  - Status dot: lucky with a lucky-tint ring when connected, `control-ring` when not.
  - Menu: `buttonClass('icon', 'md')` + `Icon name="grid"`, 48px.
  - No hot anywhere in the header.
- [ ] **`SimulationBar.tsx`** (dev tool):
  - Lucky surfaces and controls; profit and loss outlines replace the cyan and magenta.
  - No emoji; replace the Indonesian "Untung/Rugi" with "Profit/Loss".
  - z-index 60, props unchanged.

### 8. Docs
- [ ] Rewrite `docs/DESIGN_TOKENS.md` as the Lucky source of truth: tokens, roles, recipes, copy rules and the z scale. Point to `docs/reskin/`.
- [ ] `docs/reskin/TOKEN_MAP.md`: legacy → Lucky mapping, a meaning table (direction / outcome / cta / brand / premium), and the recipes. For example, a label is `text-label uppercase`, and every number is `tabular-nums`.
- [ ] `docs/reskin/TOKEN_MAP.legacy.txt`: one regex per line for the grep gate:
  - `var\(--color-(bnb-yellow(-bright)?|long|short|bg-[01]|panel-soft|text-[123])\)`
  - `--text-(hero-price|screen-title|cta|metadata)`
  - `glass-panel`, `glow-(green|magenta)`, `text-glow-`, `pulse-glow-cta`
  - `rounded-\[var\(--radius`
  - `text-\[color:var\(--color-`
  - `text-\[length:var\(--text-`
- [ ] `docs/reskin/CONTRACTS.md`:
  - every export with its props;
  - the hot-CTA owner per screen: landing E1, home E1, trade setup E2, live E2, result E3 (only when P&L ≥ 0), guest profile E4, none elsewhere;
  - band A (top 0–56px of `#track-stage`, E2's portaled HUD) and band B (`top-16`, PIX);
  - the z scale, the format rules and the `tnum` verification result.
- [ ] `docs/reskin/MOTION.md`: the director's spec, verbatim, plus a short "how to apply it" note.

## Acceptance
- `pnpm typecheck`, `pnpm test` (the existing 12 tests plus the new specs) and a build to a temp directory are all green.
- `getComputedStyle(document.documentElement).getPropertyValue('--color-dir-short')` returns `#2dbdf1`.
- The app runs in the bridged Lucky palette with no layout collapse. Check landing, trade setup, live and result with a quick headless shot of `http://127.0.0.1:5180/`.
- `gallery.html` renders every primitive; it has been shot and self-reviewed against the rubric.
- No network requests go to Plus Jakarta or JetBrains, and `document.fonts.check('800 20px Figtree')` is true.
- The gates in OWNERSHIP.md pass on the files you created (palette.ts and lucky.css are exempt from the hex rule).
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
