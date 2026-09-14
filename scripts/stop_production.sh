#!/usr/bin/env bash
# KineLab production-like local stop: no orphan backend/worker processes.
set -u
for pid in /tmp/kinelab-backend.pid /tmp/kinelab-web.pid /tmp/rtmw_worker_8102.pid; do
  if [ -f "$pid" ]; then
    kill "$(cat "$pid")" 2>/dev/null && echo "stopped $(cat "$pid") ($pid)"
    rm -f "$pid"
  fi
done
pkill -f "uvicorn app.main:app --app-dir services/biomechanics" 2>/dev/null || true
pkill -f "rtmw_worker.py --port 8102" 2>/dev/null || true
echo "stop complete"
