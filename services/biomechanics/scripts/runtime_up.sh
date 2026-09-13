#!/usr/bin/env bash
# KineLab runtime activation V3 — provision + verify script.
# Usage: bash services/biomechanics/scripts/runtime_up.sh [--skip-install]
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RTMW_PY="$ROOT/services/biomechanics/runtime/kinelab-rtmw/bin/python"
OSIM_MODEL="$ROOT/services/biomechanics/models/opensim/gait2392_thelen2003muscle.osim"

if [ "${1:-}" != "--skip-install" ]; then
  echo "== main interpreter: opensim =="
  pip3 install "opensim==4.6"
fi
echo "== RTMW venv =="
"$RTMW_PY" -c "import torch, mmpose, mmdet; print(torch.__version__, mmpose.__version__, mmdet.__version__)"
echo "== gait2392 =="
python3 -c "import opensim; m=opensim.Model('$OSIM_MODEL'); print('coords:', m.getCoordinateSet().getSize())" 2>/dev/null
echo "== worker :8102 =="
curl -s -m 10 http://127.0.0.1:8102/health || {
  echo "starting RTMW worker..."
  cd "$ROOT/services/biomechanics/runtime" && nohup ./../runtime/kinelab-rtmw/bin/python rtmw_worker.py --port 8102 >/tmp/rtmw_worker.log 2>&1 &
  sleep 45; curl -s -m 10 http://127.0.0.1:8102/health; echo
}
echo "== tests =="
cd "$ROOT/services/biomechanics" && KINELAB_TEST_RTMW_WORKER=1 KINELAB_TEST_OPENSIM=1 python3 -m pytest tests/ 2>&1 | tail -2
