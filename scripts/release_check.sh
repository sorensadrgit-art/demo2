#!/usr/bin/env bash
# KineLab one-command software release gate (no hardware required).
# Frontend unit + typecheck + build, backend tests, capture ingest tests,
# security tests, production smoke (import + version + readiness).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail() { echo "RELEASE_CHECK FAILED: $1"; exit 1; }

echo "== frontend unit =="; npx vitest run || fail "vitest"
echo "== typecheck =="; npx tsc --noEmit || fail "tsc"
echo "== build =="; npm run build || fail "build"
echo "== backend =="; python3 -m pytest services/biomechanics/tests -q || fail "backend tests"
echo "== production smoke =="
python3 - <<'EOF' || fail "smoke"
import sys
sys.path.insert(0, "services/biomechanics")
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
assert c.get("/health").status_code == 200, "health"
v = c.get("/version").json()
assert v.get("precisionPipeline") == "kinelab-precision-v5.6", "pipeline version"
r = c.get("/ready").json()
assert r.get("status") in ("APP_READY", "PRECISION_DEGRADED"), "readiness"
rid = c.get("/", headers={"x-request-id": "req-smoke"}).headers.get("x-request-id")
assert rid == "req-smoke", "request-id propagation"
print("smoke OK:", v.get("precisionPipeline"), r.get("status"))
EOF
echo "ALL RELEASE CHECKS PASSED (software gate; physical/clinical pending)"
