#!/usr/bin/env bash
# KineLab release doctor: PASS / WARN / BLOCK across git, version, env,
# build, backend import, model assets, storage, channel, license blockers.
set -u
PASS=0; WARN=0; BLOCK=0
say() { printf '%s %s\n' "$1" "$2"; }
ok() { PASS=$((PASS+1)); say PASS "$1"; }
warn() { WARN=$((WARN+1)); say WARN "$1"; }
block() { BLOCK=$((BLOCK+1)); say BLOCK "$1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

[ -n "$(git status --porcelain 2>/dev/null)" ] && warn "worktree dirty" || ok "worktree clean"
HEAD="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
ok "HEAD $HEAD on $(git branch --show-current 2>/dev/null || echo unknown)"

[ "${KINELAB_RELEASE_CHANNEL:-RESEARCH_PREVIEW}" = "CLINICAL_PRODUCTION" ] \
  && block "CLINICAL_PRODUCTION channel not offered in R1" \
  || ok "channel ${KINELAB_RELEASE_CHANNEL:-RESEARCH_PREVIEW}"

case ",${KINELAB_CORS_ORIGINS:-}," in
  *,*\**,*) block "CORS contains wildcard *" ;;
  *) ok "CORS explicit (${KINELAB_CORS_ORIGINS:-dev-default})" ;;
esac

[ -f .env ] && warn ".env present locally (never commit)" || ok "no .env committed"
git ls-files | grep -qiE '\.pth$|venv/|node_modules/|dist/' \
  && block "weights/venv/build tracked" || ok "no weights/venv/build tracked"

python3 -c "import sys; sys.path.insert(0,'services/biomechanics'); from app.config import validate_startup; p=validate_startup(); print('config problems:', p); raise SystemExit(1 if p else 0)" \
  && ok "backend config valid" || warn "backend config problems (see above)"

python3 -c "import sys; sys.path.insert(0,'services/biomechanics'); import app.main; print('backend import OK')" \
  && ok "backend imports" || block "backend import failed"

[ -f dist/index.html ] && ok "frontend build present" || warn "dist/ missing (run npm run build)"
[ -d services/biomechanics/var ] && warn "var/ runtime state present locally" || ok "no var/ state"

test -f services/biomechanics/models/rtmw/manifest.json \
  && ok "RTMW manifest present" || warn "RTMW manifest missing"
python3 -c "import opensim" 2>/dev/null \
  && ok "opensim importable" || warn "opensim unavailable (Precision degraded)"
curl -s -m 3 http://127.0.0.1:8102/health 2>/dev/null | grep -q modelLoaded \
  && ok "RTMW worker reachable" || warn "RTMW worker unreachable (Precision degraded)"

grep -qiE 'CC BY-NC-SA' services/biomechanics/models/rtmw/manifest.json 2>/dev/null \
  && block "RTMW checkpoint CC BY-NC-SA: COMMERCIAL_RELEASE_BLOCKED_BY_MODEL_LICENSE" \
  || warn "RTMW license unverified"
test -f LICENSE 2>/dev/null || test -f LICENSE.md 2>/dev/null \
  && ok "application license present" || block "APPLICATION_LICENSE_DECISION_REQUIRED"

echo "---"
echo "PASS=$PASS WARN=$WARN BLOCK=$BLOCK (clinical validation not claimed)"
[ "$BLOCK" -gt 0 ] && exit 2 || exit 0
