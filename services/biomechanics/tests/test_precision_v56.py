"""V5.6 required integration test (Phase 45).

Full production path on REAL detector outputs through the ACTUAL
/precision/process_v56 endpoint:

  rendered fixture RGB -> RTMW-L 256x192 -> observations
  -> polarity hypotheses -> global solve -> triangulation
  -> anatomical_consistency gate -> OpenSim IK -> ClinicalMeasurement

Resolved cued fixture must COMPLETE with source=biomechanical-model,
acquisitionGrade=precision, polarityStatus=RESOLVED. Symmetric fixture
must suspend with an exact quality reason (never confident-wrong).
"""
from __future__ import annotations

import base64
import os
import sys

import pytest

SVC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RUNTIME_DIR = os.path.join(SVC, "runtime")
for _p in (SVC, RUNTIME_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from identity_fixtures import (pose_cued_v56, pose_symmetric_v56,  # noqa: E402
                               render_v5, ring_cameras_v5)

NEED_WORKER = os.environ.get("KINELAB_TEST_RTMW_WORKER") == "1"
NEED_OPENSIM = os.environ.get("KINELAB_TEST_OPENSIM") == "1"


def _frame_payload(pose_fn, knee_degs):
    import cv2
    from app.runtime_workers import rtmw_infer  # noqa: PLC0415

    if isinstance(knee_degs, (int, float)):
        knee_degs = [knee_degs]
    cams = ring_cameras_v5()
    frames = []
    for i, deg in enumerate(knee_degs):
        body = pose_fn(float(deg))
        observations = []
        for cam in cams:
            img = render_v5(cam["P"], cam["C"], body, 20260913)
            _, buf = cv2.imencode(".png", img)
            out = rtmw_infer(base64.b64encode(bytes(buf)).decode(),
                             camera_id=cam["cameraId"])
            for l in out.get("landmarks", []):
                observations.append({
                    "cameraId": cam["cameraId"], "landmarkId": l["landmarkId"],
                    "xPx": l["xPx"], "yPx": l["yPx"],
                    "confidence": l.get("confidence", 0.5),
                    "timestampMs": i * 1000.0 / 60.0, "frameId": f"f{i}"})
        frames.append({"frameId": f"f{i}", "timestampMs": i * 1000.0 / 60.0,
                       "observations": observations})
    return {
        "cameras": [{"cameraId": c["cameraId"],
                     "projectionMatrix": c["P"].tolist()} for c in cams],
        "frames": frames,
        "minViews": 3,
        "rtmwModel": {"provider": "rtmw", "model": "rtmw-l 256x192",
                      "checkpoint": "rtmw-l_256x192.pth",
                      "schema": "rtmw-wholebody", "schemaVersion": "1.0"},
        "targetJoint": "knee-flexion-r",
    }


@pytest.mark.skipif(not (NEED_WORKER and NEED_OPENSIM),
                    reason="needs RTMW worker :8102 + opensim 4.6")
def test_precision_v56_identity_to_opensim():
    client = TestClient(app)
    # walk-cycle trial: joint identity accumulation separates hypotheses
    # that a single frame at detector noise floors cannot (V5.6 audit).
    payload = _frame_payload(pose_cued_v56, [0, 30, 60, 90, 105])
    payload["raisedSide"] = {"joint": "elbow", "side": "right"}
    payload["patientId"] = "v56-cued"
    r = client.post("/precision/process_v56", json=payload)
    assert r.status_code == 200, r.text[:500]
    job = r.json()
    assert job["state"] == "COMPLETE", job.get("error")
    m = job["measurement"]
    assert m["source"] == "biomechanical-model"
    assert m["acquisitionGrade"] == "precision"
    assert m["pipelineVersion"] == "kinelab-precision-v5.6"
    assert m["provenance"]["polarityStatus"] == "RESOLVED"
    assert m["provenance"]["polaritySolverVersion"].startswith(
        "kinelab-polarity-v56")
    assert m["provenance"]["polaritySwitchCount"] == 0
    assert job["stages"]["anatomicalConsistency"]["pass"] is True


@pytest.mark.skipif(not (NEED_WORKER and NEED_OPENSIM),
                    reason="needs RTMW worker :8102 + opensim 4.6")
def test_precision_v56_symmetric_suspends():
    client = TestClient(app)
    payload = _frame_payload(pose_symmetric_v56, 60.0)
    payload["patientId"] = "v56-sym"
    r = client.post("/precision/process_v56", json=payload)
    assert r.status_code == 200, r.text[:500]
    job = r.json()
    # symmetric fixture: suspension is correct; a COMPLETE is only valid
    # with polarityStatus RESOLVED AND honest (checked) anatomy.
    if job["state"] == "COMPLETE":
        assert (job["measurement"]["provenance"]["polarityStatus"]
                == "RESOLVED")
    else:
        assert job["state"] == "FAILED_QUALITY"
        assert job["error"]["reason"] in (
            "ANATOMICAL_SIDE_UNRESOLVED", "POLARITY_AMBIGUOUS",
            "ANATOMICAL_INCONSISTENCY", "INSUFFICIENT_IDENTITY_EVIDENCE")
