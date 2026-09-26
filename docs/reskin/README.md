# BNB PLAY → Lucky Games re-skin

This re-skin rebuilds every BNB PLAY screen in the **Lucky Games** design system: dark navy surfaces, one lucky green, and a single hot button per screen. Parallel agents do the work, and each one owns a separate slice of the app.

- **Design system:** https://claude.ai/artifact/TzSE6W1gGY81UCvB7iHCbT. A local copy lives in [`lucky-ds/`](lucky-ds/):
  - `README.md` (brand book) and `tokens.json`;
  - `components/bundle.css`, `bundle.js` and `index.d.ts`;
  - a `README.md` and `preview.html` for each component.
- **Art:** `public/lucky/illustrations/*.png` (14 files) and `public/lucky/currency/*.png` (4 files).
  - They are roughly 1x crops from a reference screenshot, 42–220 px. Display them at or below native size and expect some softness on 3x screens. They are placeholders; replace them before a public launch.
  - Each crop keeps its original background (`bg-tile` for rewards, `hero-sky` for the hero, room gradients), so place it on that surface.
  - Never use `hero-bomb` in a loss state. The PRD bans explosion imagery there.
- **Before-shots:** `screenshots/mobile/`. Never overwrite them.
- **After-shots:** `screenshots/lucky/`, same names, written at wrap-up.

## Decisions (locked with the product owner)

| Role | Token | Rule |
|---|---|---|
| The one CTA per screen | `cta` = `hot` gradient (`hot-light`→`hot`) | Exactly one hot element per screen, count badges aside. White label only when bold and at least 19px. |
| Brand | `brand` = `lucky` | Two-tone headings: the brand word is `lucky`, the rest `ink`. |
| LONG | `dir-long` = `lucky` + ▲ icon | Direction colors are only for direction. |
| SHORT | `dir-short` = `info` #2dbdf1 + ▼ icon | Never borrows an outcome color. |
| Profit / win | `profit` = `lucky` + sign | |
| Loss | `loss` = `red` #ff3b30 + sign + text (user decision, 2026-09-27) | Still calm copy, not punitive (PRD §22-24); never colour alone (PRD §35). Amber stays for partial-progress only. |
| BNB coin, level-up, Pro | `premium` = `gold` | Gold means nothing else. |

- **Scope:** rebuild each screen from Lucky parts wherever the job matches.
  - Flows, state, props, gestures and timings stay unchanged.
  - Exports, `*Props` interfaces, file names and data arrays (`rows`, `LEVERAGE_OPTIONS`, settings rows) stay stable, because the web-UI agent A6 edits these files next.
- **Art:** reuse the 18 Lucky PNGs where they fit. The canvas rocket stays code-drawn and gets recolored. No new raster art.
- **Copy:** Lucky voice. Details under Copy rules below.

## Defaults (chosen by the orchestrator)

- **Home CTA:** a hot "PLAY NOW!" button that opens the trade sheet (`onOpenTradeSheet`).
- **After a loss:** a secondary "Trade again" button with no pulse, plus a "Review round" link. After a win or a profitable cash-out, a hot "TRADE AGAIN!".
- **Profile stats:** the invented numbers ("68%", "2.84x") are replaced with real progression values: streak, rounds today, level.
- **Header wordmark:** "BNB PLAY" with a small gold BNB disc. Lucky's clover logo is not used.
- **PIX's face:** a simple SVG face in a disc with a mood ring, drawn in code.
- **Canvas:** the idle track line is `ink-soft`.
- **Font:** Figtree is vendored as woff2 under `public/fonts/`. It has tabular figures (`tnum`) and U+2212 but no ▲/▼, so draw those as SVG `Icon`s.

## Epics

| Epic | Doc | Branch | Worktree (`Tagei-worktrees/…`) | Port | Status |
|---|---|---|---|---|---|
| E0a Foundation: look | [E0a-foundation-look.md](E0a-foundation-look.md) | `feat/lucky-reskin` | `reskin-integrate` | 5180 | done (G0 passed) |
| E0b Foundation: tooling | [E0b-foundation-tooling.md](E0b-foundation-tooling.md) | `reskin/e0b-tooling` | `reskin-e0b` | 5188 | done (G0 passed) |
| E1 Home & Landing | [E1-home.md](E1-home.md) | `reskin/e1-home` | `reskin-e1` | 5181 | done (merged) |
| E2 Trade flow | [E2-trade.md](E2-trade.md) | `reskin/e2-trade` | `reskin-e2` | 5182 | done (merged) |
| E3 Outcome, settlement, result | [E3-outcome.md](E3-outcome.md) | `reskin/e3-outcome` | `reskin-e3` | 5183 | done (merged) |
| E4 Menu, profile, settings | [E4-account.md](E4-account.md) | `reskin/e4-account` | `reskin-e4` | 5184 | done (merged) |
| E5 PIX | [E5-pix.md](E5-pix.md) | `reskin/e5-pix` | `reskin-e5` | 5185 | done (merged) |
| E6 Canvas world | [E6-canvas.md](E6-canvas.md) | `reskin/e6-canvas` | `reskin-e6` | 5186 | done (merged) |
| Integration + QA | this file, `INTEGRATION_LOG.md`, `QA.md` | `feat/lucky-reskin` | `reskin-integrate` | 5187 | done (QA 2 rounds) |

File ownership and the rules for working side by side are in [OWNERSHIP.md](OWNERSHIP.md). Read it before touching anything.

## Flow

1. **Foundation.** E0a (look) and E0b (tooling) run in parallel. The orchestrator merges E0b, runs gate G0, and tags `reskin-e0`.
2. **Epics.** E1–E6 build in parallel, one worktree each, all branched from `reskin-e0`.
3. **Merge.** Epics merge into `feat/lucky-reskin` in the order E6 → E2 → E5 → E3 → E1 → E4. Then **E0-final** runs: the legacy token bridge is deleted once a repo-wide grep is clean.
4. **QA.** Read-only reviewers (design fidelity, motion audit, code audit) produce findings, which are triaged by owner. Fixers then work per owner, and a final verify pass follows.
5. **Handoff.** `git merge-tree` against `integration` must be clean. The branch is then handed to the integration lead, and A6 builds on top of it.

## Scene catalogue

These are dev-only deep links, `?scene=<name>&freeze=1`, implemented by E0b. Screenshots go through `bash scripts/shots.sh`.

| Id | Scene | Owner(s) | State |
|---|---|---|---|
| 01 | `landing` | E1 E6 | HOME, no wallet |
| 02 | `home` | E1 E6 | HOME, wallet connected |
| 02b | `home-active` | E1 | HOME with an open LONG round at +0.72 USDT (active-position banner) |
| 02c | `home-last-win` | E6 | HOME after a winning round ("YOUR PLAY" marker) |
| 02d | `home-last-loss` | E6 | HOME after a losing round |
| 03 | `asset-selector` | E1 | asset-selector sheet |
| 04 | `menu` | E4 | menu sheet, connected |
| 05 | `profile` | E4 | profile drawer, connected |
| 05b | `profile-guest` | E4 | profile drawer, no wallet |
| 06 | `settings` | E4 | settings modal |
| 07 | `pix-chat` | E5 | PIX chat sheet, empty |
| 07b | `pix-chat-thread` | E5 | PIX chat after tapping the first quick prompt |
| 08 | `trade-setup` | E2 E5 E6 | PRE_TRADE, LONG selected (PIX bubble) |
| 08b | `trade-setup-empty` | E2 | PRE_TRADE, no direction |
| 08c | `trade-setup-short` | E2 E6 | PRE_TRADE, SHORT selected |
| 09 | `live-profit` | E2 E5 E6 | LIVE LONG, +1.30 USDT (60% to target) |
| 09b | `live-loss` | E2 E5 E6 | LIVE LONG, −0.72 USDT |
| 09c | `live-short` | E2 E6 | LIVE SHORT in profit, +0.90 USDT |
| 09d | `live-near-target` | E2 E5 E6 | LIVE LONG at 92% of target (PIX: "Almost there.") |
| 10 | `position-details` | E2 | live-profit plus the Position Details sheet |
| 11 | `outcome-win` | E3 E6 | TARGET_HIT banner, +2.16 USDT |
| 11b | `outcome-loss` | E3 E6 | LOSS_HIT banner, −1.62 USDT |
| 12 | `settlement` | E3 | SETTLING, step `submitted` (`&step=` overrides it) |
| 13 | `result-win` | E3 | RESULT, target hit |
| 13b | `result-loss` | E3 | RESULT, stop loss, −1.62 USDT |
| 13c | `result-cashout` | E3 | RESULT, cashed out, +1.25 USDT |
| 13d | `result-timeout` | E3 | RESULT, time up, +0.35 USDT |
| 13e | `result-levelup` | E3 | RESULT, win with level-up |
| 14 | `mission-toast` | E3 | result-win with the mission toast open |

The engine defaults behind these numbers are stake 10, target 1.2%, stop 0.9% and 18x leverage. A target hit pays **+2.16 USDT** (1.22x); a stop hit loses **−1.62 USDT**.

`gallery.html` is a separate dev-only page from E0a that shows every `src/ui/lucky` primitive in every state.

## Visual rubric

Every screen is reviewed against these 10 points, both by the builder's own review and by QA.

1. **Surfaces:** the ladder `canvas → sheet → panel → well → tile`. Insets are darker than their container, never lighter. The blue `lobby` family appears only on the track stage.
2. **One hot element per screen,** the CTA (count badges aside). No other red or pink anywhere.
3. **Color roles:** direction uses `dir-long`/`dir-short`; outcome uses `profit`/`loss`; `gold` is only for BNB, level-up and Pro.
4. **Type:**
   - Figtree on the Lucky scale: display, amount, title, section, body, label, caption, micro, numeral.
   - Nothing smaller than 13px.
   - White on hot only when bold and at least 19px.
   - `ink-faint` only at 20px and up.
5. **Shape:** CTA and pills `rounded-sm` (10); tiles and rows `rounded-md` (14); panels and cards `rounded-lg` (20); sheets and the frame `rounded-xl` (36); discs and badges `rounded-full`.
6. **Depth:** mostly flat.
   - `glow-lucky` for the selected tile, `glow-hot` for the CTA and badges, `glow-gold` for coins and Pro, `lift` for sheets and hero cards.
   - No other glows or text glows.
7. **Texture:**
   - Faint 135° stripes only on tiles and progress fills.
   - The only UI gradient is the hot CTA or badge. The canvas world is exempt, because it counts as illustration.
8. **Copy voice:** see Copy rules.
9. **Numbers:** tabular (`tabular-nums`), exact, currency code after the amount, true minus sign.
10. **States and accessibility:**
    - A 2px lucky focus ring with a 2px offset on everything interactive.
    - Tap targets at least 44px.
    - Correct roles and labels.
    - The reduced-motion variant still looks finished.

## Copy rules

- **The hot CTA** is UPPERCASE and ends with one "!": "CONNECT WALLET!", "PLAY NOW!", "HOLD TO LAUNCH!", "HOLD TO CASH OUT!", "TRADE AGAIN!". No other text uses "!" ("TARGET HIT", "MISSION COMPLETE", "LEVEL UP").
- **Casing:**
  - Labels, tabs and wordmarks: UPPERCASE.
  - Titles: Title Case ("Select Asset", "Position Details").
  - Status sub-lines: lowercase ("live · BNB/USDT").
- **Amounts** put the code after the number: "+2.16 USDT", "−1.62 USDT", "612.34 USDT", "10 USDT". Use the true minus sign (U+2212) and no "$". Use `formatAmount` and `formatPrice` from `src/ui/lucky/format.ts`.
- **Tone:**
  - PIX lines and anything after a loss are calm sentence case ("Stop loss reached as planned.").
  - Never "YOU LOST", "WIN IT BACK", or pressure to replay.
- **No emoji, dingbats or text-art faces:** no 👋 🎯 ⚡ ✓ ★ ▲ ▼ as text. Use `Icon` or the art.

## Before you start (every agent)

1. Read this file, [OWNERSHIP.md](OWNERSHIP.md), and your epic doc.
2. After E0 lands, also read `CONTRACTS.md`, `TOKEN_MAP.md`, `MOTION.md` and `SCENES.md`.
3. From `lucky-ds/`: `README.md`, `tokens.json`, `components/bundle.css`, and the component READMEs and previews for the parts you use.
4. Look at your before-shots in `screenshots/mobile/`.
5. Work only in your own worktree, on your own files.
