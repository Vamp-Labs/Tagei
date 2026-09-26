# F1c — Game stage machine & failure copy (frozen)

`GameStage` stays as it is today (`src/types/game.ts`): HOME · PRE_TRADE · LAUNCHING · LIVE_TRADE · TARGET_HIT · LOSS_HIT · SETTLING · RESULT. Live rounds are driven by `roundService` events (A5); the UI (A6) only reacts to them. Practice mode keeps today's local engine and mock feed.

## Live mode

| From → To | Trigger | UI behaviour |
|---|---|---|
| HOME → PRE_TRADE | "Swipe up to trade" / "Explore first" | Tier chips + stake bounds come from `/v1/config`. Launch is disabled with a reason if the oracle is not `ok`, the relayer is unfunded, or the balance is below the minimum stake |
| PRE_TRADE → LAUNCHING | Hold to Launch commits (hold **700 ms**) | Sign `OpenRound` (silent for guests) → `POST /v1/rounds/open`. `LaunchCountdown` phase **locking** ("LOCKING ENTRY…") |
| LAUNCHING (phase) | `settlement.step submitted` | phase **charging** ("IGNITION SEQUENCE") |
| LAUNCHING → LIVE_TRADE | `round.entry_locked` | phase **liftoff** shows "ENTRY LOCKED $x" with the **on-chain** entry price, then LIVE_TRADE. Minimum phase durations: locking ≥ 280 ms, charging ≥ 270 ms, liftoff 230 ms |
| LAUNCHING → PRE_TRADE | `round.open_failed` or 8 s without `round.opened` and a confirmed failure | toast **"LAUNCH NOT CONFIRMED · Your stake was not taken."**; selections are kept |
| LIVE_TRADE | each exact Supra round (`marketFeed.subscribeRounds`) | P&L = `markToMarket(terms, p0, price) − stake`. Progress cues at 75/90/98% (PRD §19). Timer = `endSec*1000 − serverNow()` |
| LIVE_TRADE → TARGET_HIT / LOSS_HIT | the local evaluator sees a recorded-grade round cross a barrier, or `round.touch` | impact animation (PRD §20/§23); keep today's 1100 / 700 ms beats |
| LIVE_TRADE (cash-out) | Hold to Cash Out commits | Sign `CashOut` → `POST /v1/rounds/:id/cashout`. Freeze the HUD at a **"≈ snapshot"**; on `round.exit_locked` show **"EXIT LOCKED $x"** with the real exit price |
| LIVE_TRADE (cash-out rejected) | `CASHOUT_TOO_LATE` | "Round ending — settling at the final price."; continue to timeout |
| LIVE_TRADE → SETTLING | timer reaches 0 ("TIME UP · locking final price"), an impact beat ends, or exit locked | `SettlementOverlay` shows the real `settlement.step` sequence for kind `settle`; minimum 600 ms |
| SETTLING → RESULT | `round.settled` | entry, exit and payout **from chain**; tx link via `explorerTxUrl` (testnet); XP arrives with `progression.updated` (≤ ~1.5 s later) |
| SETTLING (failure) | `settlement.step failed` for the settle tx | **"TRANSACTION NOT CONFIRMED · Your position was not settled."** + "Retrying…" (the backend retries; the round stays open) |
| SETTLING → RESULT (void) | `round.voided` | "ROUND VOIDED · Oracle data was incomplete. Your stake was returned." (not a loss) |
| RESULT → PRE_TRADE / HOME | Trade Again / Home | stake stays at the last chosen value (never auto-raised) |

**Resume after reload:** the guest reconnects automatically, then `hello.player` decides.

| `hello.player` state | Go to |
|---|---|
| `activeRound` and `now < endSec` | LIVE_TRADE (skip launch) |
| active round past `endSec` | SETTLING |
| `lastSettled` not yet seen (`localStorage['bnbplay.lastSeenRound']`) | RESULT |

`ActivePositionBanner` shows the live round on HOME.

## Practice mode

- Mock feed + local `SettlementEngine` facade with practice lanes (same M, T/S scaled to the mock volatility). The SIM bar renders **only** here.
- Header pill "PRACTICE · NOT ON-CHAIN". No server calls, no XP.
- The settlement overlay reads "Practice round · not settled on-chain" (600 ms).

## Copy rules

- No "YOU LOST", "DOUBLE DOWN", "WIN IT BACK" or suggested stake increases (PRD §22).
- Win: "TARGET HIT" / "WIN +$x". Loss: "ROUND COMPLETE −$x". Timeout: "ROUND COMPLETE ±$x". Void: "ROUND VOIDED".
- Every chain link uses `explorerTxUrl` / `explorerAddressUrl` from `packages/shared/src/chain.ts` (testnet).

## Latency budget

| Moment | Target |
|---|---|
| Hold release → ENTRY LOCKED | 2.5–3.5 s (hard timeout 8 s → honest failure) |
| Touch → RESULT | 1–2 s |
| Timeout 0 s → RESULT | 1.5–2.5 s |
| Cash-out commit → RESULT | 3–4 s |
| XP after settle | ≤ 1.5 s |
