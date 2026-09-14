#!/usr/bin/env bash
# KineLab production-like local start: backend + web preview + readiness.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
export KINELAB_RELEASE_CHANNEL="${KINELAB_RELEASE_CHANNEL:-RESEARCH_PREVIEW}"
export KINELAB_BACKEND_PORT="${KINELAB_BACKEND_PORT:-8101}"
python3 -c "import sys; sys.path.insert(0,'services/biomechanics'); from app.config import validate_startup as v; p=v(); print('config:', p if p else 'OK'); raise SystemExit(1 if p else 0)" \
  || { echo "config invalid; see .env.example"; exit 1; }
(nohup python3 -m uvicorn app.main:app --app-dir services/biomechanics \
  --host 127.0.0.1 --port "$KINELAB_BACKEND_PORT" > /tmp/kinelab-backend.log 2>&1 &
 echo $! > /tmp/kinelab-backend.pid)
sleep 4
curl -s -m 5 "http://127.0.0.1:${KINELAB_BACKEND_PORT}/ready" || { echo "backend not ready"; exit 1; }
echo "backend ready (see /tmp/kinelab-backend.log)"
(nohup npx vite preview --port 8012 --strictPort > /tmp/kinelab-web.log 2>&1 &
 echo $! > /tmp/kinelab-web.pid)
echo "web preview on :8012. Stop with ./scripts/stop_production.sh"
