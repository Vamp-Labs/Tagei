# E5 — PIX companion and chat

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e5-pix` | `Tagei-worktrees/reskin-e5` | 5185 | tag `reskin-e0` |

## Goal
PIX is the always-on assistant. Its face should be a clean, code-drawn Lucky avatar with a mood ring, not text art. Its bubble is a calm Lucky panel, and its chat is a proper Lucky sheet. PIX's voice stays calm and never pushes the player.

## Owned files
- `src/components/PixCompanion.tsx`
- `src/components/PixChat.tsx`
- `src/components/pix/**` (new)
- this doc

Before-shots: `07-pix-chat.png`, plus the mascot in `08-trade-setup.png`, `09-live-trade.png` and `11-outcome-banner.png`.
Scenes: `pix-chat`, `pix-chat-thread`, `trade-setup` (bubble), `live-profit` / `live-loss` / `live-near-target` (mood).

## Contracts consumed
`SheetHeader`, `Panel`, `Pill`, `Button`, `Icon`, `useMotionPref`, `MICRO`.

Placement: band B (`top-16`, below E2's band A pills). No hot elements anywhere in this epic.

`src/services/pixAI.ts` is read-only, because tests assert its copy.

## Tasks
- [ ] **E5-1 `pix/PixAvatar.tsx`:** replaces the kaomoji text face (`PixCompanion.tsx:70-80`).
  - An SVG face (two eyes and a mouth) drawn in code in a 40px `bg-tile` disc.
  - Mood variants: happy, neutral and concerned, driven by the same thresholds as today.
  - A 2px mood ring: `lucky` when P&L ≥ 4, `amber` when ≤ −2.5, `line` otherwise.
  - A blink is allowed, but it stops under reduced motion.
- [ ] **E5-2 PIX button:** at least 44px, with `aria-label="Open PIX assistant"` and the lucky focus ring.
- [ ] **E5-3 Bubble** (lines 82-97)
  - `bg-panel`, 16px `caption` in `ink-soft`, at most two lines, max width 220px, `role="status"`.
  - Keep the MICRO enter animation and the dismiss times (3200 / 2000 / 2400 / 2800ms).
  - Stays in band B, and never covers the CTA.
- [ ] **E5-4 Copy** (lines 43-57), calm sentence case with no emoji. Every event key stays the same:
  - "LONG set. Watching for momentum."
  - "SHORT set. Watching the downside."
  - "Almost there."
  - "Nice landing."
  - "Stop honored. Good risk control." (keep)
- [ ] **E5-5 PixChat**
  - Header: two-tone `SheetHeader` title, "PIX" in `lucky` + " AI" in `ink`, subtitle "your trading co-pilot".
  - Empty state: `PixAvatar` large plus "Hey, I'm PIX" (no emoji).
  - Messages container `role="log"`. PIX messages sit on `bg-panel`. User bubbles are `lucky-tint` with `ink` text (today they are yellow with black text).
  - Quick prompts become 44px chips on `bg-control`, `ink-secondary`, `rounded-md`.
  - The input becomes a real `<input disabled aria-disabled>` with an `ink-muted` placeholder, ready for A6 to wire up.
  - Keep the `h-[70vh]` sheet height via the className passthrough.
- [ ] **E5-6** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and emoji or glyph in the owned files.

## Copy table
| Old | New |
|---|---|
| ★‿★ / •︵• / •‿• (text face) | PixAvatar SVG moods |
| LONG chosen — momentum looks prime. | LONG set. Watching for momentum. |
| Nice landing! 🎯 | Nice landing. |
| Hey, I'm PIX 👋 | Hey, I'm PIX |
| Ask me anything… | Ask me anything… (disabled input) |

## Acceptance
- The gates in OWNERSHIP.md pass; `pnpm typecheck` and `pnpm test` are green. `pixAI.spec` must be untouched and pass.
- Scenes have been shot in normal and `--reduced` mode and self-reviewed. For `pix-chat-thread`, run `bash scripts/shots.sh … --scenes pix-chat --click "<first quick prompt selector>"`.
- The bubble stays within band B and never overlaps the hot CTA in `trade-setup`.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
