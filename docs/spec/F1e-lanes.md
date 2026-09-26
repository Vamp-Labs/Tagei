# F1e — P0 lanes & adaptive calibration (decided at G0)

Decisions (user, G0): tiers **CRUISE + BOOST**, **BTC BOOST disabled**, HYPER/WARP shown as **"Coming soon"** (chips stay, not playable), **adaptive lanes** on, round duration **30 s**, fee 100 bps on interior payouts.

Source: `research/lane-params.json` (7 days of Binance 1 s data, strict σ). The P(TP) bands were relaxed to CRUISE ≥ 25 %, BOOST ≥ 20 %; every other constraint is unchanged (edge 2–6 %, worst regime ≥ 0, `S ≥ 4σ`, on-chain guard).

## Base lanes (config/97.json, `laneVersion` 1)

| assetId | asset | pair | σ₁ₛ ppm | gapMarginPpm | maxJumpPpm | tier 0 CRUISE (M 15000) T / S | tier 1 BOOST (M 20000) T / S |
|---|---|---|---|---|---|---|---|
| 0 | BNB | 49 | 63.55 | 38 | 15000 | **226 / 434** (P(TP) 32.3 %, edge 5.98 %) | **291 / 262** (24.6 %, 2.84 %) |
| 1 | BTC | 0 | 52.67 | 31 | 10000 | **207 / 397** (26.0 %, 6.01 %) | disabled (momentum edge −2.7 % at 3 s delay) |
| 2 | ETH | 1 | 78.19 | 46 | 15000 | **265 / 507** (31.8 %, 5.86 %) | **358 / 323** (22.9 %, 2.89 %) |
| 3 | SOL | 10 | 111.65 | 66 | 20000 | **240 / 461** (47.4 %, 5.20 %) | **511 / 461** (22.9 %, 2.51 %) |
| 4 | DOGE | 3 | 173.71 | 102 | 40000 | **374 / 717** (43.7 %, 5.77 %) | **794 / 717** (21.4 %, 2.75 %) |

Every row passes the `setLane` guard `(M−1e4)·S + max(0, M−2e4)·gap ≤ 1e4·T`.

| Tier | Settings |
|---|---|
| Tier 2 HYPER (M 30000) and tier 3 WARP (M 50000) | configured with `enabled = false` for every asset. The UI renders them as locked "Coming soon" chips |
| All enabled lanes | `durationSec = 30`, `feeBps = 100`, `minStake = 5e18`, `maxStake = 50e18` (tUSD) |

## Adaptive lanes (ops job, A3)

- **Schedule:** every 10 min (configurable 5–15), per asset.
- **σ estimate:** `σ_recent` = robust σ₁ₛ (bipower) of the last 30 min of **Supra** rounds from the hub.
- **Scaling:** `k = clamp(σ_recent / σ_base, 0.5, 2.0)`, then `T' = round(T·k)`, `S' = round(S·k)`, `gap' = ceil(0.58·σ_recent)`.
  - Lanes are defined in σ units, so this keeps P(TP) and the edge roughly constant across quiet and active regimes.
- **When to update:** call `setLane` (which bumps `laneVersion`) only if `|k − k_current| / k_current > 20 %`, the scaled lane passes `validateLane`, and `S' ≥ 10 ppm`.
- **Never** enable a tier that is disabled in the base table.
- Open rounds keep their snapshot. Clients sign the current `laneVersion`; a `LANE_VERSION_MISMATCH` means refresh `/v1/config` and re-sign once.
- Kill switch `ADAPTIVE_LANES_ENABLED=false` → keep the last lanes.
- Every change is logged to `lane_changes` (ops audit).

## P1 (economic hardening, from spike §6.3)

- Direction-aware odds from a risk engine: a signed quote skews M per direction using CEX momentum.
- Recalibrate on ≥ 7 days of **Supra-native** rounds recorded by the hub from M1 onward.
- Re-evaluate BTC BOOST and the HYPER/WARP options: longer duration or lottery bands.
