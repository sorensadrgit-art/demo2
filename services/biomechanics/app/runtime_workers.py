"""KineLab runtime worker clients: RTMW HTTP worker + OpenSim subprocess.

Both run locally (127.0.0.1 / subprocess). No patient imagery leaves the machine.
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.request

RTMW_URL = os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
REPO_ROOT = os.environ.get("KINELAB_REPO_ROOT", "/workspace/project/demo2")


def rtmw_health(timeout_s: float = 5.0) -> dict:
    try:
        with urllib.request.urlopen(f"{RTMW_URL}/health", timeout=timeout_s) as r:
            return {"reachable": True, **json.load(r)}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "reason": f"{type(e).__name__}: {e}"}


def rtmw_infer(image_b64: str, camera_id: str | None = None,
               timestamp_ms: float | None = None,
               patient_roi: dict | None = None,
               patient_track_id: str | None = None,
               timeout_s: float = 180.0) -> dict:
    body = json.dumps({
        "imageB64": image_b64, "cameraId": camera_id,
        "timestampMs": timestamp_ms, "patientRoi": patient_roi,
        "patientTrackId": patient_track_id,
    }).encode()
    req = urllib.request.Request(f"{RTMW_URL}/infer", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.load(r)


def opensim_ik(trajectory: dict, out_dir: str, accuracy: float = 1e-5) -> dict:
    """Run real OpenSim IK in the main interpreter via subprocess. Returns
    parsed report dict; raises RuntimeError(IK_FAILED...) on solve failure."""
    os.makedirs(out_dir, exist_ok=True)
    markers_path = os.path.join(out_dir, "input_markers.json")
    with open(markers_path, "w") as f:
        json.dump(trajectory, f)
    script = os.path.join(REPO_ROOT, "services/biomechanics/runtime/opensim_ik.py")
    model = os.path.join(REPO_ROOT, "services/biomechanics/models/opensim/gait2392_thelen2003muscle.osim")
    p = subprocess.run(
        ["python3", script, "--model", model, "--markers", markers_path,
         "--out", out_dir, "--accuracy", str(accuracy)],
        capture_output=True, text=True, timeout=600, cwd=REPO_ROOT,
    )
    out = (p.stdout or "").strip().splitlines()
    report_line = out[-1] if out else ""
    try:
        report = json.loads(report_line)
    except Exception:  # noqa: BLE001
        raise RuntimeError(f"IK_FAILED: no report (rc={p.returncode}): {(p.stderr or '')[-500:]}")
    if report.get("status") != "COMPLETE":
        raise RuntimeError(f"{report.get('code', 'IK_FAILED')}: {report.get('message')}")
    return report
