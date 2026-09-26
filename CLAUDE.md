# BNB PLAY — agent instructions

BNB PLAY turns a live crypto price into a playable "Market Track": the player picks LONG or SHORT for a ~20 s round, a rocket rides the real price, and the round settles on **BNB Smart Chain Testnet (chainId 97)** from Supra DORA-2 oracle checkpoints recorded every second.

Read before working: `docs/spec/F0-repo.md` (layout, ownership, tooling), then the spec for your area and your handoff in `docs/handoffs/`. The product source of truth is `bnb_play_prd_v0_2_ui_motion.md`; UI/motion specs live in `docs/*.md`.

## Non-negotiables

- **Work only in your own worktree and only in the paths you own** (table in `docs/spec/F0-repo.md`). The pre-commit hook `tools/check-ownership.ts` enforces it per branch prefix (`feat/a1-` … `feat/a6-`).
- **Never edit** `packages/shared/**`, root configs, `pnpm-lock.yaml`, `server/package.json`, `server/src/{index,app,config,bus,leader,ports}.ts` or migrations. These are frozen interfaces owned by A0 (the orchestrator). If you need a change, stop and describe it in your final report; A0 applies it and rebroadcasts.
- **No new dependencies** without A0. Everything expected is pre-installed.
- **Data integrity (PRD §37):** settlement and P&L always use exact oracle checkpoints, never the interpolated display price. The shared evaluator `packages/shared/src/path.ts` is the single source of truth and mirrors the Solidity settlement exactly.
- **Motion quality is a product feature.** The web UI must not regress. Keep the canvas and `marketFeed` public APIs stable.
- Testnet only. Never commit secrets (`.env*` is gitignored). No mainnet transactions.
- Responsible play: stakes are never auto-raised, there is no "win it back" copy, and PIX never promises outcomes.

## Commands

```bash
pnpm i                      # install (workspace: root web app, server, packages/*)
pnpm dev                    # web app (Vite, :3000)
pnpm dev:server             # API (Hono, :8787)
pnpm typecheck:all          # web + shared + server
pnpm test:all               # vitest everywhere
pnpm build                  # web build
pnpm vectors                # regenerate golden vectors (A0)
cd contracts && forge test  # contracts (once scaffolded)
```

## Commits

Conventional style (`feat(server): …`, `fix(web): …`). End every commit message with:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mv7zvqJ5EASmcxrxnWug9w
```
