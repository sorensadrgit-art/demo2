#!/usr/bin/env bash
# KineLab RTMW runtime provisioner — recreates the isolated inference venv
# byte-for-byte from services/biomechanics/runtime/requirements-rtmw.txt.
#
#   bash services/biomechanics/scripts/provision_rtmw.sh [--venv DIR] [--recreate]
#
# Defaults to the in-repo venv services/biomechanics/runtime/kinelab-rtmw.
# Design notes:
# - No `mim`, no real `mmdet` (no mutually compatible release exists for
#   mmcv 2.2.0; see docs/RTMW_REPRODUCIBILITY_V4.md). The vendored stub at
#   services/biomechanics/runtime/rtmw_compat/mmdet is exposed via a .pth
#   file so the venv works without PYTHONPATH or post-install patching.
# - Numpy is pinned <2 (mmcv 2.2.0 wheels target numpy 1.x ABI).
# - Idempotent: re-running without --recreate only repairs the .pth/shim.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIOMECH="$(cd "$HERE/.." && pwd)"
LOCK="$BIOMECH/runtime/requirements-rtmw.txt"
COMPAT="$BIOMECH/runtime/rtmw_compat"
VENV="${1:-}"
RECREATE=0
for a in "$@"; do
  case "$a" in
    --venv) shift; VENV="${1:-}"; shift || true ;;
    --venv=*) VENV="${a#--venv=}" ;;
    --recreate) RECREATE=1 ;;
  esac
done
: "${VENV:=$BIOMECH/runtime/kinelab-rtmw}"
if [ "$RECREATE" -eq 1 ] && [ -d "$VENV" ]; then
  rm -rf "$VENV"
fi
if [ ! -x "$VENV/bin/python" ]; then
  python3.11 -m venv "$VENV"
fi
PY="$VENV/bin/python"
SITE="$("$PY" -c 'import sysconfig; print(sysconfig.get_paths()["purelib"])')"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet -r "$LOCK"
if "$PY" -c "import mmdet" >/dev/null 2>&1; then
  echo "ERROR: real mmdet leaked into $VENV (must stay absent; stub covers mmpose's import)" >&2
  exit 1
fi
echo "$COMPAT" > "$SITE/kinelab_rtmw_compat.pth"
"$PY" - <<'PYEOF'
import sys
print("compat path:", [p for p in sys.path if p.endswith("rtmw_compat")])
import mmdet
from mmdet.utils import ConfigType, reduce_mean  # noqa: F401
print("stub:", mmdet.__file__)
from mmpose.apis import init_model, inference_topdown  # noqa: F401
import torch, mmcv, mmpose  # noqa: F401
print("OK torch=%s mmcv=%s mmpose=%s" % (torch.__version__, mmcv.__version__, mmpose.__version__))
PYEOF
echo "provisioned: $VENV"
