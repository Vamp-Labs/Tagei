Lucky Games is a mobile casino-lobby UI: dark navy sheets, one electric green that means *luck and progress*, gold for premium, and hot pink-red for the single thing to tap. Glossy 3D illustrations carry the personality; the chrome around them stays flat and quiet.

## Content fundamentals

- Short, playful, game-show labels. The main action shouts: **FREE PLAY!** — uppercase, one exclamation mark, nowhere else.
- Tabs and wordmarks are UPPERCASE single words (ROULETTE, CASINO, OPENCASE, LUCKY GAMES). Titles are Title Case (Win Gallery, Bonus Level). Status and helper lines are lowercase or sentence case ("status: basic", "Until your next reward").
- Two-tone headings: the brand word in `lucky`, the rest in `ink` — "**Lucky** Tokkens", "User's **ROOMS**" (small `lucky` eyebrow over a big `ink` word).
- Numbers are exact and unrounded: `3.420 USD`, `0.989220 BTC`, `2678 / 3000`, timers as `20:08:24`. Use the currency code after the amount.
- No emoji in UI copy; the 3D art already does that job.

## Visual foundations

- **Color.** Only one theme: dark. `bg-canvas` behind everything, `bg-sheet` for a screen, `bg-panel` for grouped sections, then darker insets `bg-well` (rows) and `bg-tile` (tiles, tracks). The games lobby uses its own blue family: `lobby`, `lobby-raised`, `lobby-active`, with `hero-sky` / `hero-indigo` in the carousel.
- **Accents have one job each.** `lucky` / `lucky-bar`: brand, progress, selected, claimed. `gold`: Pro and VIP. `hot`: the one CTA and count badges. `info`: secondary bonus lines. `amber`: partial progress on locked items. Don't swap them.
- **Text.** `ink` for headings and values; `ink-soft` for sub-titles; `ink-muted` for meta and timers; `ink-secondary` for secondary button labels. `ink-faint` is the source's helper-line color and only reaches 3.3:1 on `bg-panel` — keep it to 20px+ copy that repeats nearby information.
- **Type.** One rounded geometric sans (`sans`, Figtree as a stand-in) in heavy weights: `display` 36/40 800, `amount` 30/34, `title` 26/30, `section` 22/28, `body` 20/26, `label` 18/22 uppercase, `caption` 16/20, `micro` 13/16, `numeral` 22 800 with tabular figures.
- **Shape.** Generous rounding: `radius-md` tiles and rows, `radius-lg` panels and cards, `radius-xl` for the app frame and sheets, `radius-full` for icon buttons, badges and discs. Frames get a 1px `frame` / `frame-muted` outline.
- **Depth.** Mostly flat. Glows are reserved: `glow-lucky` on the selected tile, `glow-hot` under the CTA and badges, `glow-gold` on coins and Pro. `lift` only for sheets and the hero card.
- **Texture.** Tiles and the progress fill carry faint 135° diagonal stripes; the hot CTA and count badge use a `hot-light` → `hot` gradient. No other gradients.
- **Spacing.** `space-5` screen margins, `space-3` between panels and at panel edges, `space-2` between tiles and rows, `space-4` inside rows.
- **States.** Selected = `lucky-bar` border glow (tiles) or `lucky-tint` wash plus filled check (rows). Claimed = green check badge. Locked = silver art plus a progress stripe. Focus = 2px solid `focus` ring, 2px offset, on every surface.

## Iconography

- UI glyphs are simple rounded strokes (2.4px on a 24 grid): back arrow, chevrons, 3×3 menu grid, plus, check. The bundle's `Icon` draws them; they're stand-ins, since the source's icon set isn't known.
- Everything with personality is a 3D illustration (see the Illustrations group): crowns, gifts, clovers, bombs, coins. Currency discs are in the Currency group.
