# E4 — Menu, profile, settings

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e4-account` | `Tagei-worktrees/reskin-e4` | 5184 | tag `reskin-e0` |

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
- [ ] **E4-1 Header** (`Menu.tsx:60-72`): `ART.avatar` at 48px in a disc, then "TraderFox" and "Level 7 · 720 XP" with the level in `lucky`, all from props.
- [ ] **E4-2 Rows** (lines 14-41, 74-80)
  - A `Panel` of `bg-well` navigation rows, each with `Icon chevron-right`, at least 56px tall.
  - Disabled stubs (Positions, History, Help) get `aria-disabled` and `ink-muted`.
  - A count `Badge` appears only when the count is above 0.
  - Keep the local `Row` sub-component and the rows array shape.
- [ ] **E4-3 Streak** (lines 82-90): a well row with `ART['reward-gift']` and "+50 XP" in `lucky`.
- [ ] **E4-4 Disconnect:** a secondary "Disconnect wallet" button. No red, no hot.

### Profile drawer
- [ ] **E4-5 Shell**
  - Keep `edgeSign`, the 90 / 500 drag thresholds and STANDARD.
  - Header: a close icon button with `aria-label="Close profile"`, the title "Pilot Profile", and the subtitle "id #BNB-8849".
  - `ART.avatar` replaces the lightning emoji. Add `role="dialog"` and `aria-modal`.
- [ ] **E4-6 Level card** (lines 125-148): `BalanceHeader` with the brand word and second word taken from the progression title (for example "Momentum" / "Hunter"), the value "720 XP" and the `coin` art. Below it, a `ProgressBar` at 720/770 with `next` = the next level.
- [ ] **E4-7 Stats** (lines 150-176): replace the invented "68%" win rate and "2.84x" best payout with real values from props, in `StatTile`s: Streak, Rounds today, Level.
- [ ] **E4-8 Chain card** (lines 178-203)
  - WalletRow layout: `AssetDisc` BNB, "2.50 tBNB", and a "testnet · 97" `Pill`.
  - When disconnected, show the drawer's only hot element, "CONNECT WALLET!".
- [ ] **E4-9 Badges** (lines 205-255): a `Panel` titled "Badges" with a `RewardTile` grid, three per row.
  - Earned: First Orbit (`reward-gift`), Hyperdrive Pilot (`reward-crown`), Iron Discipline (`reward-clover`).
  - Locked: Whale Hunter (`locked-crown`, amber progress at 60%, "3/5").
  - Keep the badges data array.
- [ ] **E4-10 Controls** (lines 257-344)
  - Thumb side becomes a `SegmentedTabs` radiogroup, LEFT | RIGHT.
  - The toggles become `Toggle` rows with `role="switch"`, built from one data array. A6 will swap the Binance toggle for a Practice-mode one, so keep it a data entry.
  - Footer: the BscScan link as an `info` ghost button.

### Settings modal
- [ ] **E4-11 SettingsModal**
  - Keep the scrim and card variants and the 120 / 500 drag.
  - `SheetHeader` "Settings" with a close icon (`aria-label`).
  - All toggles are `Toggle`, lucky when on (today they mix yellow and green).
  - Feed mode becomes a "SANDBOX | LIVE" `SegmentedTabs`.
  - Thumb-side copy: replace "Puts the launch arc under your hand" (that feature was removed) with "Which side the profile drawer opens from".
  - "DONE" becomes a secondary "Done".
- [ ] **E4-12** Remove all 56 legacy hex values and the gray/white/black utility classes, `text-[10px]`, `font-mono` and emoji. Tokens and primitives only.

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
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
