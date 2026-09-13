"""Runtime capability probing. /health reflects actual imports + live worker
probes, never hardcoded."""
from __future__ import annotations

import importlib
import sys


def _try_import(name: str) -> tuple[bool, str]:
    try:
        mod = importlib.import_module(name)
        ver = getattr(mod, "__version__", "present")
        return True, str(ver)
    except Exception as e:  # noqa: BLE001 — reason string is the API
        return False, f"{type(e).__name__}: {e}"


def runtime_status() -> dict:
    numpy_ok, numpy_v = _try_import("numpy")
    scipy_ok, scipy_v = _try_import("scipy")
    cv_ok, cv_v = _try_import("cv2")
    torch_ok, torch_reason = _try_import("torch")
    mmpose_ok, mmpose_reason = _try_import("mmpose")
    opensim_ok, opensim_reason = _try_import("opensim")
    try:
        import cv2  # noqa: F401

        aruco = getattr(cv2, "aruco", None)
        charuco = aruco is not None and hasattr(aruco, "CharucoBoard")
    except Exception:  # noqa: BLE001
        charuco = False
    # Live RTMW worker probe: VERIFIED only when the child runtime answers.
    from .runtime_workers import rtmw_health  # noqa: PLC0415

    worker = rtmw_health()
    rtmw_ok = bool(worker.get("reachable")) and bool(worker.get("modelLoaded"))
    rtmw_model = (worker.get("model") or {}).get("model") if rtmw_ok else None
    if not torch_ok or not mmpose_ok:
        # main-interpreter torch/mmpose remain absent by design (isolated venv)
        pass
    return {
        "status": "ok",
        "python": sys.version.split()[0],
        "numpy": numpy_ok,
        "numpy_version": numpy_v,
        "scipy": scipy_ok,
        "scipy_version": scipy_v,
        "opencv": cv_ok,
        "opencv_version": cv_v,
        "charuco": charuco,
        "rtmw": rtmw_ok,
        "rtmw_model": rtmw_model,
        "rtmw_reason": None if rtmw_ok else f"worker: {worker}; torch: {torch_reason}; mmpose: {mmpose_reason}",
        "opensim": opensim_ok,
        "opensim_reason": None if opensim_ok else str(opensim_reason),
        "opensim_version": opensim_reason if opensim_ok else None,
        "precision_runtime": bool(rtmw_ok and opensim_ok),
    }
