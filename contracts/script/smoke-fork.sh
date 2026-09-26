#!/usr/bin/env bash
# Deploy.s.sol + Smoke.s.sol on a LOCAL anvil fork of chain 97, driven by the A1 fixture proofs (real BLS).
# Nothing is sent to testnet. Uses anvil's public dev key #0 and port 8547 (agent A2).
#
#   script/smoke-fork.sh            # from contracts/
#
# The fork starts ~90 s before the fixture so anvil's clock can be positioned on the fixture's seconds:
#   open at R0-3 (entry = R0) → cash-out at R0+18 (exit = R0+20) → record 21 proofs → settle.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC_URL="${BSC_TESTNET_RPC_URL:-https://bsc-testnet-rpc.publicnode.com}"
PORT="${ANVIL_PORT:-8547}"
LOCAL="http://127.0.0.1:${PORT}"
FORK_BLOCK=133261658       # fixture blockBeforeFirstProof (133261858) - 200 blocks
R0=1790414769              # fixture proofs[0] round (s)
KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil dev account #0 (public)
LOCK=/tmp/bnbplay-heavy.lock

anvil --port "$PORT" --fork-url "$RPC_URL" --fork-block-number "$FORK_BLOCK" --chain-id 97 --silent &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 1; done
# every new block is exactly +1 s, independent of wall-clock time spent compiling/simulating
cast rpc --rpc-url "$LOCAL" anvil_setBlockTimestampInterval 1 >/dev/null

at() { # mine an empty block at timestamp $1 so both the script simulation and the broadcast see that clock
  cast rpc --rpc-url "$LOCAL" evm_setNextBlockTimestamp "$1" >/dev/null
  cast rpc --rpc-url "$LOCAL" evm_mine >/dev/null
}
run() { # forge script under the shared RAM mutex; no RPC caching (anvil reuses chain 97 block numbers)
  flock -w 1800 "$LOCK" forge script "$@" --rpc-url "$LOCAL" --private-key "$KEY0" --broadcast --slow --no-storage-caching
}

export LOCAL_ROLES=true DEPLOYMENTS_OUT=deployments/local-97.json
at $((R0 - 80))
run script/Deploy.s.sol:Deploy
echo "deployed: $(cat "$DEPLOYMENTS_OUT")"

ARENA=$(python3 -c "import json;print(json.load(open('$DEPLOYMENTS_OUT'))['arena'])")
now() { cast block latest -f timestamp --rpc-url "$LOCAL"; }
entry_of() { # entrySec of round 1 (9th field of Round)
  cast call --rpc-url "$LOCAL" "$ARENA" \
    "getRound(uint256)((address,uint8,uint8,uint8,uint8,uint8,bool,uint8,uint40,uint128,uint128,uint32,uint32,uint32,uint16,uint32,uint32,uint40,uint40,uint128,uint40,uint8))" 1 \
    | tr -d '()' | tr ',' '\n' | sed -n 9p | awk '{print $1}'
}

at $((R0 - 5))
SMOKE_STEP=open run script/Smoke.s.sol:Smoke
ENTRY=$(entry_of)
echo "entrySec=$ENTRY (fixture R0=$R0), chain now=$(now)"
[ "$ENTRY" -ge "$R0" ] && [ $((ENTRY + 20)) -le $((R0 + 22)) ] || { echo "entry outside the fixture window"; exit 1; }
at $((ENTRY + 17))
SMOKE_STEP=cashout run script/Smoke.s.sol:Smoke       # mined at entry+18 → exit entry+20: 21 checkpoints
echo "chain now=$(now)"
at $((R0 + 23 + 1))
SMOKE_STEP=settle run script/Smoke.s.sol:Smoke
echo "smoke: OK"
