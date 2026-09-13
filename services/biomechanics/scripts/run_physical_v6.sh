#!/usr/bin/env bash
# KineLab physical V6 validation session runner (V6.1 Phase 31).
#
#   scripts/run_physical_v6.sh <capture-bundle> [trialStartS] [trialEndS]
#
# 1. inspect bundle  2. verify hashes  3. validate calibration
# 4. validate sync   5. check runtimes  6. import session
# 7. run Precision   8. write validation report (validation/V6/<session-id>/)
set -u
BUNDLE="${1:-}"; TRIAL_START="${2:-}"; TRIAL_END="${3:-}"
if [ -z "$BUNDLE" ]; then echo "usage: run_physical_v6.sh <bundle> [startS] [endS]" >&2; exit 1; fi
SVC="$(cd "$(dirname "$0")/../" && pwd)"
BACKEND="${KINELAB_BACKEND_URL:-http://127.0.0.1:8100}"
OUT="validation/V6"

python3 "$SVC/scripts/kinelab_capture.py" inspect "$BUNDLE" || {
  echo "BUNDLE NOT PRECISION-ELIGIBLE — fix capture before processing" >&2; exit 2; }

echo "--- runtimes ---"
curl -sf "$BACKEND/" >/dev/null && echo "backend: $BACKEND OK" || { echo "backend unreachable at $BACKEND" >&2; exit 3; }

echo "--- import ---"
IMPORT_JSON=$(python3 - "$BUNDLE" "$BACKEND" <<'EOF'
import json, sys, urllib.request
bundle, backend = sys.argv[1], sys.argv[2]
body = json.dumps({"bundlePath": bundle}).encode()
req = urllib.request.Request(backend + "/capture/import", data=body,
                             headers={"Content-Type": "application/json"})
print(json.dumps(json.load(urllib.request.urlopen(req))))
EOF
)
echo "$IMPORT_JSON" | python3 -m json.tool
READY=$(echo "$IMPORT_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('readyForPrecision'))")
SID=$(echo "$IMPORT_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sessionId','unknown'))")
[ "$READY" = "True" ] || { echo "session not readyForPrecision" >&2; exit 4; }

echo "--- precision ---"
mkdir -p "$OUT/$SID"
EXTRA=""
[ -n "$TRIAL_START" ] && EXTRA="$EXTRA, \\\"trialStartS\\\": $TRIAL_START"
[ -n "$TRIAL_END" ] && EXTRA="$EXTRA, \\\"trialEndS\\\": $TRIAL_END"
python3 - "$BACKEND" "$SID" "$EXTRA" "$OUT/$SID" <<'EOF' > "$OUT/$SID/processing-report.json"
import json, sys, urllib.request
backend, sid, extra, outdir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
body = ("{\"physicalSessionId\": \"" + sid + "\"" + extra + "}").encode()
req = urllib.request.Request(backend + "/precision/process_capture", data=body,
                             headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=1200) as r:
    print(json.dumps(json.load(r), indent=2))
EOF
python3 -m json.tool "$OUT/$SID/processing-report.json" > /dev/null \
  && echo "report: $OUT/$SID/processing-report.json"
