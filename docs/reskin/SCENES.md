# Dev scenes and screenshots

Any agent can open the app directly in a catalogue state, frozen, and screenshot it the same way every time. Everything here is dev-only: `vite build` output contains no scene code.

- **Scene engine:** `src/dev/` (`scenes.json` catalogue, `scenes.ts` recipes, `useDevScene.ts` hook, `runtime.ts` freeze helpers).
- **Screenshot tool:** `scripts/shots.sh` (lock + Vite) wrapping `scripts/shots.mjs` (a dependency-free DevTools-protocol client).

## Quick start

```bash
# every scene, normal and reduced motion
bash $WT/scripts/shots.sh --port <yourPort> --out "$RESKIN_SHOTS/<epic>" --all
bash $WT/scripts/shots.sh --port <yourPort> --out "$RESKIN_SHOTS/<epic>" --all --reduced

# only your scenes
bash $WT/scripts/shots.sh --port <yourPort> --out "$RESKIN_SHOTS/<epic>" --scenes live-profit,live-loss
```

In a browser, open `http://127.0.0.1:<port>/?scene=live-profit&freeze=1`.

`shots.sh` takes the shared heavy-work lock itself, so **never wrap it in another `flock`**. It deadlocks on the same lock file.

## URL options

| Option | Effect |
|---|---|
| `scene=<name>` | Runs that scene's recipe. Without it, the app runs normally and the hook does nothing. |
| `freeze=1` | Makes the state deterministic and still (see Freeze below). `shots.mjs` always adds it. |
| `rm=1` | Turns on the in-app Reduced Motion setting. `--reduced` adds it and also emulates `prefers-reduced-motion: reduce`. |
| `dir=LONG\|SHORT` | Overrides the direction in any scene that has one. It also selects a direction in `trade-setup-empty`. |
| `asset=BNB\|BTC\|ETH\|SOL\|DOGE` | Regenerates the price history for that asset and switches to it. |
| `delta=<pct>` | Overrides the scene's raw price move from entry, in percent. For example, `delta=-0.4` on `live-profit` shows a loss. A move past the target or stop still does not resolve the round in frozen mode. |
| `step=idle\|preparing\|signing\|submitted\|confirmed\|failed` | The settlement step for `settlement`, default `submitted`. A tx hash is shown only for `submitted` and `confirmed`, as `executeSettlement` does. |
| `seed=<int>` | The PRNG seed, default `7`. It changes the history shape, entry price, wallet address and tx hash together. |
| `sim=1` | Shows the SimulationBar. It is hidden in scene mode otherwise. |
| `fx=0` | Suppresses confetti in non-frozen mode. Frozen scenes never show confetti. |

Invalid values are ignored and reported in `window.__scene.errors`.

## Freeze (`freeze=1`)

During App's first render, `useDevScene`:
- sets `document.documentElement.dataset.scene = '<name>'` and `dataset.sceneFreeze = '1'` (plus `dataset.sceneFx = '0'` when `fx=0`);
- seeds `Math.random` with mulberry32, once, behind a module flag so StrictMode can't apply it twice;
- **parks every `setTimeout`/`setInterval` of 1000 ms or longer.** They are re-scheduled at the 24.8-day maximum, so they never fire, but `clearTimeout` still works. This holds the round clock at `00:20` and keeps the PIX bubble and mission toast open. It also stops auto-resolve or timeout transitions from starting settlement. Shorter timers (animation, the 700 ms delta pops, React's scheduler) run normally.
- hides the legacy `canvas-confetti` canvas (`body > canvas`). E0a's `ConfettiLayer` no-ops on `dataset.sceneFreeze`.

After App's first effects, the hook stops the 250 ms mock feed (`marketFeed.cleanup()`) and lazy-imports `scenes.ts`. The recipe then runs as follows.
1. It re-seeds `Math.random`.
2. It regenerates the price history: `setAsset(detour)`, then `setAsset(asset)`, then `cleanup()`, then one broadcast tick.
3. It sets App state directly through App's own setters, in one batch.

Recipes never call the SimulationBar handlers, never call `finalizeRound`, and never start settlement.

### Readiness

After the recipe:
1. It waits for `document.fonts.ready`, capped at 5 s.
2. It waits the scene's `settleMs`: 1200 by default, 1600 for results, 2000 for level-up.
3. It sets `window.__scene = { name, fontsOk, errors }` and `document.documentElement.dataset.sceneReady = '1'`.

`fontsOk` is true when the body's first font family has a loaded `FontFace`.

### What is and isn't deterministic

Two consecutive runs give identical numbers and layout.
- DOM-only scenes (sheets, modals, settlement) are pixel-identical.
- Scenes that show the canvas differ in 0.1–2.6% of pixels, all in the canvas: star drift, exhaust and burst particles, rocket bob. Those are frame-timed and use `Math.random` per frame.
- Before each capture, `shots.mjs` pauses every infinite CSS/Web animation at `currentTime = 0` (pulse, ping, spin, glow). Loops are shot at their first keyframe.

## `scripts/shots.sh`

```
bash scripts/shots.sh --port N --out DIR (--scenes a,b | --all | --path P) [--reduced] [--keep-server]
       [--query "dir=SHORT&asset=BTC"] [--jobs N] [--click CSS] [--hold CSS:MS] [--wait MS] [--eval JS]
```

- **Lock:** `flock -w 1800 "${RESKIN_LOCK:-${TMPDIR:-/tmp}/bnbplay-heavy.lock}"`, held for the whole run.
- **Server:** starts `node_modules/.bin/vite --port N --strictPort --host 127.0.0.1` in the script's own worktree, unless the port already answers 200. It waits for HTTP 200 and, on exit, stops only the Vite PID it started. `--keep-server` leaves it running and prints the PID. The log goes to `$RESKIN_TMP/shots-vite-N.log`.
- **Output:** refuses any `--out` inside `screenshots/`. Everything except `--port`, `--out` and `--keep-server` is passed to `shots.mjs`.

## `scripts/shots.mjs`

This is Node's built-in `WebSocket` and `fetch` driving Chrome for Testing's headless shell over the DevTools protocol. It uses no npm dependencies.

| Option | Meaning |
|---|---|
| `--base URL` / `--port N` | App origin (`shots.sh` passes `--base`). |
| `--out DIR` | Output directory, created if missing. |
| `--scenes a,b` / `--all` | Scenes from `src/dev/scenes.json`. Unknown names fail before launch. |
| `--path P` (repeatable) | Any page, e.g. `/gallery.html`. It waits up to 1500 ms for `dataset.sceneReady`, then shoots anyway. Saved as `<slug>[-rm].png`. |
| `--reduced` | Emulates `prefers-reduced-motion: reduce`, adds `&rm=1`, and appends `-rm` to file names. |
| `--query "k=v&…"` | Extra URL options for every page (see URL options). |
| `--jobs N` | Parallel tabs, default 3. |
| `--click CSS` | A touch tap at the element's center, then a 400 ms settle. |
| `--hold CSS:MS` | Touch press. After MS it captures `<file>-hold.png` mid-press, then releases and settles for 400 ms. The CSS may itself contain colons; the last one splits. |
| `--wait MS` | Sleep. |
| `--eval JS` | `Runtime.evaluate` (awaits promises). |

Actions run in order on every page, after readiness and before the final capture.

- **Env:** `CHROME=<binary>` (default `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`), `DPR=<n>` (default 3), `RESKIN_TMP` (a fresh Chrome profile per run, deleted afterwards).
- **Emulation:** 390×844 CSS px (or the scene's `height`) at DPR 3, so 1170×2532 PNGs, with touch on and `mobile: true`.
- **Files:** `<out>/<id>-<name>[-rm].png` and `<out>/console.log`, one `[scene] message` line per page console error, exception or log error.
- **Stdout:** a JSON summary `{ base, out, reduced, dpr, totalMs, consoleErrors, failed, shots: [{ name, id, file, hold?, ok, fontsOk, errors, width, height, ms }] }`.
- **Exit codes:** 1 when any page failed (not ready in 20 s, a missing selector, a CDP error), 2 for a usage error.

A full `--all` run takes about 28–30 s of shooting, plus lock wait and a roughly 1 s Vite start.

Examples:

```bash
bash $WT/scripts/shots.sh --port 5182 --out "$RESKIN_SHOTS/e2" --scenes trade-setup --hold '[aria-label^="Hold to launch"]:250'
bash $WT/scripts/shots.sh --port 5185 --out "$RESKIN_SHOTS/e5" --scenes pix-chat --click '[data-scene-target="pix-prompt"]'
bash $WT/scripts/shots.sh --port 5180 --out "$RESKIN_SHOTS/e0a" --path /gallery.html
bash $WT/scripts/shots.sh --port 5186 --out "$RESKIN_SHOTS/e6" --scenes live-profit --query 'asset=DOGE&dir=SHORT'
```

## Scenes

The engine defaults are stake 10, 18x, target 1.2% and stop 0.9%. P&L = 10 × move% × 18 / 100, rounded by `evaluateTick`.

Progression is 650/770 XP, 2/3 rounds and level 7 unless noted. Every scene except `landing` and `profile-guest` connects the demo wallet (address `0xbNb...8d6a` with seed 7).

| Id | Name | Owners | What the recipe sets |
|---|---|---|---|
| 01 | `landing` | E1 E6 | HOME, no wallet. |
| 02 | `home` | E1 E6 | HOME, wallet connected, no rounds. |
| 02b | `home-active` | E1 | HOME plus an open LONG `activeRound` at +0.72 (+0.4% move): active-position banner and canvas markers. |
| 02c | `home-last-win` | E6 | HOME plus `lastRoundSummary` LONG +2.16 ("YOUR PLAY" marker). |
| 02d | `home-last-loss` | E6 | HOME plus `lastRoundSummary` LONG −1.62. |
| 03 | `asset-selector` | E1 | Sheet `asset-selector`. |
| 04 | `menu` | E4 | Sheet `menu`, connected. |
| 05 | `profile` | E4 | `isProfileOpen`, connected. |
| 05b | `profile-guest` | E4 | `isProfileOpen`, no wallet. |
| 06 | `settings` | E4 | `isSettingsOpen`. With `--reduced`, the Reduced Motion toggle reads on. |
| 07 | `pix-chat` | E5 | Sheet `pix-chat`, empty. |
| 07b | `pix-chat-thread` | E5 | Sheet `pix-chat`, then a click on the first quick prompt (see Contracts). |
| 08 | `trade-setup` | E2 E5 E6 | PRE_TRADE, LONG selected. The PIX bubble stays up. |
| 08b | `trade-setup-empty` | E2 | PRE_TRADE, no direction. |
| 08c | `trade-setup-short` | E2 E6 | PRE_TRADE, SHORT selected. |
| 09 | `live-profit` | E2 E5 E6 | LIVE_TRADE LONG at +1.30 (60% to target). The clock holds at 00:20. |
| 09b | `live-loss` | E2 E5 E6 | LIVE_TRADE LONG at −0.72. |
| 09c | `live-short` | E2 E6 | LIVE_TRADE SHORT at +0.90. |
| 09d | `live-near-target` | E2 E5 E6 | LIVE_TRADE LONG at 92% of target (+1.99). PIX "Almost there" bubble. |
| 10 | `position-details` | E2 | `live-profit` plus the sheet `position-details`. |
| 11 | `outcome-win` | E3 E6 | TARGET_HIT, round at the target, +2.16 (1.22x). |
| 11b | `outcome-loss` | E3 E6 | LOSS_HIT, round at the stop, −1.62. |
| 12 | `settlement` | E3 | SETTLING, the win round, step `submitted` (`&step=` overrides it), seeded tx hash. |
| 13 | `result-win` | E3 | RESULT `win` +2.16, 50 XP. |
| 13b | `result-loss` | E3 | RESULT `loss` −1.62, 25 XP. |
| 13c | `result-cashout` | E3 | RESULT `cashed_out` +1.25, 25 XP. |
| 13d | `result-timeout` | E3 | RESULT `timeout` +0.35, 25 XP. |
| 13e | `result-levelup` | E3 | RESULT `win`, level 8, 790/820 XP, `justLeveledUp` true. |
| 14 | `mission-toast` | E3 | `result-win` with 3/3 rounds, `missionCompleted`, and the mission toast open. It stays open while frozen. |

Result scenes follow `finalizeRound`'s shapes: `TradeResult` (multiplier `(stake + pnl) / stake`, XP 50 for a win and 25 otherwise), a matching `lastRoundSummary`, settlement step `confirmed` with the hash, and `activeRound` kept.

## Contracts for other epics

- **Confetti (E0a):** no-op when `document.documentElement.dataset.sceneFreeze === '1'`. Please also honor `dataset.sceneFx === '0'`.
- **Gallery (E0a):** set `dataset.sceneReady = '1'` once `document.fonts.ready` resolves. `--path /gallery.html` waits for it.
- **PIX quick prompt (E5):** `pix-chat-thread` clicks `[data-scene-target="pix-prompt"]` first. If nothing matches, it falls back to the button whose text is exactly "What's the trend for BNB?". Put that attribute on the first quick prompt if you reword it. If neither matches, the scene reports `No PIX quick prompt found` in `__scene.errors`.
- **Stable hooks for `--click`/`--hold`:** prefer `aria-label` or `data-*` over classes. The scripts tap with real touch events, so pointer-driven components like `HoldButton` respond as they do on a phone.

## Known gaps (as of E0b)

- The result count-up shows ±0.00, and the level-up view never appears in dev, because `ResultPanel.tsx`'s StrictMode guard skips the rerun. E3 fixes this (E3-4). The scenes already set the right data.
- In LIVE scenes, `console.log` shows "Maximum update depth exceeded". The plain app does this too. It comes from App.tsx's live-tick effect re-subscribing on every `activeRound` change, not from the scene code.
- `navigator.vibrate` interventions appear in `console.log` (haptics before any user tap).
- Emoji glyphs render as boxes: the headless shell ships no emoji font. The copy rules remove emoji anyway.
- Under `--reduced`, the canvas still emits target-hit particles (E6).
