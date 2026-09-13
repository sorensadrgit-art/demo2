"""Runtime capability probing. /health reflects actual imports, never hardcoded."""
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
    rtmw_ok = torch_ok and mmpose_ok
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
        "rtmw_reason": None if rtmw_ok else f"torch: {torch_reason}; mmpose: {mmpose_reason}",
        "opensim": opensim_ok,
        "opensim_reason": None if opensim_ok else str(opensim_reason),
    }
