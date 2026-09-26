# F1a — Contracts & settlement rules (frozen)

Source of truth for arithmetic and evaluation: `packages/shared/src/{lane,path,eip712,constants,enums}.ts`. Solidity must reproduce them **bit for bit**. The golden vectors in `packages/shared/vectors/*.json` are the acceptance test.

## 1. Why this design ("flight recorder")

Supra DORA-2 is the only free, sub-second oracle on chain 97, and it has one hard limitation.

**F1:** `verifyOracleProofV2` only accepts the **latest** round. If a proof is older than the round Supra already stores for that pair, the call returns the stored newer value, so history cannot be proven later.

We therefore:

1. Record every second's 5-pair proof into our own append-only `CheckpointOracle` while any round is active.
2. Let the player **commit without a price**: `entrySec = block.timestamp + 2`.
3. Settle from the **full recorded path**, where the first barrier touched wins.

Nobody can choose a price. The operator is trusted for liveness only: the worst it can cause is a void (stake refunded).

## 2. Contracts

| Contract | Responsibility | Roles |
|---|---|---|
| `TestUSD` | ERC-20, 18 decimals, EIP-2612 permit | `MINTER_ROLE` (faucet, deployer) |
| `TestUSDFaucet` | Drips tUSD into a player's Arena ledger via `arena.depositFor` (cooldown + per-address cap) | `OPERATOR_ROLE` (backend ops key), admin |
| `SupraPriceVerifier` | Wraps Supra pull `verifyOracleProofV2`; validates outputs; normalises prices to 18 decimals | — |
| `SignedPriceVerifier` | Backup: EIP-712 `PriceBatch` signed by a backend key. `isTrusted() = true`; the UI labels such rounds | `SIGNER_ADMIN_ROLE` |
| `CheckpointOracle` | Permissionless `record(proof)`; set-once price per (pair, second); range reads | none (immutable; bound to one verifier) |
| `BnbPlayArena` | Ledger, house pool, versioned lanes, rounds, settlement | `DEFAULT_ADMIN`, `CONFIG`, `PAUSER`, `TREASURY` — **no relayer or keeper role** |

Solidity 0.8.30, EVM `cancun`, optimizer 1000 runs. OpenZeppelin ≥ 5.2 via Soldeer: AccessControl, Pausable, ReentrancyGuardTransient, EIP712, ECDSA, SignatureChecker, NoncesKeyed, Math, SafeCast, SafeERC20, ERC20Permit. The Supra interfaces are vendored.

Supra on chain 97:
- pull proxy `0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917`
- storage `0x004d42225631F6bec6503a281Ed4c233810CBC29`
- pairs: BTC 0, ETH 1, DOGE 3, SOL 10, BNB 49

Arena `assetId` follows `packages/shared/src/assets.ts`: 0 BNB, 1 BTC, 2 ETH, 3 SOL, 4 DOGE.

## 3. Interfaces

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

enum Direction   { Long, Short }
enum RoundStatus { None, Open, Settled }
enum Outcome     { None, TargetHit, StopHit, Timeout, CashedOut, Voided }
enum VoidReason  { None, EntryInvalid, TerminalInvalid, CheckpointGap, Stalled }

struct AssetConfig { uint32 pairId; uint32 maxJumpPpm; uint32 gapMarginPpm; bool enabled; }
struct LaneParams  { uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps; uint16 durationSec;
                     bool enabled; uint128 minStake; uint128 maxStake; }
struct Lane        { LaneParams p; uint32 version; }

struct Round {
    address player; uint8 assetId; uint8 tier; Direction direction; RoundStatus status;
    Outcome outcome; bool cashOutRequested; uint8 oracleIdx; uint40 entrySec;
    uint128 stake; uint128 maxPayout;
    uint32 targetPpm; uint32 stopPpm; uint32 multiplierBps; uint16 feeBps;
    uint32 maxJumpPpm; uint32 pairId; uint40 endSec; uint40 openedAt;
    uint128 payout; uint40 decisionSec; VoidReason voidReason;
}
struct RoundTerms { uint8 tier; Direction direction; uint128 stake; uint128 maxPayout; uint40 entrySec; uint40 endSec;
                    uint32 laneVersion; uint8 oracleIdx; uint32 pairId; uint32 targetPpm; uint32 stopPpm;
                    uint32 multiplierBps; uint16 feeBps; uint32 maxJumpPpm; }

struct OpenRoundIntent { address player; uint8 assetId; uint8 tier; Direction direction; uint128 stake;
                         uint32 laneVersion; uint8 oracleIdx; uint256 nonce; uint48 deadline; }
struct CashOutIntent   { address player; uint256 roundId; uint48 deadline; }
struct WithdrawIntent  { address player; address to; uint256 amount; uint256 nonce; uint48 deadline; }

interface IPriceVerifier {
    struct VerifiedPrice { uint32 pairId; uint64 roundMs; uint64 tsMs; uint256 price18; }
    function verify(bytes calldata proof) external returns (VerifiedPrice[] memory); // Supra may return a NEWER stored round
    function latestRoundMs(uint32 pairId) external view returns (uint64);           // Supra: storage.getRound(pair)
    function supportsLateVerification() external view returns (bool);              // Supra false, Signed true
    function sourceId() external view returns (bytes32);                            // "SUPRA_DORA2_PULL_V2" | "SIGNED_BACKEND_V1"
    function isTrusted() external view returns (bool);                              // true only for the signed backup
}

interface ICheckpointOracle {
    struct Checkpoint { uint128 price18; uint64 tsMs; uint8 flags; } // bit0 RECORDED, bit1 DISPUTED
    event CheckpointRecorded(uint32 indexed pairId, uint40 indexed sec, uint128 price18, uint64 tsMs);
    event CheckpointDisputed(uint32 indexed pairId, uint40 indexed sec, uint128 recorded, uint128 conflicting);
    function verifier() external view returns (IPriceVerifier);
    function record(bytes calldata proof) external returns (uint256 newlyRecorded);            // permissionless
    function get(uint32 pairId, uint40 sec) external view returns (Checkpoint memory);
    function getRange(uint32 pairId, uint40 fromSec, uint40 toSec) external view returns (Checkpoint[] memory); // <= 256
    function lastRecordedSec(uint32 pairId) external view returns (uint40);
    function latestKnownSec(uint32 pairId) external view returns (uint40);        // max(lastRecorded, verifier.latestRoundMs/1000)
    function isPermanentlyMissing(uint32 pairId, uint40 sec) external view returns (bool); // !recorded && !late && latestKnown > sec
}

interface IBnbPlayArena {
    function deposit(uint256 amount) external;
    function depositFor(address player, uint256 amount) external;                  // pulls from msg.sender
    function withdraw(address to, uint256 amount) external;
    function withdrawWithSig(WithdrawIntent calldata w, bytes calldata sig) external;

    function openRound(uint8 assetId, uint8 tier, Direction d, uint128 stake, uint32 laneVersion, uint8 oracleIdx)
        external returns (uint256 roundId);                                        // msg.sender = player; consumes nonce key 0
    function openRoundWithSig(OpenRoundIntent calldata i, bytes calldata sig) external returns (uint256 roundId);
    function requestCashOut(uint256 roundId) external returns (uint40 exitSec);
    function requestCashOutWithSig(CashOutIntent calldata c, bytes calldata sig) external returns (uint40 exitSec);

    // permissionless, never paused
    function settle(uint256 roundId) external returns (Outcome outcome, uint256 payout);
    function settleMany(uint256[] calldata roundIds) external;                     // skips non-decidable
    function recordAndSettle(uint8 oracleIdx, bytes calldata proof, uint256[] calldata roundIds) external; // <= 100 ids
    function voidStale(uint256 roundId) external;

    function previewSettle(uint256 roundId) external view
        returns (bool decidable, Outcome outcome, uint256 payout, uint40 decisionSec, uint40 missingSec);
    function getRound(uint256 roundId) external view returns (Round memory);
    function quoteMaxPayout(uint8 assetId, uint8 tier, uint128 stake) external view returns (uint256);
    function hashOpenRound(OpenRoundIntent calldata) external view returns (bytes32);
    function hashCashOut(CashOutIntent calldata) external view returns (bytes32);
    function hashWithdraw(WithdrawIntent calldata) external view returns (bytes32);
    function nonces(address owner, uint192 key) external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function activeRoundOf(address) external view returns (uint256);
    function getAsset(uint8 assetId) external view returns (AssetConfig memory);
    function getLane(uint8 assetId, uint8 tier) external view returns (Lane memory);
    function oracles(uint256 idx) external view returns (ICheckpointOracle);
    function activeOracleIdx() external view returns (uint8);
    function houseFree() external view returns (uint256);
    function houseReserved() external view returns (uint256);
    function stakesLocked() external view returns (uint256);
    function totalPlayerBalances() external view returns (uint256);
    function surplus() external view returns (uint256);

    function fundHouse(uint256 amount) external;                                   // anyone
    function withdrawHouse(address to, uint256 amount) external;                   // TREASURY, <= houseFree
    function skim() external;                                                      // surplus -> houseFree
    function setAsset(uint8 assetId, AssetConfig calldata c) external;             // CONFIG
    function setLane(uint8 assetId, uint8 tier, LaneParams calldata p) external;   // CONFIG, validates, version++
    function setLimits(uint16 maxUtilizationBps, uint128 maxPayoutPerRound) external; // CONFIG
    function addOracle(ICheckpointOracle o) external;                              // CONFIG, append-only
    function setActiveOracle(uint8 idx) external;                                  // CONFIG, new rounds only
    function pause() external;                                                     // PAUSER (blocks opens only)
    function unpause() external;                                                   // DEFAULT_ADMIN

    event RoundOpened(uint256 indexed roundId, address indexed player, uint8 indexed assetId, RoundTerms terms);
    event CashOutRequested(uint256 indexed roundId, address indexed player, uint40 requestedAt, uint40 exitSec);
    event RoundSettled(uint256 indexed roundId, address indexed player, Outcome indexed outcome, uint256 payout,
                       int256 pnl, uint256 entryPrice, uint256 exitPrice, uint40 decisionSec, VoidReason voidReason);
    event Deposited(address indexed player, address indexed from, uint256 amount);
    event Withdrawn(address indexed player, address indexed to, uint256 amount);
    event HouseFunded(address indexed from, uint256 amount);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event Skimmed(uint256 amount);
    event AssetConfigured(uint8 indexed assetId, AssetConfig config);
    event LaneConfigured(uint8 indexed assetId, uint8 indexed tier, uint32 indexed version, LaneParams params);
    event LimitsUpdated(uint16 maxUtilizationBps, uint128 maxPayoutPerRound);
    event OracleAdded(uint8 indexed idx, address oracle, bytes32 sourceId, bool trusted);
    event ActiveOracleSet(uint8 indexed idx);
}
```

Custom errors (names are frozen because the backend maps them to API codes):
`InvalidSignature`, `IntentExpired(uint48)`, `AssetDisabled(uint8)`, `LaneDisabled(uint8,uint8)`, `LaneVersionMismatch(uint32,uint32)`, `OracleMismatch(uint8,uint8)`, `StakeOutOfRange(uint256,uint256,uint256)`, `InsufficientBalance(uint256,uint256)`, `PlayerHasOpenRound(uint256)`, `InsufficientHouseLiquidity(uint256,uint256)`, `UtilizationCapExceeded(uint256,uint256)`, `MaxPayoutExceeded(uint256,uint256)`, `EntryNotInFuture(uint40,uint40)`, `ExitNotInFuture(uint40,uint40)`, `RoundNotOpen(uint256)`, `NotRoundPlayer(uint256,address)`, `CashOutAlreadyRequested(uint256)`, `CashOutTooLate(uint256,uint40,uint40)`, `NotDecidable(uint256,uint40)`, `NotVoidable(uint256,uint256)`, `InvalidLane()`, `HouseEdgeViolated()`, `ZeroAmount()`.

`SupraPriceVerifier` reverts `NonCanonicalRound` unless `round % 1000 == 0 && ts >= round && ts - round < 1000`, and requires `0 < price <= type(uint128).max` after scaling to 18 decimals.

## 4. EIP-712

Arena domain: `("BnbPlayArena", "1", chainId, arena)` (OZ `EIP712`, ERC-5267). Type strings, identical to `packages/shared/src/eip712.ts` `TYPE_STRINGS`:

```
OpenRound(address player,uint8 assetId,uint8 tier,uint8 direction,uint128 stake,uint32 laneVersion,uint8 oracleIdx,uint256 nonce,uint48 deadline)
CashOut(address player,uint256 roundId,uint48 deadline)
Withdraw(address player,address to,uint256 amount,uint256 nonce,uint48 deadline)
SessionGrant(address player,address sessionKey,uint128 maxStakePerRound,uint128 stakeAllowance,uint48 expiry,uint256 nonce)   // P1, not in P0
```

- Nonces use `NoncesKeyed`: key 0 = open, 1 = withdraw, 2 = session. The intent's `nonce` field is the **packed** value `(key << 64) | sequence`, exactly what `nonces(owner, key)` returns. Clients use `packKeyedNonce` from `packages/shared/src/eip712.ts`.
- Direct calls also consume the nonce, which cancels any pending signed intent.
- CashOut is bound to `roundId` and carries no nonce.
- Signature check order: ECDSA first (EOA and EIP-7702 accounts), then ERC-1271 via staticcall.

## 5. Constants

`ENTRY_DELAY_SEC = 2`, `EXIT_DELAY_SEC = 2`, `STALL_AFTER_SEC = 300`, `MAX_RANGE = 256`, `MAX_IDS = 100`.

| Parameter | Allowed range |
|---|---|
| Duration D | [5, 120] s |
| M | [10001, 100000] bps |
| Fee | ≤ 1000 bps |
| T, S | [10, 100000] ppm |

At most one open round per player (`activeRoundOf`).

## 6. Arithmetic (mirror of `lane.ts`)

```solidity
// PPM = 1e6, BPS = 1e4; every division floors (house-favourable)
directional(d, p0, p): if p >= p0 { mag = p - p0; fav = d == Long || mag == 0 } else { mag = p0 - p; fav = d == Short }
touch(fav, mag, p0, T, S): fav ? (mag*1e6 >= T*p0 ? TARGET : NONE) : (mag*1e6 >= S*p0 ? STOP : NONE)   // inclusive
maxPayout(stake, M)       = mulDiv(stake, M, 1e4)
interior (fav)            : den = p0*T; num = 1e4*den + (M-1e4)*mag*1e6; mulDiv(stake, num*(1e4-fee), den*1e8)
interior (unfav)          : d = p0*S; mulDiv(stake, (d - mag*1e6)*(1e4-fee), d*1e4)
jumpOk(prev, p, J)        : |p - prev|*1e6 <= J*prev                                                      // inclusive
setLane guard             : (M-1e4)*S + max(0, M-2e4)*gapMarginPpm <= 1e4*T   else HouseEdgeViolated
```

## 7. Settlement algorithm (mirror of `path.ts` `evaluatePath`)

1. `cp = getRange(pairId, entrySec, endSec)`. `endSec` is already shortened when a cash-out was requested.
2. **Entry:**
   - Not recorded → missing handling at `entrySec` (step 4).
   - Disputed → **void `EntryInvalid`**.
   - Otherwise `p0 = entry.price18` and `prev = p0`.
3. **For `sec = entrySec+1 … endSec`:**
   - Not recorded → missing handling at `sec`.
   - `valid = !disputed && jumpOk(prev, price, maxJumpPpm)`, then set `prev = price`. **`prev` always updates, even for invalid checkpoints.**
   - Invalid:
     - at `endSec` → **void `TerminalInvalid`**;
     - earlier → skip the second (no barrier evaluated).
   - Valid:
     - target touch → `TargetHit`, payout `maxPayout`;
     - stop touch → `StopHit`, payout 0;
     - no touch at `endSec` → `CashedOut` (if requested) or `Timeout`, payout `interior(...)`.
   - `decisionSec = sec` in all cases.
4. **Missing handling:**
   - `isPermanentlyMissing(sec)` → **void `CheckpointGap`**;
   - otherwise `block.timestamp > endSec + 300` → **void `Stalled`**;
   - otherwise revert `NotDecidable(roundId, sec)` (`previewSettle` returns `decidable = false, missingSec`).
5. **Payouts and events:**
   - A void pays exactly `stake`.
   - `RoundSettled.entryPrice = p0` (0 if entry is invalid).
   - `exitPrice` = the checkpoint price at `decisionSec` (0 for voids). This is the real sampled price (PRD §37), not the threshold.

**Guards:**
- open: `entrySec = now + 2 > latestKnownSec(pair)`.
- cash-out: `exitSec = max(now + 2, entrySec + 1)` must be `> latestKnownSec(pair)` and `< endSec` (else `CashOutTooLate`). On success `endSec = exitSec` and `cashOutRequested = true`.

## 8. Ledger

| Step | Effect |
|---|---|
| Open | `balanceOf[p] -= stake`; `stakesLocked += stake`; `houseFree -= (maxP - stake)`; `houseReserved += (maxP - stake)`. Requires `houseReserved*1e4 <= util*(houseFree + houseReserved)` and `maxP <= maxPayoutPerRound` |
| Settle | player `+= payout` (a void pays `stake`); `houseFree += maxP - payout`; release both locks; clear `activeRoundOf` |
| Pause | blocks new opens only; never cash-out / record / settle / void / withdraw |

Admin can never touch open rounds or player balances.

## 9. Invariants (Foundry invariant suite)

1. `token.balanceOf(arena) == totalPlayerBalances + houseFree + houseReserved + stakesLocked + surplus`
2. Balance ≥ Σ player balances + Σ open `maxPayout`
3. `stakesLocked + houseReserved == Σ open maxPayout`
4. Payout ≤ maxPayout; TargetHit = maxPayout, StopHit = 0, Voided = stake
5. A round settles exactly once
6. `activeRoundOf[p]` is 0 or an open round owned by p
7. A round's snapshot never changes after `setLane` / `setActiveOracle`
8. Pause never blocks cash-out, record, settle, void or withdraw
9. Every non-void outcome equals the reference evaluation of the ghost price path
10. Checkpoints are write-once
11. Nonces are monotonic

## 10. Tests (required for G1)

| Suite | Contents |
|---|---|
| Unit | Exact T/S equality; LONG/SHORT symmetry; fee rounding; entry/exit guards; `CashOutTooLate`; barrier wins at the exit second; every void kind; version/oracle mismatch; replay/deadline; one-round cap; utilisation/max-payout caps; pause matrix; ERC-1271 + 7702 signatures; faucet cooldown/cap; permit |
| Fuzz | Payout ≤ max; monotone in price; LONG/SHORT mirror; rounding favours the house; random 21-point paths vs the reference |
| Invariant | Handler with 5 players + in-order recorder + **griefer** that pushes newer mock rounds to create gaps + admin actions + donations |
| Differential | Read `../packages/shared/vectors/{lane,path,eip712}-vectors.json` field by field (big numbers are decimal strings); assert every case. Add `fs_permissions = [{ access = "read", path = "../packages/shared/vectors" }]` |
| Fork (97) | Using `research/fixtures/supra-97-*.json` (captured by A1): fork just before the capture block, record the proofs in order, assert prices/gas, then replay an older proof and assert the stored-value behaviour (F1) |

`MockSupraPull` must reproduce F1: if the proof round is not newer than the stored one, return the stored value.

## 11. Deploy

1. Create `contracts/config/97.json` with:
   - Supra addresses and pairs;
   - delays and limits;
   - lanes from `research/lane-params.json`;
   - faucet parameters;
   - house seed of 1,000,000 tUSD;
   - relayer/recorder/ops addresses.
2. Run:
   ```
   forge script script/Deploy.s.sol --rpc-url bsc_testnet --account bnbplay-deployer --broadcast --slow --legacy --with-gas-price 100000000 --verify
   ```
   using `[etherscan] bsc_testnet = { key = "${ETHERSCAN_API_KEY}", chain = 97 }`. The script writes `deployments/97.json` (addresses, start block, git commit).
3. Run `script/Smoke.s.sol`: faucet → open → record ×21 → settle.
4. A0 runs `abi:sync` to export the ABIs and addresses into `packages/shared/src/chain/` (F2).
