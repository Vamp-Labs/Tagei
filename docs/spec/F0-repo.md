# F0 — Repository, ownership & tooling (frozen)

## Layout

```
/                      web app (Vite + React 19) and workspace root, package "bnb-play"
├─ src/  test/         web app source and unit tests (unchanged locations)
├─ packages/shared/    @bnbplay/shared — TS source only (exports point at .ts files)
│   ├─ src/            constants, enums, assets, chain, lane, path, eip712, dto, sse, progression, pix
│   └─ vectors/        golden vectors consumed by Foundry + vitest (generated, committed)
├─ server/             @bnbplay/server — Hono API + leader-only workers, bundled with tsup
├─ contracts/          Foundry project (not a pnpm package) — created by A2
├─ research/           spike scripts, fixtures, lane-params.json, report — A1
├─ e2e/                Playwright (W4) — A1
├─ tools/              repo tooling (check-ownership, demo-check, abi-sync)
└─ docs/spec/          frozen specs F0–F2; docs/handoffs/ per-agent briefs
```

Imports inside `packages/shared` and `server` use explicit `.ts` extensions (Node 26 runs TS natively; Vite/tsup/vitest resolve them). Avoid TS `enum`, namespaces and parameter properties so files stay type-strippable.

## Ownership

| Agent | Branch prefix | Owns |
|---|---|---|
| A0 Orchestrator | `main`, `integration`, `chore/a0-*` | everything below plus root configs, lockfile, `packages/shared/**`, `server/package.json`, `server/src/{index,app,config,bus,leader,ports}.ts`, `server/src/db/{client.ts,schema/index.ts}`, `server/drizzle/**`, `docs/**`, `tools/check-ownership.ts`, `.githooks/**`, CI |
| A1 Spike → QA | `feat/a1-*` | `research/**`, `e2e/**`, `server/test/{integration,fakes}/**`, `tools/demo-check.ts` |
| A2 Contracts | `feat/a2-*` | `contracts/**` |
| A3 Chain services | `feat/a3-*` | `server/src/{pricehub,relayer,recorder,ops,indexer,market}/**`, `server/src/db/schema/{oracle,relayer,rounds,chain}.ts`, matching `server/test/*` |
| A4 App services | `feat/a4-*` | `server/src/{api,sse,auth,faucet,progression,pix}/**`, `server/src/db/schema/{players,progression,pix,faucet,events}.ts`, matching `server/test/*`, `packages/shared/src/templates/**` |
| A5 Web data | `feat/a5-*` | `src/{web3,api,game}/**`, `src/services/**`, `src/types/**`, `src/main.tsx`, `test/**` except `test/ui/**` |
| A6 Web UI/motion | `feat/a6-*` | `src/App.tsx`, `src/components/**`, `src/canvas/**`, `src/ui/**`, `src/index.css`, `test/ui/**` |

Enforced by `.githooks/pre-commit` → `tools/check-ownership.ts` (`git config core.hooksPath .githooks`).

## Tooling (pinned)

| Tool | Version |
|---|---|
| Node | 26 locally; `node:24-slim` in Docker |
| pnpm | 11.4.0 (`packageManager`) — `allowBuilds` approves install scripts one by one |
| TypeScript | ~5.7.3 |
| Foundry | 1.7.1, solc 0.8.30, EVM `cancun`; deps via **Soldeer** (no git submodules) |
| viem / wagmi | 2.56 / 2.19 (wagmi v3 needs TS ≥ 5.9.3) |
| zod | 4.6 |
| hono / @hono/node-server | 4.13 / 2.1 |
| drizzle-orm / drizzle-kit / postgres | 0.45 / 0.31 / 3.4 |
| @anthropic-ai/sdk | 0.128 (PIX uses `claude-haiku-4-5`) |
| vitest / tsup / tsx | 3.2 / 8.5 / 4.23 |

## Branches, worktrees, merges

- `main` = baseline + gates only. `integration` = where A0 merges. Agents branch from `integration` as `feat/aN-<topic>`.
- Worktrees live **outside** the repo: `/home/cn/Projects/Competition/Web3/BNB/Tagei-worktrees/<name>`. The main checkout (`…/BNB/Tagei`) is used by another session and a running dev server — never work there.
- Merge order: scaffolding → shared F1 → contract stub ABI + MockSupraPull → price hub → relayer/recorder/indexer → API/SSE/auth → web data → web UI → e2e. Each merge needs `pnpm typecheck:all && pnpm test:all` (and `forge test` for contracts) green.
- Per-worktree ports when running in parallel: web 3000+N, server 8787+N, anvil 8545+N (N = agent number).

## Change requests to frozen interfaces

Agents never edit A0 paths. Put the request in your final report as: file, the change, and why. A0 updates, regenerates vectors if needed, bumps `packages/shared` version, and tells every affected agent.

## Shared dev infrastructure (set up by A0)

| Resource | Value |
|---|---|
| Postgres | container `bnbplay-pg`, `postgres://postgres:postgres@127.0.0.1:55432/<db>`. One DB per agent: `bnbplay_a1`, `bnbplay_a3`, `bnbplay_a4`, plus `bnbplay_dev` for A0 integration. Never use port 5432 (another project's Postgres runs there) |
| Ports per agent N | web 3000+N, server 8787+N, anvil 8545+N |
| Forks of chain 97 | `https://bsc-testnet-rpc.publicnode.com` (archive state) |
| Testnet hot wallets | `~/.config/bnbplay/testnet.env` (chmod 600, outside the repo). **A0 only.** M1 runs entirely on anvil; agents never read, print or commit these keys |
| Public addresses (for docs and config) | deployer `0xcA5391C789fdabf872BdB447d73D9739bBF006f3` · relayer `0x18E82917289AF4E518AC7dd705008033870d6410` · recorder `0xB9Bf2913bfc2C8eE30Ab7CBa539B21c500963C71` · ops `0xeeC1c0a3044b8554430ad9139686b192b1DE0005` |
