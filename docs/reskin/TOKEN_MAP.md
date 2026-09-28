# Token map: legacy Tagei → Lucky Games

E0a keeps every legacy token alive through a **bridge**: blocks marked `LEGACY BRIDGE — deleted in E0-final` in `src/index.css`. The whole app therefore re-tints the moment E0a lands, and nothing breaks.

Feature epics (E1–E6) must move their files off the left-hand column. The grep gate `rg -n -f docs/reskin/TOKEN_MAP.legacy.txt <your files>` must print nothing. E0-final deletes the bridge once a repo-wide grep is clean.

## Colours

| Legacy | Bridged to | Replace with | Note |
|---|---|---|---|
| `var(--color-bnb-yellow)` | `gold` | `premium` for BNB, level-up and Pro; `cta` (hot) for the one primary button; `lucky` for brand | The old yellow did three jobs; pick the one you mean |
| `var(--color-bnb-yellow-bright)` | `gold-bright` | `gold-bright` (tab eyebrow only) or `premium` | |
| `var(--color-long)` | `lucky` | `dir-long` for direction, `profit` for gains | |
| `var(--color-short)` | `amber` | `loss` for losses (about 16 of 22 uses); `dir-short` (info) for the SHORT direction (about 6 uses, owned by E2) | The bridge picks amber because most uses mean loss |
| `var(--color-profit)` / `var(--color-loss)` | `lucky` / `amber` | same names, now roles | |
| `var(--color-bg-0)` | `canvas` | `bg-canvas` | |
| `var(--color-bg-1)` | `well` | `bg-well` | |
| `var(--color-panel)` | `panel` (now opaque #1a263b) | `bg-panel` | The name is unchanged, the value is Lucky |
| `var(--color-panel-soft)` | `control` | `bg-control` for controls, `bg-well` for rows | |
| `var(--color-line)` | `line` #243149 | `border-line` | The name is unchanged |
| `var(--color-text-1)` | `ink` | `text-ink` | |
| `var(--color-text-2)` | `ink-secondary` | `text-ink-secondary`, or `text-ink-soft` for sub-titles | |
| `var(--color-text-3)` | `ink-muted` | `text-ink-muted` | |
| raw `#00F0FF`, `#00FFA3`, `#FF0055`, `#F0B90B`, `bg-white/5`, `text-gray-*` | nothing | a Lucky token | The gate rejects raw colours and grey or white utilities |

## Type

| Legacy | Bridged to | Replace with |
|---|---|---|
| `text-[length:var(--text-hero-price)]` | `display` (36) | `text-display` or `text-amount` |
| `text-[length:var(--text-screen-title)]` | `section` (22) | `text-title` for sheet titles, `text-section` for panel titles |
| `text-[length:var(--text-cta)]` | `label` (18) | `buttonClass('hot')` (20/800), or `text-label` |
| `text-[length:var(--text-metadata)]` | `micro` (13) | `text-micro` or `text-caption` |
| `text-[length:var(--text-body)]` | **now 20px** (was 16) | `text-caption` (16) keeps the old size; `text-body` is the Lucky 20 |
| `text-[length:var(--text-micro)]` | **now 13px** (was 11) | `text-micro` |
| `font-mono` | Figtree with `tnum` | `tabular-nums` |
| `text-[9px]` … `text-[12px]`, `text-xs` | nothing | `text-micro` is the floor |

The legacy aliases `--text-hero-price`, `--text-screen-title`, `--text-cta` and `--text-metadata` are plain `:root` variables, not theme entries. `--color-cta` exists, so a `text-cta` utility must stay a colour utility.

## Classes

| Legacy | Now | Replace with |
|---|---|---|
| `.glass-panel` | panel + line border, no blur | `Panel`, `.lg-card` or `.lg-sheet` |
| `.glow-green` | `var(--shadow-glow-lucky)` | `shadow-glow-lucky` (selected or win only) |
| `.glow-magenta`, `.glow-magenta-sm` | `none` | delete |
| `.text-glow-green`, `.text-glow-magenta` | `none` | delete; no text glows |
| `.pulse-glow-cta` | the hot `box-shadow` pulse, ×1 | `lg-pulse-hot` |
| `.glow-yellow*`, `.text-glow-yellow`, `.glass-panel-subtle`, `.animate-slide-*` | deleted (unused) | |
| `rounded-[var(--radius-*)]` | same values | `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl` |
| `text-[color:var(--color-*)]`, `bg-[color:var(--color-*)]` | still works | `text-ink`, `bg-panel` and the other plain utilities |
| `backdrop-blur-*` on chrome | still works | remove; Lucky is flat |

## Meaning table

| Meaning | Token | Never |
|---|---|---|
| Direction LONG | `dir-long` + tri-up `Icon` (`DirectionChip`) | profit or loss colours for direction |
| Direction SHORT | `dir-short` (info) + tri-down `Icon` | amber or red |
| Outcome gain | `profit` + "+" (`SignedAmount`) | |
| Outcome loss | `loss` (amber) + "−" | red, shake, pulse, confetti |
| The one action | `cta` (hot gradient), `buttonClass('hot')` / `HoldButton variant="hot"` | a second hot element on the same screen |
| Brand word | `brand` (lucky) | |
| BNB coin, level-up, Pro | `premium` (gold) | any other highlight |
| Selected | `glow-lucky` (tiles) or `lucky-tint` wash + check (rows) | gold |

## Recipes

- **Label:** `text-label uppercase` (tabs add `tracking-[0.01em]`, which is built in).
- **Status sub-line:** `text-micro font-semibold uppercase tracking-[0.08em] text-ink-muted`, or lowercase `text-caption text-ink-soft`.
- **Every number:** `tabular-nums`, formatted with `format.ts`.
- **Two-tone heading:** `<h2 className="text-title"><span className="text-brand">Lucky</span> Word</h2>`.
- **Hot CTA:** `<Button variant="hot" block>PLAY NOW!</Button>`, or `<HoldButton variant="hot">HOLD TO LAUNCH!</HoldButton>`.
- **Secondary action:** `<Button variant="secondary" size="md">Trade again</Button>`. A text link: `<Button variant="ghost">Review round</Button>`.
- **Sheet body:** `Sheet` → `SheetHeader` → `Panel` stack with `gap-3`, screen margin `px-6`.
- **Stats:** `StatTable` rows (`bg-well`) or `.lg-stats` + `StatTile`.
- **Live dot:** `<Pill tone="lucky" dot="pulse">live</Pill>`.
