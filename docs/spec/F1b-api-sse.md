# F1b — REST API & SSE (frozen)

Schemas live in `packages/shared/src/dto.ts` (REST) and `packages/shared/src/sse.ts` (SSE). This document explains them; the zod schemas win on any disagreement.

## Conventions

- Base path `/v1`, JSON bodies.
- bigints are **decimal strings**. Prices are 18-decimal integers, stakes are 18-decimal tUSD, times are unix seconds (`*Sec`) or ms (`*Ms`).
- Errors: `{ error: { code, message, retryAfterMs? } }`, with `code` from `ErrorCode`. Revert-to-code mapping:

| Custom error | API code |
|---|---|
| `InvalidSignature` | `BAD_SIGNATURE` |
| `IntentExpired` | `INTENT_EXPIRED` |
| `InsufficientBalance` | `INSUFFICIENT_CREDITS` |
| `PlayerHasOpenRound` | `ROUND_ALREADY_ACTIVE` |
| `LaneVersionMismatch` | `LANE_VERSION_MISMATCH` |
| `LaneDisabled`, `AssetDisabled` | `TIER_DISABLED` |
| `CashOutTooLate` | `CASHOUT_TOO_LATE` |
| anything else | `INTERNAL` (logged with the decoded error) |

- Auth: `Authorization: Bearer <jwt>` on routes marked JWT.

## Auth (EIP-712 login, off-chain only)

1. `POST /v1/auth/challenge {address}` → `{salt, expiresAt, chainId}`. The salt is single-use, TTL 5 min, stored in `auth_challenges`.
2. The client signs `Login{player, salt, expiresAt}` with domain `apiDomain(chainId)`. Guests sign silently with the burner; wallets get one prompt.
3. `POST /v1/auth/session {address, salt, expiresAt, signature, kind}` → `{token, player, expiresAt}` (HS256 JWT, 24 h).
4. First session for a guest triggers an automatic faucet drip (see Faucet).

## Endpoints

| Method & path | Auth | Request → Response |
|---|---|---|
| `GET /healthz` | – | `{ok, version}` |
| `GET /readyz` | – | `{ok, checks[]}`; 503 if any check fails (db, rpc, oracle lag, sender balances, indexer lag) |
| `GET /v1/config` | – | `ConfigSchema`: chain, contracts (null before F2), assets with tiers read from chain, delays, feature flags |
| `GET /v1/market/snapshots` | – | `MarketSnapshotSchema[]` for all assets |
| `GET /v1/oracle/rounds?asset&fromSec&toSec&limit` | – | recorded rounds `{sec, tsMs, price, proofHash}[]` (audit) |
| `GET /v1/oracle/proof/:hash` | – | `{proof}` raw bytes, for third-party verification |
| `GET /v1/oracle/calibration` | – | per-asset σ₁ₛ and backtest touch rates (ops/`demo:check` only; never shown as win odds) |
| `POST /v1/auth/challenge` · `POST /v1/auth/session` | – | see Auth |
| `GET /v1/me/balance` | JWT | `BalanceSchema` (ledger available + locked) |
| `POST /v1/faucet/claim` | JWT | 202 `{claimId}` or `FAUCET_COOLDOWN` |
| `POST /v1/rounds/open` | JWT | `OpenRoundRequestSchema` → 202 `OpenRoundResponseSchema`; idempotent by intent hash |
| `POST /v1/rounds/:id/cashout` | JWT | `CashOutRequestSchema` → 202 `CashOutResponseSchema`, or `CASHOUT_TOO_LATE` |
| `POST /v1/me/withdraw` | JWT | `WithdrawRequestSchema` → 202 |
| `GET /v1/rounds/:id` | – | `RoundSchema` |
| `GET /v1/players/:addr/rounds?cursor` | – | `{items: RoundSchema[], nextCursor}` |
| `GET /v1/players/:addr/profile` | – | `ProfileSchema` |
| `GET /v1/leaderboard?period=weekly\|all` | – | `LeaderboardEntrySchema[]` (XP only, never P&L) |
| `GET /v1/pix/insight?asset&tier` | – (IP-limited) | `MarketInsightSchema` (cached 60 s per asset) |
| `GET /v1/pix/debrief/:roundId` | – (the owner's JWT marks it reviewed) | `DebriefSchema` |
| `POST /v1/pix/chat` | JWT | SSE stream: `pix.delta {text}`, `pix.done {usage}`, `pix.error {code}` |

### Round open flow (server side)

1. Validate:
   - JWT player == `intent.player`;
   - signature (viem `verifyTypedData`, arena domain);
   - deadline ≥ now + 1 s;
   - ledger balance ≥ stake;
   - no active round;
   - lane version equals the on-chain version;
   - oracle status `ok`.
2. `simulateContract(openRoundWithSig)`. A revert maps to the API code with no gas spent → `round.open_failed {stakeTaken:false}`.
3. Enqueue on the **relayer** key. Emit `settlement.step` updates (kind `open`).
4. The receipt yields `RoundOpened` → `round.opened` (terms, `entrySec`).
5. The recorder records `entrySec` → `round.entry_locked {entryPrice}`.

## SSE — `GET /v1/stream?player=0x…`

- One connection per browser carries public events (all 5 assets) and that player's events.
- Player events have ids from `player_events` and replay on `Last-Event-ID` (1 h retention). Public events carry no id.
- `: ping` every 15 s. Never compress this route.

| Event | When |
|---|---|
| `hello` | on connect: server time, oracle status, the player's active round + last settled round (drives resume) |
| `prices.snapshot` | on connect/reconnect: last 120 rounds per asset `[round, tsMs, price18]` + 24 h stats |
| `price` | every new Supra round per asset (~1 Hz each) |
| `stats` | every 30 s per asset |
| `oracle.status` | on change |
| `settlement.step` | every tx step for the player's intents/rounds (`kind`: open, cashout, settle, withdraw, faucet, void) |
| `round.opened` | `RoundOpened` observed (receipt or indexer) |
| `round.open_failed` | the open will not happen; `stakeTaken` is always false |
| `round.entry_locked` | checkpoint at `entrySec` recorded |
| `round.touch` | a **recorded** checkpoint crossed a barrier (settlement follows) |
| `round.cashout_requested` | `CashOutRequested` observed (`exitSec`) |
| `round.exit_locked` | checkpoint at `exitSec` recorded |
| `round.settled` | `RoundSettled` observed (final DTO) |
| `round.voided` | a settled round with outcome Voided (stake refunded) |
| `balance` | ledger balance changed |
| `progression.updated` | XP/missions/badges applied after finality |
| `pix.debrief` | the debrief was generated (pre-generated at settle) |

## Rate limits & anti-abuse

| Surface | Limits |
|---|---|
| Faucet | $100 per claim; 24 h cooldown per player; ≤ 3 per IP-hash per day; ≤ 300 per hour globally. Refill is offered only from Profile when the balance is < $5, never on a loss screen |
| Relayer | 1 open per 3 s per player; ≤ 60 rounds/h; queue depth ≤ 50 (`RELAYER_BUSY`). Relayer balance < 0.05 tBNB → opens disabled (`RELAYER_UNFUNDED`) |
| API / SSE | 120 req/min per IP; ≤ 3 concurrent SSE per IP; 2000 SSE total |
| PIX | chat 30/day per player; daily budget kill-switch → templates |

IPs are stored only as salted hashes (`IP_HASH_SALT`); `TRUST_PROXY=true` behind Railway.
