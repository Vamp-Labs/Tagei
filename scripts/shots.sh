#!/usr/bin/env bash
set -euo pipefail

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="${RESKIN_LOCK:-${TMPDIR:-/tmp}/bnbplay-heavy.lock}"
LOCK_WAIT_SECONDS=1800
SERVER_WAIT_TICKS=300

usage() {
  cat <<'EOF'
Usage: bash scripts/shots.sh --port N --out DIR (--scenes a,b | --all | --path P) [--reduced] [--keep-server]
       [--query "dir=SHORT"] [--jobs N] [--click CSS] [--hold CSS:MS] [--wait MS] [--eval JS]
Takes the shared heavy-work lock ($RESKIN_LOCK) for the whole run, starts Vite on 127.0.0.1:N
unless that port already answers, shoots with scripts/shots.mjs and stops only the Vite it started.
Never run it inside another flock on the same lock file.
EOF
}

PORT=""
OUT=""
KEEP=0
FORWARD=()
while (($#)); do
  case "$1" in
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --out) OUT="${2:?--out needs a value}"; shift 2 ;;
    --out=*) OUT="${1#*=}"; shift ;;
    --keep-server) KEEP=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) FORWARD+=("$1"); shift ;;
  esac
done

if [[ -z "$PORT" || -z "$OUT" ]]; then
  usage >&2
  exit 2
fi
OUT="$(realpath -m "$OUT")"
if [[ "$OUT" == "$WT/screenshots" || "$OUT" == "$WT/screenshots/"* ]]; then
  echo "shots.sh: refusing to write into $WT/screenshots" >&2
  exit 2
fi

mkdir -p "$(dirname "$LOCK")" "$OUT"
exec 9>>"$LOCK"
if ! flock -w "$LOCK_WAIT_SECONDS" 9; then
  echo "shots.sh: timed out waiting for $LOCK" >&2
  exit 75
fi

URL="http://127.0.0.1:$PORT/"
VITE_PID=""

answers() {
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL" 2>/dev/null)" == "200" ]]
}

stop_server() {
  if [[ -n "$VITE_PID" && "$KEEP" -eq 0 ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap stop_server EXIT
trap 'exit 130' INT TERM

if ! answers; then
  LOG_DIR="${RESKIN_TMP:-${TMPDIR:-/tmp}}"
  mkdir -p "$LOG_DIR"
  LOG="$LOG_DIR/shots-vite-$PORT.log"
  (cd "$WT" && exec "$WT/node_modules/.bin/vite" --port "$PORT" --strictPort --host 127.0.0.1) >"$LOG" 2>&1 9>&- &
  VITE_PID=$!
  for ((tick = 0; tick < SERVER_WAIT_TICKS; tick++)); do
    answers && break
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      echo "shots.sh: Vite exited early, log follows" >&2
      cat "$LOG" >&2
      VITE_PID=""
      exit 1
    fi
    sleep 0.1
  done
  if ! answers; then
    echo "shots.sh: Vite did not answer on $URL" >&2
    exit 1
  fi
  if [[ "$KEEP" -eq 1 ]]; then
    echo "shots.sh: leaving Vite running as PID $VITE_PID (log $LOG)" >&2
  fi
fi

node "$WT/scripts/shots.mjs" --base "$URL" --out "$OUT" "${FORWARD[@]}" 9>&-
