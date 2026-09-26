# E0a contracts

These are the shared primitives the feature epics build from.

- **Where the code lives:**
  - Everything below is exported from `src/ui/lucky/index.ts`, and a direct file import works too.
  - The behaviour modules sit beside it in `src/ui/`.
- **Stability:**
  - The props are a contract. After gate G0 they are frozen, and optional props can be added only through an E0a integration request.
  - Every primitive takes an optional `className` unless noted. `cn()` merges it, so a later utility wins.
- **Seeing them:** `gallery.html` (dev only, `http://127.0.0.1:<port>/gallery.html`) renders every primitive in every state.

## Primitives (`src/ui/lucky/`)

| Export | Props | Notes |
|---|---|---|
| `Icon` | `{name: IconName; size?=24; strokeWidth?=2.4; className?}` | Names: `back`, `grid`, `plus`, `minus`, `check`, `lock`, `close`, `chevron-left`, `chevron-right`, `chevron-up`, `chevron-down`, `tri-up`, `tri-down`, `arrow-right`, `send`, `search`, `home`, `external`, `shield-check`, `bolt`, `key`, `broadcast`, `clock`, `rocket`. The icon uses `currentColor` and is `aria-hidden`. The tri icons are filled. |
| `Button` | `ButtonHTMLAttributes & {variant?: 'hot'\|'secondary'\|'icon'\|'arrow'\|'ghost' = 'secondary'; size?: 'md'\|'lg' = 'lg'; icon?: IconName \| ReactElement; block?}` | It forwards a ref and defaults to `type="button"`. `icon` and `arrow` render the glyph only, so pass an `aria-label`. `hot` is uppercase 20/800 (19 at md). |
| `buttonClass(variant, size?, block?)` | returns a class string | Use it on `motion.button` or any other element that needs the button look. |
| `Badge` | `{tone: 'check'; label?; className?}` \| `{tone?: 'pro'\|'count' = 'count'; label?; children; className?}` | `check` is `role="img"` with `aria-label={label ?? 'Claimed'}`. On `count`/`pro`, a `label` renders as an `sr-only` span and the visible children become `aria-hidden`. |
| `SheetHeader` | `{title; subtitle?; eyebrow?; onBack?; action?; grabber?=false; className?}` | `Sheet` already draws the grabber, so leave `grabber` off inside a Sheet. The title renders as `h2`. `onBack` renders a 48px back disc. |
| `Panel` | `{title?; tone?: 'panel'\|'well' = 'panel'; as?: 'section'\|'div'\|'article'\|'aside' = 'section'; className?; children}` | The title renders as `h3`. |
| `SegmentedTabs<T extends string>` | `{items: {value: T; label; eyebrow?; icon?; tone?: 'default'\|'long'\|'short'}[]; value?: T\|null; onChange?(v: T); surface?: 'lobby'\|'sheet' = 'lobby'; size?: 'md'\|'sm' = 'md'; role?: 'tablist'\|'radiogroup' = 'tablist'; ariaLabel; className?}` | See the notes below the table. |
| `ProgressBar` | `{value; max?=100; next?; label; size?: 'lg'\|'sm' = 'lg'; tone?: 'lucky'\|'gold' = 'lucky'; className?}` | `role="progressbar"` with values clamped. The fill is a `width` (existing XP-bar exception, see MOTION §6). |
| `RewardTile` | DS props `{state?: 'default'\|'claimed'\|'selected'\|'locked'\|'pro'; art?; name?; timer?; progress?; progressTone?: 'amber'\|'lucky'; label?; onClick?} + className` | The tile is 100% wide, up to 112px, so three fit a 390px panel. With `onClick` it is a `button` with `aria-pressed`; without it, a display-only `div role="img"` labelled `label ?? name ?? state` (no tab stop). |
| `WalletRow` | `HTMLAttributes<HTMLElement> & {icon?: ReactNode; iconSrc?: string; amount; currency?; title?; bonus?; bonusTone?: 'lucky'\|'info'\|'amber'\|'muted' = 'lucky'; trailing?; selected?; onSelect?; compact?; mode?: 'radio'\|'button'\|'static' = 'radio'; disabled?; className?}` | It forwards a ref and spreads the rest (`tabIndex`, `onKeyDown`, `aria-*`) onto the root. `radio` (default) is a `button role="radio"` with `aria-checked` and the corner radio, so wrap the list in `role="radiogroup"`. `button` is a plain button with no role or radio. `static` is a `div` with no role, no `aria-checked` and no radio. `iconSrc` renders an `<img>`; `icon` renders as is (for example `<AssetDisc/>`). `trailing` sits before the corner radio. |
| `BalanceHeader` | `{brand; word; value; unit?; art?; className?}` | Two-tone name, value under a coin. |
| `DirectionChip` | `{direction: 'LONG'\|'SHORT'; leverage?; size?: 'sm'\|'md' = 'md'; className?}` | Renders the tri icon and "LONG · 18x" in `dir-long` / `dir-short`. The leverage keeps its lowercase x. |
| `SignedAmount` | `{value; unit?: string\|null = 'USDT'; decimals?=2; sign?: 'always'\|'auto' = 'always'; tone?: 'auto'\|'ink' = 'auto'; className?}` | `auto` tone is `profit` when the rounded value is ≥ 0 and `loss` when it is < 0. It always renders `tabular-nums`. |
| `StatTable` | `{rows: {label; value: ReactNode; tone?: 'ink'\|'profit'\|'loss'\|'long'\|'short'\|'muted'}[]; className?}` | A `dl` of `bg-well` rows. |
| `StatTile` | `{value; label; art?; icon?; className?}` | Lay them out in `<div className="lg-stats">`, a 3-column grid. |
| `Pill` | `{tone?: 'neutral'\|'lucky'\|'gold'\|'info'\|'amber'\|'long'\|'short' = 'neutral'; icon?; dot?: boolean\|'pulse'; size?: 'sm'\|'md' = 'md'; className?; children}` | `dot="pulse"` is the live dot, one of the three allowed loops. Its ripple is transform and opacity only, and it ends solid under reduced motion. |
| `Toggle` | `{checked; onChange(next: boolean); label; description?; disabled?; className?}` | A full-width row button with `role="switch"`. It turns lucky when on. |
| `AssetDisc` | `{symbol: AssetSymbol; size?=40; className?}` | BTC uses `currency/btc.png`. BNB is a `gold` disc. The other assets get a neutral `control` disc with an `ink-secondary` initial (brand colours would collide with lucky and gold). |
| `Scrim` | `HTMLMotionProps<'div'> & {tone?: 'dim'\|'game'\|'none' = 'dim'}` | `dim` is `canvas` at 60% with no blur. `game` is the bottom radial vignette. It forwards a ref. |
| `ConfettiLayer` | `{className?}` | Mounted once by App.tsx inside the frame at `z-[45]`. Don't mount another. |
| `useConfetti()` | returns `{burst(kind: 'connect'\|'win'\|'levelUp'\|'mission', opts?)}` | See the notes below the table. |
| `CONFETTI_PRESETS` | `Record<kind, Options>` | Read-only reference. |

**`SegmentedTabs`:**
- `value === undefined` makes the component uncontrolled, starting on the first item. `null` means controlled with nothing selected.
- Arrow keys move the selection with a roving tabindex.
- On `sheet`, the selected tone is lucky by default, `dir-long` for `long` and `dir-short` for `short`. On `lobby`, the indicator is `gold-bright`, as in the DS.
- Labels are uppercased. Wrap a value in `<span className="normal-case">18x</span>` to keep it lowercase.

**`useConfetti()`:**
- Today's particle counts, spreads and origins are kept, with palette colours.
- `opts` overrides any `canvas-confetti` option except `colors`.
- `burst` is a **no-op** in any of these cases:
  - `useMotionPref()` is true;
  - `<html data-motion="reduce">` is set;
  - `document.documentElement.dataset.sceneFreeze === '1'` (the E0b contract);
  - `dataset.sceneFx === '0'`.
- It also passes `disableForReducedMotion`.
- Per MOTION.md §4, E3 fires `win` on a target hit and `levelUp` on a level-up only. Cash-out, timeout, mission and loss get none.

## Data modules

| Export | Shape |
|---|---|
| `format.ts` | `MINUS` (U+2212) · `formatAmount(v, unit='USDT', {sign='always'\|'auto'\|'never', decimals=2})` gives "+2.16 USDT" / "−1.62 USDT" · `formatPrice(v, {unit?, decimals?})` uses en-US grouping, 2 decimals, or 4 below 1 · `formatPct(v, {sign, decimals})` gives "+1.20%" · `formatMultiplier(v, decimals=2)` gives "1.22x" · `formatLeverage(v)` gives "18x" · `formatXp(v, {sign='auto'})` gives "720 XP" / "+50 XP" · `formatTimer(seconds)` gives "00:17" or "20:08:24" · `formatHash(h, head=6, tail=4)` gives "0x12ab…9f3c" · `signOf(v, decimals=2)` |
| `palette.ts` | `Swatch = {hex; rgb; css}` · `TOKENS` (camelCase, one per `--color-*` hex in index.css) · `ROLE {cta, brand, premium, dirLong, dirShort, profit, loss}` · `CANVAS` (stage, grid, star, track, entry (`ink-soft`) and entryRing (`control-ring`), neutral so blue only means SHORT, target, stop, label, rocket, flame, tiers, charge, damage, coin, boom roles) · `CONFETTI {connect, win, levelUp, mission}` as hex arrays · `hexA(c, a)`, `rgba(c, a)`, `mix(a, b, t)`, `luminance(c)`, `readableInk(bg)` · `FONT_FAMILY`, `canvasFont(weight, px)` |
| `assets.ts` | `ART` and `CURRENCY`: `{src, w, h, surface: 'tile'\|'hero-sky'\|'room'\|'lobby'\|'any', alt}` at their real pixel sizes. Examples: `coin` 76×78, `reward-crown` 70×60, `hero-bomb` 220×230, `room-*` 165×116, currency 54×54. `avatar` and `clover-mark` were cropped on `lobby`. Never use `hero-bomb` in a loss state. |

**Format rules:**
- The currency code goes after the amount.
- Values are rounded before the sign is chosen, so a value that rounds to zero prints with no sign ("0.00 USDT").
- The minus is the true U+2212.
- There is no "$".
- Every number renders with `tabular-nums`.

**`palette.ts`:**
- It is the only JavaScript source of colour. A test fails if it drifts from `src/index.css`.
- `CANVAS` and `CONFETTI` never contain `hot`. There is no red anywhere.

## Behaviour modules (`src/ui/`)

| Export | Contract |
|---|---|
| `motion.ts` | `MICRO`, `STANDARD`, `HERO`, `EASE_OUT`, `POP_EASE` [0.34,1.56,0.64,1] and `POP` (`{duration: 0.32, ease: POP_EASE}`), `scrimVariants`, `cardVariants`, `staggerVariants`, `staggerChildVariants`, `DISMISS_OFFSET` (120), `DISMISS_VELOCITY` (500), all unchanged · `useMotionPref()` returns `!!useReducedMotionConfig()`: use it everywhere instead of `useReducedMotion()` · `usePrefersReducedMotion()` is the OS query, read once by App.tsx and not needed in features |
| `cn.ts` | `cn(...classes)` is `tailwind-merge` extended with the Lucky text sizes and shadows, so `cn('text-micro', 'text-ink')` keeps both |
| `Sheet` | `{onClose; children; className?; variant?: 'game'\|'app' = 'app'}`, unchanged. The panel is `.lg-sheet`, full width up to 28rem, flush with the bottom, with 85vh max height. It dismisses at 120px or 500px/s, has the scroll-top guard, uses STANDARD in and MICRO out, and drops its z from 40 to 10 on exit. The body pads `calc(var(--sa-bottom) + 12px)`. |
| `HoldButton` | The existing props plus `variant?: 'bare'\|'hot' = 'bare'`. `bare` renders as before, with a 13px Figtree hint. `hot` renders the Lucky hot CTA (full width, 52px; override the height with a utility). When disabled it uses `bg-control` and `ink-muted` with no glow. The ring defaults to `on-hot`, and the hint swaps the label to "HOLD TO CONFIRM" for 1.4s with an `aria-live` echo. The 400ms hold, 24px slip, 320ms burst and 1.015 scale are unchanged. The ring's visibility is a MotionValue, so it shows while holding without any caller override (the `[&>svg>rect]:!opacity-100` workaround is now redundant but harmless). |

## Hot-CTA owner per screen

Exactly one hot element per screen, count badges aside.

| Screen | Owner | Hot element |
|---|---|---|
| Landing (01) | E1 | "CONNECT WALLET!" |
| Home (02) | E1 | "PLAY NOW!" |
| Trade setup (08) | E2 | "HOLD TO LAUNCH!" (`HoldButton variant="hot"`), actionable only with a direction |
| Live (09) | E2 | "HOLD TO CASH OUT!" |
| Result (13, 13c, 13d, 13e) | E3 | "TRADE AGAIN!", **only when P&L ≥ 0**. After a loss it is secondary "Trade again" plus a ghost "Review round". |
| Guest profile (05b) | E4 | "CONNECT WALLET!" |
| Everything else | none | Header, menu, settings, PIX, sheets, outcome banners and settlement carry no hot element. |

## Layout bands on the track stage

- **Band A:** the top 0–56px of `#track-stage`. E2's live HUD (asset pill, timer) is portaled here.
- **Band B:** `top-16` (64px) and down. The PIX companion and its bubble live here. Nothing else goes in band A or band B.
- **Bottom stack:** App.tsx, `px-6` (the Lucky screen margin), `z-20`. Children are full width.

## Z scale

0 canvas · 15 swipe layer · 20 HUD / PIX / bottom stack · 30 header · 35 outcome banner · 40 sheets / result / settlement · 45 confetti · 50 modal / drawer / toast · 60 dev tools.

`.app-frame` is `position: fixed` with `contain: layout`, so `fixed` descendants position against the frame. The frame must not carry `relative`: that class wins over the layered `.app-frame` and collapses the shell.

## Fonts: `tnum` verification

- **The file:** `public/fonts/figtree/figtree-latin-var.woff2`, the Google Fonts v9 latin subset, about 20 KB. It is a variable font with a `wght` axis from 300 to 900.
- **The check:** run with fontTools 4.63.0, `python3 -c "from fontTools.ttLib import TTFont; f = TTFont('public/fonts/figtree/figtree-latin-var.woff2'); …"`.
- **GSUB features:** `ccmp`, `dnom`, `frac`, `locl`, `numr`, `pnum`, `rvrn`, `tnum`.
- **`tnum`:** it maps `zero`–`nine` to `zero.tf`–`nine.tf`. Every `.tf` glyph is 620 units wide, against proportional widths of 410–638. **Tabular figures are verified.**
- **Characters:**
  - U+2212 (minus) and U+002B (plus) are both 620 units, so signed numbers stay aligned.
  - U+00B7 (middle dot), U+2191 and U+2193 are present.
  - U+25B2 and U+25BC (the triangles) are **absent**. Use `Icon name="tri-up|tri-down"`.
- **Live check:** `document.fonts.check('800 20px Figtree')` returned `true` on `/` and `/gallery.html`. No request went to Google Fonts, Plus Jakarta or JetBrains.
