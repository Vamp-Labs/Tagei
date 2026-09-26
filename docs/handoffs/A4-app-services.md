# A4 — App services (W2)

**Branch:** `feat/a4-app` · **Worktree:** `…/Tagei-worktrees/a4-app` · **Owns:** `server/src/{api,sse,auth,faucet,progression,pix}/**`, `server/src/db/schema/{players,progression,pix,faucet,events}.ts`, matching `server/test/*`, `packages/shared/src/templates/**`

## Read first

- `CLAUDE.md` and `docs/spec/F0-repo.md`
- **`docs/spec/F1b-api-sse.md`**
- `docs/spec/F1d-progression.md`
- `docs/spec/F1c-stage-machine.md` (what the web client expects)
- `server/src/{ports,bus,config,app}.ts`
- `packages/shared/src/{dto,sse,eip712,progression,pix}.ts`
- Use the **claude-api** skill before writing PIX code (model ids, structured outputs, streaming, timeouts).

## Deliverables

1. **API routers** (`api/`), mountable via `createApp({ routers })`: config (lanes read from chain once A2 lands; typed fixtures before that), market snapshots, oracle audit endpoints, rounds (open, cash-out, withdraw → validate, then `TxSender.enqueue` on the relayer key), players (profile, rounds), leaderboard. Every response validates against the shared zod schemas.
2. **SSE hub** (`sse/`):
   - subscribe to `player.event` and `public.event`;
   - persist player events to `player_events` (1 h retention);
   - replay on `Last-Event-ID`;
   - `hello` + `prices.snapshot` on connect;
   - 15 s ping;
   - per-IP connection caps.
3. **Auth** (`auth/`): challenge/session with EIP-712 `Login` (`apiDomain`), a single-use salt, HS256 JWT for 24 h, and middleware.
4. **Faucet** (`faucet/`): auto-drip on a guest's first session plus the claim endpoint; the cooldown and IP-hash caps from F1b; enqueue on the **ops** key.
5. **Progression** (`progression/`): implements `ProgressionService.onRoundFinalized` with an idempotent `xp_ledger` (unique per `(player, round, reason)`), streaks (UTC), missions, badges, levels and titles exactly per F1d using the shared constants; emits `progression.updated`.
6. **PIX** (`pix/`), implementing `PixService`:
   - context builder with numbers computed in code (hub stats, Binance klines, round path);
   - `claude-haiku-4-5` with structured outputs (`InsightLLMSchema` / `DebriefLLMSchema`: the LLM only picks `FactorKey`s and writes copy);
   - `guardrailViolations` post-filter;
   - 3.5 s timeout → templates;
   - insight cache per (asset, tier, 60 s) with single-flight;
   - debrief pre-generated at settle and pushed as `pix.debrief`;
   - chat streaming with a sentence gate;
   - an `llm_usage` budget kill-switch.
   - Templates go in `packages/shared/src/templates/` with 7 branches: win, loss, timeout+, timeout−, cashout+, cashout−, voided. Fix the old label bugs.

## Definition of done

- `pnpm --filter @bnbplay/server typecheck && test` green. Route tests via `app.request()`. SSE replay test. Progression idempotency + UTC rollover tests. PIX adapter tests with a mocked Anthropic client covering success, refusal, timeout, a null parse and a guardrail violation (each must fall back correctly).
- With no `ANTHROPIC_API_KEY`, everything still works (templates).

## Constraints

- Code against `ports.ts` + bus. Never import A3 internals; use fakes of the ports in tests.
- Provide drizzle schema files; A0 generates migrations and wires routers in `server/src/index.ts`.
