# BNB PLAY contracts

Foundry project: solc 0.8.30, EVM cancun, optimizer 1000 runs, **via-IR** (the Arena exceeds EIP-170 without it).
Dependencies come from Soldeer (`forge-std` 1.16.2, `@openzeppelin-contracts` 5.7.0), with no git submodules.
The spec is `docs/spec/F1a-contracts.md` (v2) and the lane table is `docs/spec/F1e-lanes.md` (`config/97.json`).

## Commands

Run every heavy command under the shared RAM mutex: `flock -w 1800 /tmp/bnbplay-heavy.lock <cmd>`.

```bash
forge soldeer install                  # fetch deps (first checkout)
forge build --sizes
forge test                             # unit, fuzz (1024), invariant (256 x 128), differential; fork suite skips
forge test --fork-url https://bsc-testnet-rpc.publicnode.com --match-path 'test/fork/*' --threads 1 \
  --fork-retries 10 --fork-retry-backoff 2000       # archive RPC; bnbchain.org RPCs prune state
forge test --match-contract GasTest -vv            # gas of the hot paths (mock BLS); fork suite prints real BLS
script/smoke-fork.sh                   # Deploy + Smoke on a local anvil fork of 97 (port 8547), fixture proofs
```

Testnet deploy (A0 only, with the user's keys):

```bash
GIT_COMMIT=$(git rev-parse HEAD) forge script script/Deploy.s.sol --rpc-url bsc_testnet \
  --account bnbplay-deployer --broadcast --slow --legacy --with-gas-price 100000000 --verify
```

The deploy writes `deployments/97.json`, shaped like `Deployment` in `packages/shared/src/chain.ts`.

Other scripts:
- `ConfigureLanes.s.sol` re-applies the lanes in the config and writes only the ones that changed.
- `SeedLiquidity.s.sol` tops the house up to `HOUSE_TARGET`.
- `Smoke.s.sol` runs one step per call: `SMOKE_STEP=open|cashout|settle`.

## Trust model

1. Prices come only from Supra DORA-2 proofs. `StatelessSupraVerifier` checks each committee's BLS signature (Supra's `requireHashVerified_V2`) and the little-endian leaf multiproof, then records one immutable price per (pair, second) in `CheckpointOracle`.
2. Recording is permissionless and late records are valid, so nobody can censor a second or force a gap. A conflicting verified price only raises a DISPUTED flag.
3. A player commits without knowing the price. The entry is the checkpoint at `block.timestamp + 3`, and a cash-out exits at a second not yet recorded.
4. Settlement replays the full recorded path, and the first barrier touched wins. It mirrors `packages/shared/src/path.ts` bit for bit, and every division rounds in favour of the house.
5. The operator is trusted for liveness only. If data is missing, the round voids and the stake is refunded, after `STALL_AFTER_SEC` = 60 s or once a gap is provably permanent. `voidStale` also refunds when an oracle becomes unreadable.
6. There is no relayer or keeper role. Settle, record, cash-out, withdraw and void are permissionless and never paused. Pause blocks new opens only.
7. Admin roles are CONFIG, PAUSER and TREASURY. They configure new rounds only: each round snapshots its terms, so admins can never move player balances or touch open rounds. Treasury withdrawals are capped at `houseFree`.
8. Oracles are append-only. Rotating Supra's verifier or keys means deploying a new verifier and oracle, then calling `addOracle` and `setActiveOracle`, which affects new rounds only.
9. `SignedPriceVerifier` (a backend key) is a labelled backup: its `isTrusted()` returns true. `SupraPriceVerifier` is the stateful P1 fallback, where the F1 guard is enforced and gaps can become permanent.
10. The ledger is conserved: `token.balanceOf(arena) == players + houseFree + houseReserved + stakesLocked + surplus`. This is asserted by the invariant suite.
