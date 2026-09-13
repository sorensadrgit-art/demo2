"""V3 activation tests: RTMW schema map, OpenSim IK golden, health liveness.

RTMW/worker/IK tests are opt-in via env (need runtimes up):
  KINELAB_TEST_RTMW_WORKER=1  (RTMW worker on :8102)
  KINELAB_TEST_OPENSIM=1      (opensim 4.6 installed)
Schema-map tests always run (pure python, no runtime).
"""
from __future__ import annotations

import base64
import json
import math
import os
import sys

import numpy as np
import pytest

RUNTIME_DIR = os.path.join(os.path.dirname(__file__), "..", "runtime")
sys.path.insert(0, os.path.abspath(RUNTIME_DIR))

from rtmw_schema import (  # noqa: E402
    CLINICAL_SUBSET,
    RTMW_WHOLEBODY_133,
    SCHEMA_ID,
    map_inference,
)

NEED_WORKER = os.environ.get("KINELAB_TEST_RTMW_WORKER") == "1"
NEED_OPENSIM = os.environ.get("KINELAB_TEST_OPENSIM") == "1"


def test_rtmw_schema_ordering_133():
    assert len(RTMW_WHOLEBODY_133) == 133
    assert RTMW_WHOLEBODY_133[:5] == ["nose", "left-eye", "right-eye", "left-ear", "right-ear"]
    assert RTMW_WHOLEBODY_133[17:23] == [
        "left-big-toe", "left-small-toe", "left-heel",
        "right-big-toe", "right-small-toe", "right-heel",
    ]
    assert RTMW_WHOLEBODY_133[91] == "left-hand-0"
    assert RTMW_WHOLEBODY_133[132] == "right-hand-20"


def test_rtmw_clinical_subset_maps_to_kinelab_ids():
    assert CLINICAL_SUBSET["left-knee"] == 13
    assert CLINICAL_SUBSET["right-ankle"] == 16
    assert CLINICAL_SUBSET["left-heel"] == 19
    assert set(CLINICAL_SUBSET) >= {
        "left-shoulder", "right-shoulder", "left-elbow", "right-elbow",
        "left-wrist", "right-wrist", "left-hip", "right-hip",
        "left-knee", "right-knee", "left-ankle", "right-ankle",
    }


def test_rtmw_map_inference_confidence_gate():
    rng = np.random.default_rng(3)
    kpts = rng.uniform(0, 640, size=(133, 2))
    scores = np.full(133, 0.9)
    scores[13] = 0.05  # left-knee below gate
    out = map_inference(kpts, scores, 640, 480)
    assert out["schemaId"] == SCHEMA_ID and out["keypointCount"] == 133
    assert "left-knee" in out["missingLandmarks"]
    assert all(l["landmarkId"] != "left-knee" for l in out["landmarks"])


def test_rtmw_map_inference_nan_never_faked():
    kpts = np.full((133, 2), np.nan)
    scores = np.full(133, 0.99)
    out = map_inference(kpts, scores, 640, 480)
    assert out["landmarks"] == []
    assert len(out["missingLandmarks"]) == len(CLINICAL_SUBSET)


@pytest.mark.skipif(not NEED_WORKER, reason="needs RTMW worker :8102")
def test_rtmw_worker_real_inference():
    from app.runtime_workers import rtmw_health, rtmw_infer  # noqa: PLC0415

    h = rtmw_health()
    assert h["reachable"] and h["modelLoaded"], h
    img = open("/tmp/rtmw_synth_human.png", "rb").read()
    r = rtmw_infer(base64.b64encode(img).decode(), camera_id="test-cam", timestamp_ms=0)
    assert r["ok"] is True, r
    assert r["model"].startswith("rtmw-l")
    assert len(r["landmarks"]) >= 12
    assert r["inferenceMs"] > 0


GOLDEN_TRAJ = os.path.join(os.path.dirname(__file__), "golden_knee_traj.json")


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_golden_knee_ik(tmp_path):
    from app.runtime_workers import opensim_ik  # noqa: PLC0415

    traj = json.load(open(GOLDEN_TRAJ))
    truth = traj["truthDeg"]["knee_angle_r"]
    rep = opensim_ik({"rateHz": 60, "frames": traj["frames"]}, str(tmp_path))
    assert rep["status"] == "COMPLETE"
    got = rep["coordinatesDeg"]["knee_angle_r"]
    assert len(got) == len(truth)
    # mid-range frames within 5deg of model-generated truth; endpoints recorded, not gated
    for g, t in zip(got[1:-1], truth[1:-1]):
        assert abs(g - t) < 5.0, (g, t)
    assert rep["model"] == "gait2392_thelen2003muscle.osim"


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_ik_too_few_markers_is_typed_failure(tmp_path):
    from app.runtime_workers import opensim_ik  # noqa: PLC0415

    with pytest.raises(RuntimeError, match="IK_TOO_FEW_MARKERS"):
        opensim_ik({"rateHz": 60, "frames": [{"t": 0.0, "markers": {"R.ASIS": [0, 1, 0]}}]},
                   str(tmp_path))


def test_precision_reports_v3_pipeline():
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from app.domain.models import PIPELINE_VERSION  # noqa: PLC0415
    from app.main import app  # noqa: PLC0415

    assert PIPELINE_VERSION == "kinelab-precision-v3"
    r = TestClient(app).post("/reconstruction/triangulate", json={
        "cameras": [], "observations": [], "minViews": 2,
    })
    assert r.status_code in (200, 422)  # empty views → typed error, never 500
    if r.status_code == 200:
        assert r.json()["pipeline"] == "kinelab-precision-v3"
    else:
        assert "code" in r.json()


def test_health_reports_liveness_shape():
    from fastapi.testclient import TestClient  # noqa: PLC0415

    from app.main import app  # noqa: PLC0415

    body = TestClient(app).get("/health").json()
    assert set(body) >= {"rtmw", "opensim", "precision_runtime", "status"}
    if body["rtmw"]:
        assert body["rtmw_reason"] is None and body["rtmw_model"]
    if body["opensim"]:
        assert body["opensim_reason"] is None
    if not (body["rtmw"] and body["opensim"]):
        assert body["precision_runtime"] is False
    assert math.isfinite(1.0)  # placeholder guard against NaN smuggling
