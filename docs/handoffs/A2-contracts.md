# A2 — Smart contracts (W2)

**Branch:** `feat/a2-contracts` · **Worktree:** `…/Tagei-worktrees/a2-contracts` · **Owns:** `contracts/**` only

## Read first

- `CLAUDE.md`
- `docs/spec/F0-repo.md`
- **`docs/spec/F1a-contracts.md`** (the full spec: interfaces, arithmetic, settlement algorithm, invariants, tests, deploy)
- `packages/shared/src/{lane,path,eip712,constants,enums,assets}.ts`, which are the reference implementation you mirror
- `research/spike-report.md`, `research/lane-params.json`, `research/fixtures/` (from A1)

## Deliverables

1. Scaffold the Foundry project:
   - `forge init --no-git contracts`;
   - dependencies via **Soldeer** (`forge soldeer install forge-std~1 @openzeppelin-contracts~5.7.0`, remap `@openzeppelin/contracts/=dependencies/@openzeppelin-contracts-5.7.0/`), **no git submodules**;
   - `foundry.toml`: solc 0.8.30, evm `cancun`, optimizer 1000 runs; fuzz runs 1024; invariant runs 256 / depth 128;
   - `fs_permissions` read for `./test/fixtures`, `./config`, `../packages/shared/vectors`, `../research/fixtures`; read-write for `./deployments`;
   - `[rpc_endpoints] bsc_testnet = "${BSC_TESTNET_RPC_URL}"`;
   - `[etherscan] bsc_testnet = { key = "${ETHERSCAN_API_KEY}", chain = 97 }`.
2. Contracts per F1a §2–§8:
   - `src/BnbPlayArena.sol`
   - `src/types/ArenaTypes.sol`
   - `src/libraries/{LaneMath,Intents}.sol`
   - `src/oracle/{CheckpointOracle,StatelessSupraVerifier,SignedPriceVerifier}.sol` (port `research/poc/src/StatelessSupraVerifier.sol`, using OZ `MerkleProof.multiProofVerify`; the stateful `SupraPriceVerifier` is optional P1)
   - `src/oracle/interfaces/*` (vendored `ISupraOraclePull`, `ISupraSValueFeed`, plus ours)
   - `src/token/{TestUSD,TestUSDFaucet}.sol`
3. Mocks:
   - `test/mocks/MockSupraCommitteeVerifier.sol`, whose `requireHashVerified_V2` accepts roots registered by the test. Tests use it to build synthetic 5-pair proofs (LE leaves + OZ multiproof) for any price path.
   - `MockCheckpointOracle.sol` for pure Arena tests.
   - `MockSupraPull.sol` only if you build the stateful P1 fallback.
4. Tests per F1a §10: unit, fuzz, invariant (with the griefer handler), **differential** against `../packages/shared/vectors/*.json` (every case), and fork against `../research/fixtures/supra-97-*.json`.
5. Scripts:
   - `script/Deploy.s.sol` (reads `config/97.json`, writes `deployments/97.json`);
   - `ConfigureLanes.s.sol`;
   - `SeedLiquidity.s.sol`;
   - `Smoke.s.sol` (faucet → open → record ×21 → settle on a fork or testnet).
6. `contracts/README.md`: commands and the trust model in 10 lines.

## Definition of done (G1)

- `cd contracts && forge build && forge test` all green, including invariant and differential; `forge test --fork-url $BSC_TESTNET_RPC_URL --match-path test/fork/*` green.
- Gas report for `openRoundWithSig`, `requestCashOutWithSig`, `record` (5 pairs), `recordAndSettle`, `settle` (21 s path).
- `Deploy.s.sol` + `Smoke.s.sol` pass on a local anvil fork of chain 97 (`anvil --fork-url …`, default funded accounts).
- **Do not broadcast to testnet.** A0 does the testnet deploy with the user's keys at G1.

## Constraints

- Never edit outside `contracts/`. Any mismatch with `packages/shared` is a change request to A0, never a local workaround.
- Every rounding favours the house. Pause blocks opens only.
- No relayer or keeper roles: everything except config is permissionless.
