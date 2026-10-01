# Tagei

Live markets, played like a game, settled on BNB Chain.

**Pick a side. Hold. Ride.**

Pick BNB / BTC / ETH / SOL / DOGE, go LONG or SHORT, and ride a real price for ~30 s. A rocket flies the actual market; PIX (an AI co-pilot) explains what happened; the round settles on **BNB Smart Chain Testnet (chainId 97)** from an on-chain, second-by-second record of a real price feed — not a black box, not a simulated RNG.

- **Live app:** https://bnb-play.vercel.app
- **API:** https://bnb-play-server-production.up.railway.app (`/healthz`, `/readyz`, `/v1/config`)
- **Arena contract:** [`0x8F1E4A377372E7E1d9fb10185c4bb038cF54e439`](https://testnet.bscscan.com/address/0x8F1E4A377372E7E1d9fb10185c4bb038cF54e439) on BSC testnet

No wallet, no faucet, no gas needed to play: tap **Play as Guest** and go. Real wallets (MetaMask, WalletConnect) are also supported.

## The trade in three touches

Asset, stake and tier all have defaults, so direction is the only real decision:

1. Tap **PLAY NOW**
2. Tap **LONG** or **SHORT**
3. **Hold** the launch button

The same hold cashes out. On touch it is a 700 ms press with a haptic tick at each quarter, so a thumb stretching across the screen cannot fire it by accident. A mouse click or Enter / Space commits instantly. The launch button stays locked until a direction is chosen. See `src/ui/HoldButton.tsx`.

## Hackathon submission

Everything for the submission form lives in [`docs/hackathon/`](docs/hackathon/):

| File | What |
|---|---|
| [`problem-statement.md`](docs/hackathon/problem-statement.md) | The problem, in the form's words |
| [`solution.md`](docs/hackathon/solution.md) | The solution and why BNB Chain |
| [`project-detail.md`](docs/hackathon/project-detail.md) | Full write-up with six Mermaid diagrams, contract addresses, the trust model and an honest status |
| [`pitch-kit.md`](docs/hackathon/pitch-kit.md) | Catch lines, hooks, 30 s / 60 s / 3 min pitches, demo script, social copy, judge Q&A |
| [`assets/`](docs/hackathon/assets/) | Current app screenshots |

There is also an original song and music video, *Ride the Market* (2:27), built from real gameplay captures.

## What's real here

Every number the player sees is backed by a real transaction:

| It looks like… | It actually is… |
|---|---|
| A rocket riding a live price line | The **same** Supra DORA-2 oracle round that settles the bet, recorded on-chain every second |
| "ENTRY LOCKED $773.14" | A price read from `CheckpointOracle` at the exact on-chain second your round opened |
| "TARGET HIT +$2.50" | `BnbPlayArena.settle()` replaying the recorded path and paying out from a fully collateralised on-chain ledger |
| A tx link at Result | A real, confirmed BSC testnet transaction — [example](https://testnet.bscscan.com/tx/0xdbf853785b5835c5c8b5b3e65bf042760eaea0ca4b0cfe8553144a84e1f7d2d5) |
| PIX's post-round debrief | Claude (`claude-haiku-4-5`) reasoning over the round's real oracle path, falling back to a template if no API key is configured |

`tools/smoke-live.mjs` proves this end to end against production: guest login → faucet → open a round (signed, on-chain) → wait for settlement → verify the payout and tx hash. Run it yourself:

```bash
node tools/smoke-live.mjs
```

## Why this exists

Trading UIs assume the player already understands candles, order books and leverage. Tagei turns the same underlying data into something a first-time player reads instantly — a rocket going up or down — while keeping every outcome provably tied to a real price and a real settlement transaction. See `bnb_play_prd_v0_2_ui_motion.md` for the full product spec.

## Architecture

```
┌─────────── Browser (Vite/React, src/) ───────────┐
│ Market Track canvas ← marketFeed (Supra-backed)   │
│ wagmi/viem (chain 97): Guest · MetaMask · WC      │
│ EIP-712 signatures: Login · OpenRound · CashOut   │
└───────────▲───────────────────────────────────────┘
            │ SSE (prices, round/tx status, XP) │ REST /v1
┌───────────┴────────────────────────────────────────┐
│ server/ (Hono, Node) — Railway                      │
│ Price Hub ← Supra DORA-2 REST (poll ≥5 Hz, 5 pairs) │
│ Relayer · Recorder (writes a checkpoint every sec)  │
│ Ops (faucet, void watchdog) · Indexer · Progression │
│ PIX (Claude, template fallback) · Postgres          │
└───────────┬──────────────────────────────────────────┘
            ▼ transactions (server pays all gas)
┌─────── BNB Smart Chain Testnet (97) ────────────────┐
│ BnbPlayArena: ledger, house pool, lanes, settlement  │
│   └─ CheckpointOracle (append-only, price/pair/sec)  │
│        └─ StatelessSupraVerifier → Supra DORA-2 BLS  │
│ TestUSD + TestUSDFaucet                              │
└────────────────────────────────────────────────────────┘
```

**The core idea:** a player commits to a round *before* knowing the settlement price. The server then records the real Supra DORA-2 oracle price for every second the round is live, straight into an append-only on-chain log (`CheckpointOracle`). Settlement replays that recorded path in Solidity — the first barrier touched wins — so nobody, including the team running the server, can choose or backdate a price. Full write-up: `docs/spec/F1a-contracts.md` and `contracts/README.md` (trust model).

## Repo layout

| Path | What |
|---|---|
| `src/` | Web app (Vite + React 19 + Tailwind v4 + motion + canvas) |
| `server/` | Backend (Hono): price hub, relayer, recorder, indexer, API, SSE, PIX, progression |
| `contracts/` | Foundry: `BnbPlayArena`, `CheckpointOracle`, `StatelessSupraVerifier`, `TestUSD(Faucet)` |
| `packages/shared/` | The single source of truth for lane math, path settlement, EIP-712 types, DTOs, SSE schema — mirrored bit-for-bit in Solidity and covered by golden-vector differential tests |
| `research/` | The oracle feasibility spike: `spike-report.md`, `lane-params.json`, a captured 23-second Supra proof fixture |
| `docs/spec/` | Frozen specs (F0 repo/tooling, F1a contracts, F1b API/SSE, F1c stage machine, F1d progression, F1e lanes) |
| `docs/security/` | `G1-contracts-review.md` — the pre-deploy security review and its fixes |
| `docs/handoffs/` | Per-workstream build briefs |
| `docs/hackathon/` | Submission pack: problem, solution, project detail (Mermaid), pitch kit, screenshots |
| `tools/` | `demo-check.ts` (pre-demo health gate), `smoke-live.mjs` (live E2E proof), `abi-sync.ts` |

## Running it locally

```bash
pnpm install
pnpm dev            # web app, :3000 (Practice mode works with no backend)
pnpm dev:server      # API, :8787 (needs Postgres; see server/.env.example)
cd contracts && forge test   # contract suite (unit/fuzz/invariant/differential; fork suite needs an RPC)
```

`pnpm typecheck:all` / `pnpm test:all` run the whole workspace (web, `packages/shared`, `server`).

Practice mode (no backend, no chain) is always available for exploring the motion and UI with a simulated feed — clearly labelled "PRACTICE · NOT ON-CHAIN" so it's never confused with a real round.

## Before a demo

```bash
node tools/demo-check.ts          # health, oracle lag, sender balances, lanes — read-only
node tools/demo-check.ts --smoke  # + one full guest round (uses 1 of 3 faucet claims/day for your IP)
```

## Status (2026-09-27)

- Contracts deployed and verified on BSC testnet (chain 97); security-reviewed (`docs/security/G1-contracts-review.md`, PASS with fixes applied).
- Server live on Railway, web live on Vercel, both wired to the same deployment.
- End-to-end proven live: guest sign-up, gasless faucet, a signed on-chain round, real settlement — see `tools/smoke-live.mjs`.
- **Known, accepted for a testnet demo, tracked for mainnet:** informed-flow economics on the lanes (H2 in the security review) and a per-IP-hash faucet cap of 3/day, which is generous for individual testing but can bite several judges behind one shared venue network — see the review for the plan.

---

Built for a BNB Chain hackathon. Testnet only — `TestUSD` has no value, and every private key in this repo is a burner.
