# E4 — Menu, profile, settings

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| done | `reskin/e4-account` | `Tagei-worktrees/reskin-e4` | 5184 | tag `reskin-e0` |

## Goal
The menu, profile drawer and settings modal are the most "Lucky" surfaces in the app:
- panels of dark rows;
- a balance header for level and XP;
- a reward-tile grid for badges;
- clean toggles.

These three files also hold most of the leftover neon styling (56 hex values, about 100 gray/white classes, a lightning emoji avatar, made-up stats). All of it goes.

## Owned files
- `src/components/Menu.tsx`
- `src/components/PilotProfileDrawer.tsx`
- `src/components/SettingsModal.tsx`
- `src/components/account/**` (new)
- this doc

Before-shots: `04-menu.png`, `05-profile.png`, `06-settings.png`.
Scenes: `menu`, `profile`, `profile-guest`, `settings`.

## Contracts consumed
`Panel`, `SheetHeader`, `Button` (hot, secondary, icon), `Badge` (count, pro), `BalanceHeader`, `ProgressBar`, `RewardTile`, `StatTile`, `WalletRow`, `AssetDisc`, `Pill`, `Toggle`, `SegmentedTabs` (radiogroup), `Icon`, `Scrim`, `ART` (`avatar`, `coin`, `reward-*`, `locked-*`, `pro-*`), `format.ts`, `useMotionPref`, `STANDARD`, `cardVariants`/`scrimVariants`.

Hot-CTA owner: the guest profile only ("CONNECT WALLET!"). The menu and settings have none.

## Tasks

### Menu
- [x] **E4-1 Header** (`Menu.tsx:60-72`): `ART.avatar` at 48px in a disc, then "TraderFox" and "Level 7 · 720 XP" with the level in `lucky`, all from props.
- [x] **E4-2 Rows** (lines 14-41, 74-80)
  - A `Panel` of `bg-well` navigation rows, each with `Icon chevron-right`, at least 56px tall.
  - Disabled stubs (Positions, History, Help) get `aria-disabled` and `ink-muted`.
  - A count `Badge` appears only when the count is above 0.
  - Keep the local `Row` sub-component and the rows array shape.
- [x] **E4-3 Streak** (lines 82-90): a well row with `ART['reward-gift']` and "+50 XP" in `lucky`.
- [x] **E4-4 Disconnect:** a secondary "Disconnect wallet" button. No red, no hot.

### Profile drawer
- [x] **E4-5 Shell**
  - Keep `edgeSign`, the 90 / 500 drag thresholds and STANDARD.
  - Header: a close icon button with `aria-label="Close profile"`, the title "Pilot Profile", and the subtitle "id #BNB-8849".
  - `ART.avatar` replaces the lightning emoji. Add `role="dialog"` and `aria-modal`.
- [x] **E4-6 Level card** (lines 125-148): `BalanceHeader` with the brand word and second word taken from the progression title (for example "Momentum" / "Hunter"), the value "720 XP" and the `coin` art. Below it, a `ProgressBar` at 720/770 with `next` = the next level.
- [x] **E4-7 Stats** (lines 150-176): replace the invented "68%" win rate and "2.84x" best payout with real values from props, in `StatTile`s: Streak, Rounds today, Level.
- [x] **E4-8 Chain card** (lines 178-203)
  - WalletRow layout: `AssetDisc` BNB, "2.50 tBNB", and a "testnet · 97" `Pill`.
  - When disconnected, show the drawer's only hot element, "CONNECT WALLET!".
- [x] **E4-9 Badges** (lines 205-255): a `Panel` titled "Badges" with a `RewardTile` grid, three per row.
  - Earned: First Orbit (`reward-gift`), Hyperdrive Pilot (`reward-crown`), Iron Discipline (`reward-clover`).
  - Locked: Whale Hunter (`locked-crown`, amber progress at 60%, "3/5").
  - Keep the badges data array.
- [x] **E4-10 Controls** (lines 257-344)
  - Thumb side becomes a `SegmentedTabs` radiogroup, LEFT | RIGHT.
  - The toggles become `Toggle` rows with `role="switch"`, built from one data array. A6 will swap the Binance toggle for a Practice-mode one, so keep it a data entry.
  - Footer: the BscScan link as an `info` ghost button.

### Settings modal
- [x] **E4-11 SettingsModal**
  - Keep the scrim and card variants and the 120 / 500 drag.
  - `SheetHeader` "Settings" with a close icon (`aria-label`).
  - All toggles are `Toggle`, lucky when on (today they mix yellow and green).
  - Feed mode becomes a "SANDBOX | LIVE" `SegmentedTabs`.
  - Thumb-side copy: replace "Puts the launch arc under your hand" (that feature was removed) with "Which side the profile drawer opens from".
  - "DONE" becomes a secondary "Done".
- [x] **E4-12** Remove all 56 legacy hex values and the gray/white/black utility classes, `text-[10px]`, `font-mono` and emoji. Tokens and primitives only.

## Copy table
| Old | New |
|---|---|
| PILOT DOSSIER | Pilot Profile |
| TELEMETRY & FLIGHT STATS | STATS |
| Connect Pilot Wallet | CONNECT WALLET! (guest only) |
| ⚡ avatar | avatar art |
| 68% / 2.84x (fake) | real streak / rounds today / level |
| Disconnect Wallet (red) | Disconnect wallet (secondary) |
| DONE | Done |

## Acceptance
- The gates in OWNERSHIP.md pass; `pnpm typecheck` and `pnpm test` are green.
- All four scenes have been shot in normal and `--reduced` mode and self-reviewed. `profile-guest` shows exactly one hot element; the others show none.
- Every toggle still updates settings. The in-app reduced-motion toggle still works. The drawer flings closed toward its edge, and the modal drag-dismisses.
- The ownership diff is clean. One commit.

## Integration requests
```json
[
  { "file": "src/ui/lucky/WalletRow.tsx", "change": "add a non-interactive mode (e.g. `as=\"div\"` or `static`) that drops role=radio, aria-checked and the corner radio", "why": "the profile chain card shows one wallet, it is not a choice; a lone role=radio is wrong semantics", "workaround": "src/components/account/ChainCard.tsx composes the lg-wallet / lg-wallet--compact classes on a div with pr-4" },
  { "file": "src/ui/lucky/RewardTile.tsx", "change": "render a div (no aria-pressed) when onClick is absent", "why": "display-only badge tiles are announced as unpressed toggle buttons", "workaround": "BadgeGrid passes a full state label (\"First Orbit, earned. ...\") so the announcement is still meaningful" },
  { "file": "src/ui/lucky/lucky.css (.lg-balance-value b)", "change": "white-space: nowrap", "why": "\"650 XP\" wraps onto two lines in a 336px drawer column", "workaround": "PilotProfileDrawer passes className \"[&_b]:whitespace-nowrap\"" },
  { "file": "src/ui/lucky/lucky.css (.lg-stat-tile)", "change": "justify-content: flex-start (or a two-line min-height on the label)", "why": "a wrapping label (ROUNDS TODAY) shifts that tile's value off the row's baseline", "workaround": "the stats grid uses \"[&>.lg-stat-tile]:justify-start\"" },
  { "file": "src/ui/lucky/Badge.tsx", "change": "optional size=\"sm\" for the count badge (about 28px)", "why": "the 52px count badge is lobby-sized; menu rows need a row-sized count", "workaround": "Menu Row overrides with h-7 min-w-7 px-2 text-micro" }
]
```

## Notes / open issues
- **Scenes shot** (normal and `--reduced`): `menu`, `profile`, `profile-guest`, `settings`, plus the profile scrolled to the badges and to the controls. `profile-guest` has exactly one hot element (CONNECT WALLET!); menu, profile and settings have none. Console errors: 0.
- **Interaction check:** in `settings`, tapping Sound effects, LIVE and LEFT flipped `aria-checked`, the feed description and `html[data-hand]`. With `--reduced`, the Reduced motion toggle reads on.
- **Profile id** is the static `#BNB-8849` from this doc. The old address-derived id printed "#BNB-BNB." on the demo wallet, whose address is the literal `0xbNb...xxxx`. For the same reason, the chain card shows a demo address as is and runs a real one through `formatHash`.
- **Copy deviation:** the stats panel title is "Stats" (Title Case, like the neighbouring "Badges" and "Controls" panel titles), not the uppercase "STATS" in the copy table.
- **Disabled menu rows** (Positions, History, Help & Support) carry `aria-disabled` and a neutral "soon" pill instead of a chevron, because a chevron promises navigation. The Positions count badge renders only above 0.
- **Reduced motion:** the drawer cross-fades instead of sliding (MOTION §2, "Fades; drag still works"). The fling thresholds (90 px / 500 px/s along `edgeSign`) and STANDARD are unchanged. The settings card keeps `cardVariants`; under MotionConfig only its opacity animates.
- **Not verified live:** drag-to-dismiss on the drawer and the modal. The shot tool only taps and holds. The drag code is byte-identical apart from the classes.
- **Open, out of scope:** the drawer and the modal now declare `role="dialog"` and `aria-modal`, but there is still no focus trap, initial focus or Escape-to-close. Adding them is a behaviour change, so it is left for a follow-up.
- **Open, out of scope:** the SettingsModal card has no max-height. On viewports shorter than about 700px it can overflow the scrim (pre-existing).
- **Noticed, left alone:** `.pilot-drawer` in `src/index.css:204` always docks the drawer at `right: 0`, even when the thumb side is LEFT and the drawer slides in from the left. On a 390px phone it is full width, so this is invisible. In the 448px frame there is a 64px gap on the wrong side. Fix: mirror it on `:root[data-hand="left"] .pilot-drawer { left: 0; right: auto; border-right: 1px solid …; border-left: 0 }` (E0a file).
