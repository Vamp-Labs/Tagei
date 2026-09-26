# E5 — PIX companion and chat

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| done | `reskin/e5-pix` | `Tagei-worktrees/reskin-e5` | 5185 | tag `reskin-e0` |

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
- [x] **E5-1 `pix/PixAvatar.tsx`:** replaces the kaomoji text face (`PixCompanion.tsx:70-80`).
  - An SVG face (two eyes and a mouth) drawn in code in a 40px `bg-tile` disc.
  - Mood variants: happy, neutral and concerned, driven by the same thresholds as today.
  - A 2px mood ring: `lucky` when P&L ≥ 4, `amber` when ≤ −2.5, `line` otherwise.
  - A blink is allowed, but it stops under reduced motion.
- [x] **E5-2 PIX button:** at least 44px, with `aria-label="Open PIX assistant"` and the lucky focus ring.
- [x] **E5-3 Bubble** (lines 82-97)
  - `bg-panel`, 16px `caption` in `ink-soft`, at most two lines, max width 220px, `role="status"`.
  - Keep the MICRO enter animation and the dismiss times (3200 / 2000 / 2400 / 2800ms).
  - Stays in band B, and never covers the CTA.
- [x] **E5-4 Copy** (lines 43-57), calm sentence case with no emoji. Every event key stays the same:
  - "LONG set. Watching for momentum."
  - "SHORT set. Watching the downside."
  - "Almost there."
  - "Nice landing."
  - "Stop honored. Good risk control." (keep)
- [x] **E5-5 PixChat**
  - Header: two-tone `SheetHeader` title, "PIX" in `lucky` + " AI" in `ink`, subtitle "your trading co-pilot".
  - Empty state: `PixAvatar` large plus "Hey, I'm PIX" (no emoji).
  - Messages container `role="log"`. PIX messages sit on `bg-panel`. User bubbles are `lucky-tint` with `ink` text (today they are yellow with black text).
  - Quick prompts become 44px chips on `bg-control`, `ink-secondary`, `rounded-md`.
  - The input becomes a real `<input disabled aria-disabled>` with an `ink-muted` placeholder, ready for A6 to wire up.
  - Keep the `h-[70vh]` sheet height via the className passthrough.
- [x] **E5-6** Remove every hardcoded color, legacy token, `font-mono`, `text-[9-12px]` and emoji or glyph in the owned files.

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
- `{ "file": "src/ui/lucky/Icon.tsx", "change": "add a \`send\` IconName (paper plane, stroke)", "why": "the PIX chat input needs a send glyph and the Lucky icon set has none", "workaround": "PixChat.tsx keeps lucide-react \`Send\` at size-5 in \`text-ink-muted\`, aria-hidden" }`

## Notes / open issues
- **New files:** `src/components/pix/PixAvatar.tsx` (40px `bg-tile` disc, `ring-2` in `ring-lucky` / `ring-line` / `ring-amber`, SVG eyes and mouth per mood; optional `size`, used at 72px in the chat empty state) and `src/components/pix/mood.ts` (`pixMoodFor`, `HAPPY_PNL = 4`, `CONCERNED_PNL = -2.5`).
- **Mood thresholds** keep today's code exactly: happy at P&L ≥ 4, concerned at P&L < −2.5. The spec says the ring turns amber at ≤ −2.5. Ring and face share one mood, so the only gap is exactly −2.50, which reads neutral.
- **Moods are unreachable at default settings.** Thresholds are absolute USDT, and at stake 10 the round resolves at +2.16 or −1.62, so PIX shows neutral in every catalogue scene. Happy was verified with `live-profit --query delta=2.5` (the round resolved to TARGET_HIT). Concerned could not be shot: `live-loss --query delta=-1.5` resolved into SETTLING, which covers the companion. SCENES.md says a move past target or stop does not resolve in frozen mode, but it does (E0b).
- **Blink:** Motion `scaleY` keyframes on the eye group, 4.2s cycle, eyes closed only in the last ~7% of the cycle. Under `useMotionPref()` it is static at `scaleY: 1`.
- **Bubble:** the companion is now a full-width `inset-x-0 top-16` band with `pointer-events-none`. The old `left-1/2 -translate-x-1/2` wrapper capped shrink-to-fit width at half the frame (about 195px), so `max-w-[220px]` could never be reached. The avatar is a 48px `<button aria-label="Open PIX assistant">`. The bubble sits in a persistent `role="status" aria-live="polite"` region so screen readers announce it; tapping the bubble still opens chat. The entry animation keeps today's values (y −4, scale 0.94, MICRO) and is opacity-only under reduced motion. MOTION.md's "y 8→0 / 0.96" was not adopted because E5-3 says to keep the existing enter.
- **Dismiss timers and event keys are unchanged** (3200 / 2000 / 2400 / 2800ms). `pixAI.ts` is untouched.
- **Chat:** the sheet content is a `min-h-full` flex column inside `Sheet`'s scroller, so prompts and input sit at the bottom of the `h-[70vh]` sheet. Messages arrive with MICRO (y 8→0; opacity-only when reduced). Chips have a MICRO `whileTap` scale of 0.97, off under reduced motion. The first chip carries `data-scene-target="pix-prompt"`. The empty state keeps the existing "Your AI co-pilot for smarter trades." line under "Hey, I'm PIX".
- **Out of scope, seen in shots:** "Hold to Launch" and "Hold to Cash Out" are still yellow and green legacy fills (E2), and the canvas labels are still `$`-prefixed in the legacy mono face (E6).
