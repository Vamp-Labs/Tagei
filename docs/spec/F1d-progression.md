# F1d — Progression rules (frozen)

Constants live in `packages/shared/src/progression.ts`. The server (A4) is authoritative and awards XP **once per round, idempotently, only after the settlement block is finalized**. Practice rounds earn nothing. XP never scales with stake.

## XP per settled live round

| Award | XP | Rule |
|---|---|---|
| Flight complete | +20 | any outcome, including loss and void |
| Target hit | +15 | outcome TargetHit |
| Disciplined exit | +10 | cash-out after ≥ 25% of the duration and ≥ 5 s, with payout ≥ 40% of stake (secures gains or cuts losses) — `isDisciplinedExit` |
| Learning | +5 | the owner opens the PIX debrief within 10 min (once per round) |
| Daily streak | +10 × min(streak, 5) | first completed live round of each UTC day |
| Diminishing returns | – | rounds 31–60 of a UTC day earn ½ base XP; round 61+ earn 0 (`dailyXpFactor`) |

## Daily missions (UTC; action-based, never P&L- or stake-based)

| id | Title | Goal | XP |
|---|---|---|---|
| `fly_3` | Fly 3 rounds | 3 | +50 |
| `both_directions` | Fly both directions | 2 distinct | +30 |
| `review_debrief` | Review a PIX debrief | 1 | +20 |

## Levels & titles

XP to the next level is `40 + 20·(L−1)`; level L starts at `40(L−1) + 10(L−1)(L−2)`. That gives L2 = 40, L3 = 100, L4 = 180, L5 = 280, L7 = 540, L8 = 700, L10 = 1080. A first session of about 5 rounds reaches L4–5.

| Levels | Title |
|---|---|
| 1–2 | CADET |
| 3–4 | NAVIGATOR |
| 5–6 | TRAILBLAZER |
| 7–9 | MOMENTUM HUNTER |
| 10–14 | VOLATILITY SURFER |
| 15–19 | HYPERDRIVE ACE |
| 20+ | ORBIT LEGEND |

## Badges

| id | XP | Condition |
|---|---|---|
| `first_orbit` | +25 | first settled live round |
| `hyperdrive_pilot` | +50 | a round with payout / stake ≥ 2.0 |
| `iron_discipline` | +50 | 5 disciplined exits (lifetime) |
| `whale_hunter` | +75 | 5 target hits (lifetime, cumulative; shown as "3/5") |

P1: mint badges as soulbound `PilotBadges` (ERC-1155) from indexed events.

## Leaderboard

Weekly (Monday 00:00 UTC) and all-time XP. Rows show rank, name, level, title, XP — **no P&L, no win rate**.

## Guardrails

- No comeback or loss-streak bonuses.
- Stake is sticky at the last chosen value and never auto-raised.
- Faucet refill is never offered on a loss screen.
- P2: after 3 losses in a row, a skippable PIX "take a breather" card.
