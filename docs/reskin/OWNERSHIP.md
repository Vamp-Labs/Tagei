# Ownership and parallel-work rules

Several agents build this re-skin at the same time, each in its own git worktree. The rules below keep them from overwriting each other's work. Each agent owns a separate set of files, and anything else is read-only for it.

Worktree root: `/home/cn/Projects/Competition/Web3/BNB/Tagei-worktrees/`

## Who owns what

| Epic | Branch | Worktree | Port | Owns (edit or create only these) |
|---|---|---|---|---|
| **E0a** Foundation: look | `feat/lucky-reskin` | `reskin-integrate` | 5180 | see below |
| **E0b** Foundation: tooling | `reskin/e0b-tooling` | `reskin-e0b` | 5188 | see below |
| **E1** Home & Landing | `reskin/e1-home` | `reskin-e1` | 5181 | `src/components/{HomeHeroOverlay,ActivePositionBanner,AssetSelector}.tsx`, `src/components/home/**`, `docs/reskin/E1-home.md` |
| **E2** Trade flow | `reskin/e2-trade` | `reskin-e2` | 5182 | `src/components/{PreTradePanel,LiveTradeOverlay,PositionDetails,LaunchCountdown}.tsx`, `src/components/trade/**`, `docs/reskin/E2-trade.md` |
| **E3** Outcome | `reskin/e3-outcome` | `reskin-e3` | 5183 | `src/components/{OutcomeBannerOverlay,SettlementOverlay,ResultPanel,MissionToast}.tsx`, `src/components/outcome/**`, `docs/reskin/E3-outcome.md` |
| **E4** Account | `reskin/e4-account` | `reskin-e4` | 5184 | `src/components/{Menu,PilotProfileDrawer,SettingsModal}.tsx`, `src/components/account/**`, `docs/reskin/E4-account.md` |
| **E5** PIX | `reskin/e5-pix` | `reskin-e5` | 5185 | `src/components/{PixCompanion,PixChat}.tsx`, `src/components/pix/**`, `docs/reskin/E5-pix.md` |
| **E6** Canvas | `reskin/e6-canvas` | `reskin-e6` | 5186 | `src/canvas/**`, `docs/reskin/E6-canvas.md` |
| Integrator | `feat/lucky-reskin` | `reskin-integrate` | 5187 | merges; `docs/reskin/{README,INTEGRATION_LOG,QA}.md`; `screenshots/lucky/**`; E0-final |

**E0a** owns:
- `src/index.css`, `index.html`, `gallery.html`, `public/fonts/**`, `public/lucky/**`, `public/favicon.*`
- `src/ui/**`
- `src/components/Header.tsx`, `src/components/SimulationBar.tsx`
- `docs/DESIGN_TOKENS.md`
- `docs/reskin/{E0a-foundation-look,TOKEN_MAP,CONTRACTS,MOTION}.md`, `docs/reskin/TOKEN_MAP.legacy.txt`
- In `src/App.tsx`, only these regions:
  - new imports placed right after `import { Sheet } from './ui/Sheet';`
  - reduced-motion code placed right after the `settings` state declaration
  - the JSX from `<MotionConfig …>` through the end of the bottom HUD stack (today's lines 436-531)
  - the `reducedMotion` value passed to `MarketTrackCanvas`

**E0b** owns:
- `src/dev/**`, `scripts/**`, `src/vite-env.d.ts`
- `docs/reskin/{E0b-foundation-tooling,SCENES}.md`
- In `src/App.tsx`, only these regions:
  - one import placed right after `import { soundEngine } from './services/audioHaptics';`
  - moving `type ActiveSheet` to module scope
  - one `useDevScene({...})` call on the line right before `return (`
  - the `<SimulationBar …/>` mount condition

**After gate G0, these are frozen for E1–E6:**
- `src/index.css`, `index.html`, `gallery.html`, `public/**`
- `src/ui/**`, `src/dev/**`, `scripts/**`
- `src/App.tsx`, `src/components/Header.tsx`, `src/components/SimulationBar.tsx`

**Nobody touches, ever:**
- `src/main.tsx`, `src/services/**`, `src/types/**`, `test/**`
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, `vite.config.ts`, `.gitignore`
- `screenshots/mobile/**`, `CLAUDE.md`, `docs/spec/**`, `docs/handoffs/**`, `tools/`, `.githooks/`
- the main checkout `/home/cn/Projects/Competition/Web3/BNB/Tagei` (a live dev server on :3000 serves it)
- the `integration` and `a1-spike` worktrees
- any other epic's worktree

## Rules

1. **New files** go only in your epic's own folder, listed above. Never import from another epic's folder; shared code lives in `src/ui/lucky`.
2. **Need a change to a frozen file** (a new token, a prop on a shared primitive, an App.tsx tweak)?
   - Build a local workaround in your own folder instead.
   - Record the request in your result's `integrationRequests` and in the "Integration requests" section of your epic doc: `{file, change, why, workaround}`.
   - You are never blocked, and you never edit the frozen file.
3. **Keep component shapes stable.** Don't change file names, export names or `*Props` interfaces, so App.tsx compiles unchanged. Keep data arrays (`rows`, `LEVERAGE_OPTIONS`, settings rows) in place: A6 edits them next. Optional props may be added only to `src/ui` primitives, and only by E0a.
4. **Leave all logic alone:** state machines, services, the hardcoded 18.4 / 2.8 fallbacks in App.tsx, and hold, drag or timer thresholds. The bug fixes named in your epic doc are the only exceptions.

## Command rules (all agents)

- **Paths:**
  - Work only in `$WT`, your worktree. Always use `git -C $WT …`, `pnpm -C $WT …` and absolute `$WT/…` paths; don't rely on the shell's current directory.
  - Never run a command in, or write a file to, the main checkout or another worktree.
- **Heavy commands** run only under the shared mutex: `flock -w 1800 "$RESKIN_LOCK" <cmd>`. That covers typecheck, test, build, a dev server and screenshots. The machine has about 4 GB of free RAM.
  - `flock -w 1800 "$RESKIN_LOCK" pnpm -C $WT typecheck`
  - `flock -w 1800 "$RESKIN_LOCK" pnpm -C $WT test`
  - `flock -w 1800 "$RESKIN_LOCK" pnpm -C $WT exec vite build --outDir "$RESKIN_TMP/<epic>-dist" --emptyOutDir`. Never write `dist/` in the tree.
  - Screenshots: `bash $WT/scripts/shots.sh --port <yourPort> --out "$RESKIN_SHOTS/<epic>" --scenes a,b,c [--reduced]`. The script takes the mutex and starts and stops Vite itself.
- **Dev server:** your own port only, `--strictPort --host 127.0.0.1`. Kill only the process ID you started. Never `pkill`, `killall` or `fuser -k`.
- **Forbidden:** `pnpm install/add/remove`, `git push/pull/fetch/rebase/merge/reset/stash/checkout <other branch>`, `git worktree …`, and creating any `feat/a*` branch.
- **Commit exactly once,** on your own branch, at the end: `git -C $WT add <your files> && git -C $WT commit -m "feat(reskin-<epic>): …"`. End the message with the two trailer lines given in your prompt.
- **No questions to the user.** If you are blocked, write it in `openIssues` and continue with the rest.

## Gates (every epic, on its own files only)

`F` is the list of your owned files. Each command below must print nothing. E0a applies the same gates to the files it creates, with `src/ui/lucky/palette.ts` and `lucky.css` exempt from the hex rule because they are the source of truth.

```bash
rg -n '#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*[\d$]|hsla?\(\s*\d' $F        # no raw colors: use tokens / palette.ts
rg -n -f $WT/docs/reskin/TOKEN_MAP.legacy.txt $F                   # no legacy tokens or classes
rg -n 'font-mono|JetBrains|monospace' $F                           # Figtree + tabular-nums only
rg -n 'useReducedMotion\(' $F                                      # use useMotionPref() from src/ui/motion
rg -n '\b(text|bg|border|ring|fill|stroke|from|via|to)-(gray|slate|zinc|neutral|white|black)\b|text-\[(9|10|11|12)px\]|\btext-xs\b|\btext-\[10px\]' $F
rg -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{25A0}-\x{25FF}\x{2B00}-\x{2BFF}]' $F   # no emoji / dingbats / ▲▼ glyphs as text
git -C $WT diff --name-only reskin-e0..HEAD | rg -v '<your owned-files regex>'           # ownership: prints nothing
```

Checks that must also pass:
- `pnpm typecheck` and `pnpm test` are green.
- Every scene your epic owns has been shot in normal and `--reduced` mode.
- You looked at each shot and checked it against the rubric in README.md.
- Each scene has at most one hot element.

## Integration request format

```json
{ "file": "src/ui/lucky/WalletRow.tsx", "change": "accept `trailing` node", "why": "asset rows need a price column", "workaround": "src/components/home/AssetRow.tsx composes lg-wallet classes directly" }
```
