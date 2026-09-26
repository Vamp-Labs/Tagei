# E0b — Foundation: tooling (dev scenes + screenshots)

| Status | Branch | Worktree | Port | Base |
|---|---|---|---|---|
| todo | `reskin/e0b-tooling` | `Tagei-worktrees/reskin-e0b` | 5188 | `00b1c44` + docs commit |

## Goal
Let any agent put the app into a given state, frozen, and screenshot it the same way every time. Seven agents will verify their screens in parallel, so this has to be deterministic, dependency-free and cheap. E0b runs at the same time as E0a (the look), so don't touch E0a's files.

## Owned files
- `src/dev/**` (new)
- `scripts/**` (new)
- `src/vite-env.d.ts` (new, so `import.meta.env` typechecks)
- `docs/reskin/{E0b-foundation-tooling,SCENES}.md`
- App.tsx, only in these regions:
  - one import placed right after `import { soundEngine } from './services/audioHaptics';`
  - moving `type ActiveSheet` (line 401) to module scope, unchanged
  - one `useDevScene({...})` call on the line right before `return (`
  - the `<SimulationBar …/>` mount condition

## Tasks

### 1. Scene engine: `src/dev/`
- [ ] `scenes.json`: the catalogue, `[{id, name, owners, settleMs, height?}]`, one entry per scene in `docs/reskin/README.md` (01 … 14). The script reads this file too.
- [ ] `scenes.ts`: one recipe per scene. A recipe receives the App setters and handlers and puts the app directly into the target state.
  - Reuse the setters (App.tsx lines 41-85 and 402), `handleConnectWallet` (line 132) and `handlePlayNow` (line 137).
  - Rounds come from `SettlementEngine.initRound` + `evaluateTick`, called as at lines 146 and 279.
  - Price moves use `marketFeed.pushPriceDelta`, as `handleSimulatePriceBump` does (line 321), without the sound.
  - Results follow the result shape in `handleSetStage` (lines 375-389) and the summary shape in `finalizeRound` (lines 214-238).
  - **Never** call the sim handlers at lines 326, 337, 348 and 359. They schedule `finalizeRound` on timers, and 359 also turns auto-resolve off.
  - Use the numbers from the README's scene table: stake 10, 18x, target +2.16, stop −1.62, cash-out +1.25, timeout +0.35. For `result-levelup`: level 8, 790/820 XP, `justLeveledUp` true. Other progression values: 650/770 XP and 2/3 rounds, except the `mission-toast` scene, which uses 3/3.
- [ ] `useDevScene.ts`: `useDevScene(ctx)`. It returns early unless `import.meta.env.DEV` is true and `?scene=` is present. Query options:
  - `scene=<name>`, `freeze=1`
  - `rm=1`: turns on the in-app reduced-motion setting
  - `dir=LONG|SHORT`, `asset=BTC`, `delta=<pct>`, `step=<settlementStep>`, `seed=<n>`
  - `sim=1`: shows SimulationBar
  - `fx=0`: suppresses confetti
- [ ] **Freeze (`freeze=1`):**
  - Seed `Math.random` with mulberry32 (seed 7 by default) inside a `useState` initializer, so it happens during the first render, before the feed effect regenerates history through `setAsset`. A module-level flag stops React StrictMode from applying it twice.
  - After the recipe's last asset change, call `marketFeed.cleanup()` to stop the 250ms mock feed.
  - No auto-transitions: recipes set state directly, and never start settlement.
- [ ] **Readiness:** after the recipe, wait for `document.fonts.ready` and then the scene's `settleMs` (default 1200; results 1600; level-up 2000). Then set `document.documentElement.dataset.sceneReady = '1'` and `window.__scene = {name, fontsOk, errors}`.
- [ ] Scenes that depend on component timers must be settled before they expire: the PIX bubble lasts 2–3.2s and the mission toast auto-hides at 3.2s.

### 2. App.tsx wiring (your regions only)
- [ ] Move `type ActiveSheet` to module scope, unchanged.
- [ ] Add one import, and one `useDevScene({...})` call right before `return (`. Pass the setters and handlers.
- [ ] Hide `<SimulationBar/>` in scene mode unless `sim=1`, for example `{!devScene.active || devScene.sim ? <SimulationBar …/> : null}`. Keep its props identical.
- [ ] Production: `vite build` output must contain no scene code. Gate everything with `import.meta.env.DEV` and lazy-import `scenes.ts`.

### 3. Screenshot script (no npm dependencies)
- [ ] **`scripts/shots.mjs`:** a Node 26 DevTools-protocol client using the built-in `WebSocket` and `fetch`.
  - Browser: `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` (Chrome for Testing 151). Override with `CHROME=`.
  - Launch flags: `--remote-debugging-port=0`, a fresh `--user-data-dir` per run (under `$RESKIN_TMP` or `os.tmpdir()`), `--no-first-run --hide-scrollbars --mute-audio --force-color-profile=srgb --font-render-hinting=none --disable-background-timer-throttling --disable-renderer-backgrounding --run-all-compositor-stages-before-draw`.
  - Read the WebSocket URL from the stderr line "DevTools listening on".
  - Emulation: 390×844 (or the scene's `height`) at DPR 3 (`DPR=` overrides it), touch on. `--reduced` emulates `prefers-reduced-motion: reduce` and adds `&rm=1`.
  - For each scene: navigate to `/?scene=<name>&freeze=1`, poll `dataset.sceneReady` every 100ms (20s timeout), run any actions, and capture `<out>/<id>-<name>[-rm].png`.
  - Arbitrary pages: `--path /gallery.html` waits for `sceneReady` if the page sets it, otherwise 1500ms.
  - Actions: `--click <css>`, `--hold <css>:<ms>` (a touch press held for ms, capturing a `-hold` shot mid-press, then released), `--wait <ms>`, `--eval <js>`.
  - Write page console errors to `<out>/console.log` and a JSON summary to stdout.
- [ ] **`scripts/shots.sh --port N --out DIR (--scenes a,b | --all | --path P) [--reduced] [--keep-server]`:**
  - Takes `flock -w 1800 "${RESKIN_LOCK:-${TMPDIR:-/tmp}/bnbplay-heavy.lock}"` for the whole run.
  - Starts `pnpm exec vite --port N --strictPort --host 127.0.0.1` in the script's own worktree unless the port already answers.
  - Waits for HTTP 200, runs `shots.mjs`, and stops only the Vite process ID it started.
  - Never writes into `screenshots/`.
- [ ] `docs/reskin/SCENES.md`: how to use the scenes and the script, every option, and what each scene shows.

## Acceptance
- Every scene in `scenes.json` produces a 1170×2532 PNG. Two consecutive runs show identical numbers and layout.
- A full run finishes in under 90s.
- `--reduced` works, and `--path /gallery.html` works once E0a's page exists (until then, check it against `/`).
- `grep -r "useDevScene\|scenes.json" <build-out>` is empty.
- `pnpm typecheck` and `pnpm test` are green.
- The gates in OWNERSHIP.md pass on your files.
- The ownership diff is clean. One commit.

## Integration requests
_(filled in by the agent)_

## Notes / open issues
_(filled in by the agent)_
