#!/usr/bin/env bash
# KineLab runtime supervisor: starts the RTMW worker + verifies OpenSim,
# with typed failures (never silent). Used by runtime_up.sh and CI smoke.
# Usage: bash services/biomechanics/scripts/rtmw_supervise.sh [--port 8102] [--no-start]
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNTIME="$ROOT/services/biomechanics/runtime"
RTMW_PY="$RUNTIME/kinelab-rtmw/bin/python"
PORT="${KINELAB_RTMW_PORT:-8102}"
START=1
for a in "$@"; do
  case "$a" in
    --port=*) PORT="${a#--port=}" ;;
    --no-start) START=0 ;;
  esac
done
fail() { echo "KINELAB_RTMW_SUPERVISE: $1" >&2; exit "${2:-1}"; }
"$RTMW_PY" -c "import mmdet, mmpose, torch; print('stub:', mmdet.__file__)" 2>/dev/null \
  || fail "RTMW venv missing/incompatible — run: bash services/biomechanics/scripts/provision_rtmw.sh" 2
if curl -s -m 5 "http://127.0.0.1:${PORT}/health" | grep -q '"modelLoaded": *true'; then
  echo "RTMW worker :${PORT} healthy"
  exit 0
fi
[ "$START" -eq 0 ] && fail "RTMW worker :${PORT} not healthy (--no-start)" 3
[ -f "$ROOT/services/biomechanics/models/rtmw/rtmw-l_256x192.pth" ] \
  || fail "checkpoint missing: services/biomechanics/models/rtmw/rtmw-l_256x192.pth" 4
CFG="$(find /tmp /opt /root "$HOME" -maxdepth 6 -name "rtmw-l_8xb1024-270e_cocktail14-256x192.py" 2>/dev/null | head -1)"
[ -n "$CFG" ] || fail "mmpose config checkout missing (need mmpose 1.3.2 configs for --config)" 5
LOG="/tmp/rtmw_worker_${PORT}.log"
cd "$RUNTIME" && nohup "$RTMW_PY" rtmw_worker.py --port "$PORT" --config "$CFG" >"$LOG" 2>&1 &
for _ in $(seq 1 24); do
  sleep 5
  curl -s -m 5 "http://127.0.0.1:${PORT}/health" | grep -q '"modelLoaded": *true' && {
    echo "RTMW worker :${PORT} started (log $LOG)"
    curl -s -m 5 "http://127.0.0.1:${PORT}/health"
    echo
    exit 0
  }
done
fail "RTMW worker :${PORT} failed to become healthy (log $LOG)" 6
