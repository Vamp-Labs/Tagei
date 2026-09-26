# BNB PLAY: design tokens (Lucky Games)

This file is the source of truth for BNB PLAY's look.

- **The re-skin program:** [`docs/reskin/`](reskin/README.md). It covers the decisions, the epics and the rubric.
- **The shared primitives and their props:** [`docs/reskin/CONTRACTS.md`](reskin/CONTRACTS.md).
- **The legacy → Lucky mapping:** [`docs/reskin/TOKEN_MAP.md`](reskin/TOKEN_MAP.md).
- **Motion:** [`docs/reskin/MOTION.md`](reskin/MOTION.md).
- **Where the code lives:**
  - Tokens are declared in `src/index.css` (`@theme static`, so every variable is emitted).
  - JavaScript and the canvas read the same values from `src/ui/lucky/palette.ts`. A test (`src/ui/lucky/palette.spec.ts`) keeps the two in sync.

## Surfaces: the ladder

`canvas → sheet → panel → well → tile`. Every step inward is darker, never lighter.

| Token | Value | Utility | Use |
|---|---|---|---|
| `canvas` | #030d19 | `bg-canvas` | Page background behind the frame |
| `sheet` | #111b2d | `bg-sheet` | Bottom sheets, result card, modals (`.lg-sheet`, `.lg-card`) |
| `panel` | #1a263b | `bg-panel` | Grouped sections on a sheet (`Panel`) |
| `well` | #0e1726 | `bg-well` | Rows inset in a panel (`StatTable`, `WalletRow`, `Toggle`) |
| `tile` | #0a111c | `bg-tile` | Tiles and progress tracks, the darkest inset |
| `control` / `control-hover` | #1b263e / #232d44 | `bg-control` | Secondary buttons, icon discs |
| `lobby` / `lobby-raised` / `lobby-active` | #0a1e42 / #172747 / #142959 | `bg-lobby` | The track stage and the frame only |
| `hero-sky` / `hero-indigo` | #b0c4f5 / #4452a8 | | The hero art stage |
| `frame` / `frame-muted` | #255bd0 / #2d5295 | `border-frame` | The 1px outline of the app frame and of sheets |
| `line` | #243149 | `border-line` | Hairlines |
| `control-ring` | #667490 | | Unselected radios, the offline status dot |

## Text

| Token | Value | Use |
|---|---|---|
| `ink` | #ffffff | Headings, values |
| `ink-soft` | #d8e4f2 | Sub-titles |
| `ink-secondary` | #bcd1ef | Secondary button labels, tab labels |
| `ink-muted` | #9eb4d0 | Meta, timers, labels |
| `ink-faint` | #61769a | Only at 20px and up, and only for information that repeats nearby |

## Accents and roles

Each accent has exactly one job. Always use the role name in feature code.

| Role | Maps to | Rule |
|---|---|---|
| `cta` | `hot` #f80757, gradient `hot-light` → `hot` | One hot element per screen, count badges aside. White label only when bold and at least 19px. |
| `brand` | `lucky` #1ef66d | The brand word in two-tone headings |
| `dir-long` | `lucky` + the tri-up icon | Direction only |
| `dir-short` | `info` #2dbdf1 + the tri-down icon | Direction only. Never an outcome colour. |
| `profit` | `lucky` + a sign | Gains |
| `loss` | `amber` #f08204 + a sign | Calm, not punitive. There is no red anywhere. |
| `premium` | `gold` #fcbe20 | The BNB coin, level-up and Pro. Gold means nothing else. |
| `focus` | `lucky` | A 2px ring with a 2px offset, applied globally with `:focus-visible` |

Supporting tokens:
- `lucky-bar` #04f233 is for progress fills, the selected glow and check badges.
- `lucky-tint` #123326 is the selected-row wash.
- `on-lucky`, `on-gold` and `on-hot` are the label colours on those fills.
- `coin-usd`, `coin-eur`, `coin-btc` and `coin-usdt` are the currency discs.

## Type

The only family is Figtree (variable 400–900), vendored at `public/fonts/figtree/`. It has tabular figures and the U+2212 minus. It has no triangle glyphs, so draw direction triangles with `<Icon name="tri-up|tri-down">`.

| Utility | Size / line / weight | Use |
|---|---|---|
| `text-display` | 36 / 40 / 800, −0.01em | Screen hero numbers and titles |
| `text-amount` | 30 / 34 / 700 | Balances and P&L |
| `text-title` | 26 / 30 / 700 | Sheet titles |
| `text-section` | 22 / 28 / 600 | Panel titles |
| `text-body` | 20 / 26 / 500 | Helper lines |
| `text-label` | 18 / 22 / 600, 0.01em | Uppercase labels, tabs; the hot CTA at 800 |
| `text-caption` | 16 / 20 / 500 | Sub-lines |
| `text-micro` | 13 / 16 / 500 | The smallest text allowed |
| `text-numeral` | 22 / 24 / 800 | Badge and ring numbers |

Every number gets `tabular-nums`. Nothing is smaller than 13px.

## Shape, depth, texture

- **Radius:**
  - `rounded-sm` 10: the CTA and pills.
  - `rounded-md` 14: tiles and rows.
  - `rounded-lg` 20: panels and cards.
  - `rounded-xl` 36: sheets and the frame.
  - `rounded-full`: discs and badges.
  - These override Tailwind's keywords on purpose.
- **Shadows:**
  - `shadow-glow-lucky`: the selected tile or row, and the win badge.
  - `shadow-glow-hot`: the CTA and count badges.
  - `shadow-glow-gold`: coins, Pro and the level-up flash.
  - `shadow-lift`: sheets, the hero card and the result card.
  - No other glows, and never on text.
- **Texture:**
  - Faint 135° stripes (`.lg-stripes`) go only on tiles and progress fills.
  - The only UI gradient is the hot CTA or badge. The canvas world is exempt.

## Copy

- **The hot CTA** is UPPERCASE and ends with one "!". No other text uses "!".
- **Casing:** labels are UPPERCASE, titles are Title Case, and status sub-lines are lowercase.
- **Amounts** come from `formatAmount` / `formatPrice` in `src/ui/lucky/format.ts`: "+2.16 USDT", "−1.62 USDT". The code goes after the number, the minus is the true minus sign, and there is no "$".
- **After a loss,** the copy is calm sentence case. No pressure to replay.
- **No emoji, dingbats or text-art faces** in the UI. Use `Icon` or the Lucky art.

## Z scale

| z | Layer |
|---|---|
| 0 | canvas |
| 15 | track swipe layer |
| 20 | HUD, PIX, bottom stack |
| 30 | header |
| 35 | outcome banner |
| 40 | sheets, result, settlement |
| 45 | confetti (`ConfettiLayer`) |
| 50 | modal, drawer, toast |
| 60 | dev tools (SimulationBar) |

`.app-frame` has `contain: layout`, so `fixed` overlays position against the phone frame rather than the browser window.
