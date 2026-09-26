# A5 — Web data layer (W2)

**Branch:** `feat/a5-web-data` · **Worktree:** `…/Tagei-worktrees/a5-web-data` · **Owns:** `src/{web3,api,game}/**`, `src/services/**`, `src/types/**`, `src/main.tsx`, `test/**` (except `test/ui/**`)

## Read first

- `CLAUDE.md` and `docs/spec/F0-repo.md`
- **`docs/spec/F1c-stage-machine.md`**
- `docs/spec/F1b-api-sse.md`
- `packages/shared/src/{path,lane,eip712,dto,sse,assets,chain}.ts`
- Current `src/services/*.ts`, `src/types/*.ts`, `src/canvas/MarketTrackCanvas.tsx` (read only: it calls `marketFeed.getHistory()` every frame)

## Deliverables

1. **Wallets** (`src/web3/`):
   - `createConfig` with `bscTestnet`;
   - connectors: `guest()` custom connector, `injected()`, `walletConnect({ projectId: VITE_WC_PROJECT_ID })`;
   - transports via `fallback()`.
   - The guest connector keeps a burner key in `localStorage['bnbplay.guest.v1']` and exposes a minimal EIP-1193 provider that signs `eth_signTypedData_v4`/`personal_sign` locally, forwards reads, and rejects `eth_sendTransaction` (the product is gasless). Provide export/forget helpers.
2. **API + stream** (`src/api/`):
   - zod-validated fetch client;
   - a single shared `EventSource` for `/v1/stream` with a typed dispatcher over `SSE_EVENTS`, reconnect with backoff and `Last-Event-ID`;
   - `serverNow()` clock offset from `hello`;
   - EIP-712 login → JWT.
3. **`marketFeed` adapter.** Keep the **public API unchanged**: `setAsset`, `setLiveMode`, `subscribe`, `getHistory`, `getCurrentPrice`, `getCurrentAsset`, `pushPriceDelta`, `connect`, `cleanup`. Then:
   - Sources in `src/services/priceSources/`: `hub.ts` (SSE `price` + `prices.snapshot`), `binance.ts` (display-only fallback), `mock.ts` (today's random walk, used for Practice).
   - `displayInterpolator.ts` emits 4 Hz display ticks (the same density as today), tweens between exact 1 Hz rounds with easeOutCubic, and does a **150 ms impact snap** when a registered level is crossed.
   - New APIs: `subscribeRounds(cb)` (exact rounds only, for P&L/evaluation), `setLevels`, `getStatus`.
   - A real `change24h` from `stats`.
4. **`roundService`** (`src/services/roundService.ts`): `launch`, `cashOut`, `watch`, `resume`, driven by SSE per F1c. Emit a typed event stream the UI can subscribe to. Also ship `FakeRoundService` with scripted scenarios (win, loss, timeout, cash-out, open failure, settle failure, void) so A6 can build the UI before the backend exists.
5. **`web3Service`**: rewritten behind the same `WalletState` / `SettlementStep` exports (chainId 97, real balances, `isDemoWallet` = guest). **`settlementEngine`** becomes a facade over `@bnbplay/shared` lane/path for Live, plus practice lanes for mock mode. **`pixAI.ts`** becomes a fetch client with template fallback.
6. **`src/game/fx.ts`**: `fxPnl` normalisation (at $10 stake with M 2.84 and no fee it must be **identical** to today's P&L), used by the canvas and PIX thresholds.
7. **`src/types`**: extend `ActiveTradeRound`/`TradeResult`/`UserSettings` per the plan (`roundId`, tier, `endSec`, mode, voided …) without breaking existing consumers.
8. **`main.tsx`**: `WagmiProvider` + `QueryClientProvider`.

## Definition of done

- `pnpm typecheck && pnpm test` green. New unit tests cover the interpolator (continuity, exact convergence, snap), source fallback, `serverNow`, the `roundService` state machine against a fake SSE, the `fxPnl` identity, and the guest connector signing.
- `pnpm dev` still renders Practice mode exactly as before (A6 owns the UI; you must not change components).

## Constraints

- No UI/component edits; A6 consumes your services. Coordinate by exporting types, never by editing their files.
- Keep bundle growth reasonable: lazy-load WalletConnect.
