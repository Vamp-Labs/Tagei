# E1 — Home & Landing

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e1-home` | `Tagei-worktrees/reskin-e1` | 5181 | tag `reskin-e0` |

## Goal
The first thing a player sees is the landing screen, then the market home and the asset picker. They should read as a Lucky Games lobby: a big two-tone title, one hot button, exact prices with the code after the amount, and the daily goal shown as a Lucky progress bar.

## Owned files
- `src/components/HomeHeroOverlay.tsx`
- `src/components/ActivePositionBanner.tsx`
- `src/components/AssetSelector.tsx`
- `src/components/home/**` (new)
- this doc

Before-shots: `screenshots/mobile/01-landing.png`, `02-home.png`, `03-asset-selector.png`.
Scenes: `landing`, `home`, `home-active`, `asset-selector`.

## Contracts consumed (see CONTRACTS.md)
`Button`/`buttonClass` (hot, ghost), `Icon`, `SheetHeader`, `ProgressBar`, `DirectionChip`, `SignedAmount`, `AssetDisc`, `Pill`, `useConfetti`, `format.ts` (`formatPrice`, `formatPct`), `MICRO`/`STANDARD`, `useMotionPref`. Hot-CTA owner: landing and home.

## Tasks
- [ ] **E1-1 Landing** (`HomeHeroOverlay.tsx:122-153`)
  - Two-tone display title: "Welcome to" in `ink`, **"BNB PLAY"** in `lucky`. The sub-line is a `caption` in `ink-soft`.
  - The CTA becomes a full-width hot `Button`: "CONNECT WALLET!". While busy it shows "CONNECTING…", is disabled and has `aria-busy`. Drop the Rocket icon.
  - "Explore first" becomes a `ghost` text button, 16px, `ink-secondary`, at least 44px tall.
  - Connect confetti: `useConfetti().burst('connect')`, replacing the hardcoded array at lines 50-55.
- [ ] **E1-2 Price block** (lines 159-188)
  - The asset button gets `aria-label="Change asset, BNB selected"`. Show the symbol as `text-label uppercase` with `Icon chevron-down`.
  - Price: `text-display tabular-nums` in `ink`, followed by "USDT" as a `caption` in `ink-muted`, via `formatPrice`.
  - Tick flash: up = `profit`, down = `loss`. Keep the 380ms flash and the 1 → 1.04 → 1 pop (0.28s); no pop under `useMotionPref()`.
  - The 24h change becomes a `SignedAmount` percentage, or `formatPct` with `profit`/`loss` tone.
- [ ] **E1-3 Daily goal** (lines 190-197): a small `ProgressBar` (`size="sm"`) with a "DAILY GOAL 2/3" micro label.
- [ ] **E1-4 Home CTA** (lines 199-214). The "Swipe up to trade" tap target becomes Home's one hot CTA:
  - a hot "PLAY NOW!" `Button` wired to `onOpenTradeSheet`;
  - above it, a bobbing `Icon chevron-up`, keeping the 1.6s loop, which stops under reduced motion;
  - optionally a "swipe up to trade" micro hint.
- [ ] **E1-5 ActivePositionBanner.** Becomes a `bg-well` row in the WalletRow layout, without the radio:
  - "1 ACTIVE POSITION" label, a small `DirectionChip`, `SignedAmount`, `Icon chevron-right`;
  - `aria-label` covering direction and P&L;
  - same tap handler and the same STANDARD enter animation.
- [ ] **E1-6 AssetSelector**
  - Header: `SheetHeader` "Select Asset" / "crypto · 5 markets", with a close `Button variant="icon" icon="close"` in the action slot. This replaces the lone CRYPTO chip.
  - Search field: a `bg-well` row with `aria-label`, placeholder in `ink-muted`, at least 16px text.
  - Rows: new `home/AssetRow.tsx`, built from the WalletRow classes:
    - `AssetDisc` (40), name + symbol, the price "612.34 USDT", the change as a `SignedAmount` percentage, a radio in the corner, and the `lucky-tint` wash when selected;
    - rows without live data show "—" instead of the fake "+0.00%".
  - The list is `role="radiogroup"` with an `aria-label`. Keyboard: arrow keys move, Enter selects.
- [ ] **E1-7** Remove every hardcoded color, legacy token, `font-mono` and emoji or glyph in the owned files. Use tokens and `palette.ts` only.

## Copy table
| Old | New |
|---|---|
| Connect Wallet | CONNECT WALLET! |
| Connecting… | CONNECTING… |
| Explore first → | Explore first |
| Swipe up to trade | PLAY NOW! (+ "swipe up to trade" micro hint) |
| $614.16 | 614.16 USDT |
| +2.38% | +2.38% (profit tone) / −1.02% (loss tone) |
| CRYPTO chip | SheetHeader "Select Asset" · "crypto · 5 markets" |

## Acceptance
- The gates in OWNERSHIP.md pass; `pnpm typecheck` and `pnpm test` are green.
- Scenes `landing`, `home`, `home-active` and `asset-selector` have been shot in normal and `--reduced` mode, and self-reviewed against the rubric. Each scene has exactly one hot element (none on `asset-selector`).
- All flows still work: connect, explore, tap the price to open the selector, select an asset (it closes), tap PLAY NOW to open the trade sheet, and tap the banner to open position details.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
