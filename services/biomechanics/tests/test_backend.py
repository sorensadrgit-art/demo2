import math

import numpy as np

from app.anatomy.consistency import plausibility_flags, segment_consistency
from app.anatomy.dense import DENSE_SCHEMA_ID, build_dense_markers
from app.opensim.runtime import opensim_status
from app.pose.providers import MediaPipeAdapter, RTMWPoseProvider
from app.reconstruction.temporal import filter_trajectory
from app.validation.metrics import bland_altman, full_report, icc_3_1, mae, rmse


def test_health_runtime_status():
    from fastapi.testclient import TestClient

    from app.main import app

    r = TestClient(app).get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["numpy"] is True and body["scipy"] is True and body["opencv"] is True
    # V3: /health reflects LIVE runtimes — True only when real imports/workers answer.
    assert set(body) >= {"rtmw", "opensim", "precision_runtime"}
    assert isinstance(body["rtmw"], bool) and isinstance(body["opensim"], bool)


def test_segment_length_consistency():
    base = {
        "left-hip": (0.0, 0.9, 0.0), "left-knee": (0.0, 0.45, 0.0),
        "left-ankle": (0.0, 0.05, 0.0),
    }
    frames = [dict(base) for _ in range(10)]
    stats = segment_consistency(frames)
    assert stats["femur-l"].cv < 1e-9
    bad = [dict(base) for _ in range(9)] + [dict({**base, "left-knee": (0.0, 0.9, 0.0)})]
    stats2 = segment_consistency(bad)
    assert stats2["femur-l"].warn is True


def test_pose_schema_mapping():
    res = MediaPipeAdapter().map_indexed([10.0] * 33, [20.0] * 33, [0.9] * 33)
    assert res.schemaId == "mediapipe-33"
    assert len(res.landmarks) == 33
    assert res.landmarks[23].landmarkId == "left-hip"
    assert res.landmarks[24].landmarkId == "right-hip"


def test_rtmw_real_inference_or_explicit_block():
    p = RTMWPoseProvider()
    st = p.status()
    assert st["rtmw"] is False and "BLOCKED" in st["reason"]
    try:
        p.infer(None)
        raise AssertionError("should have raised")
    except Exception as e:
        assert getattr(e, "code", "") == "POSE_PROVIDER_UNAVAILABLE"


def test_opensim_import_or_explicit_block():
    st = opensim_status()
    # V3: opensim 4.6 installed → live True; without it, explicit BLOCKED reason.
    assert isinstance(st["opensim"], bool)
    if st["opensim"]:
        assert st["reason"] is None
    else:
        assert "BLOCKED" in st["reason"]


def test_opensim_model_load_or_explicit_block():
    from app.opensim.runtime import KINELAB_TO_OPENSIM_MARKERS, OpenSimRunner

    try:
        OpenSimRunner()
        # V3: with opensim 4.6 installed the runner constructs; without the
        # runtime it raises BLOCKED.
    except RuntimeError as e:
        assert "BLOCKED" in str(e)
    # V3: kinematic chain map present for IK wiring.
    assert KINELAB_TO_OPENSIM_MARKERS["knee-flexion-l"]["coordinate"] == "knee_angle_l"


def test_opensim_ik_fixture_or_explicit_block():
    from app.opensim.runtime import RECOMMENDED_MODEL

    assert RECOMMENDED_MODEL["name"] == "gait2392"
    assert "knee" in " ".join(RECOMMENDED_MODEL["dofs"])


def test_measurement_provenance_complete():
    from fastapi.testclient import TestClient

    from app.main import app
    from tests.fixtures import knee_chain, project, ring_cameras

    cams = ring_cameras(4)
    pts = knee_chain(60.0)
    frames = [{
        "timestampMs": 0,
        "observations": [
            {"cameraId": c["cameraId"], "landmarkId": lid,
             "xPx": px, "yPx": py, "confidence": 0.95}
            for lid, X in pts.items()
            for c in cams
            for (px, py) in [project(c["P"], X)]
        ],
    }]
    body = {
        "cameras": [
            {"cameraId": c["cameraId"], "projectionMatrix": c["P"].tolist()} for c in cams
        ],
        "frames": frames,
    }
    r = TestClient(app).post("/precision/process", json=body)
    assert r.status_code == 200
    job = r.json()
    assert job["state"] == "COMPLETE", job
    m = job["measurement"]
    for key in ("source", "acquisitionGrade", "pipeline", "valueDeg"):
        assert key in m, m
    assert m["pipeline"] == "kinelab-precision-v3"
    assert abs(m["valueDeg"] - 60.0) < 0.5


def test_validation_mae():
    assert abs(mae([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])) < 1e-12
    assert abs(mae([0.0, 0.0], [1.0, 3.0]) - 2.0) < 1e-12


def test_validation_rmse():
    assert abs(rmse([0.0, 0.0], [3.0, 4.0]) - 3.5355339) < 1e-5


def test_validation_bias():
    from app.validation.metrics import bias

    assert abs(bias([2.0, 4.0], [1.0, 1.0]) - 2.0) < 1e-12


def test_bland_altman():
    ba = bland_altman([1.0, 2.0, 3.0, 4.0], [1.1, 1.9, 3.2, 3.8])
    assert ba["n"] == 4
    assert abs(ba["meanDifference"]) < 0.1
    assert ba["upperLoA"] > ba["lowerLoA"]
    rep = full_report([1.0, 2.0], [1.0, 2.0], "deg")
    assert rep["rmse"] == 0.0 and abs(rep["pearsonR"] - 1.0) < 1e-12


def test_dense_schema_origins():
    pts = {
        "left-hip": (0.0, 0.9, 0.0), "right-hip": (0.2, 0.9, 0.0),
        "left-shoulder": (0.0, 1.4, 0.0), "right-shoulder": (0.2, 1.4, 0.0),
    }
    dense = build_dense_markers(pts)
    by_id = {m.markerId: m for m in dense}
    assert by_id["left-hip"].origin == "observed"
    assert by_id["pelvis-center"].origin == "derived"
    assert DENSE_SCHEMA_ID == "biomechanics-dense-v1"


def test_temporal_filter_validation():
    import math as m

    truth = [90.0 + 30.0 * m.sin(2 * m.pi * 0.5 * t / 30) for t in range(60)]
    rng = np.random.default_rng(2)
    noisy = [(t / 30.0, v + rng.normal(0, 3.0)) for t, v in enumerate(truth)]
    filt = filter_trajectory(noisy)
    fv = [v for v in filt if v is not None]
    assert len(fv) == len(truth)
    err_before = sum(abs(n[1] - t) for n, t in zip(noisy, truth)) / len(truth)
    err_after = sum(abs(f - t) for f, t in zip(fv, truth)) / len(truth)
    assert err_after < err_before
    # peaks not crushed: amplitude preserved within 20%
    assert abs((max(fv) - min(fv)) - (max(truth) - min(truth))) / (max(truth) - min(truth)) < 0.2
    # gaps stay explicit
    gapped = [(0.0, 1.0), (0.1, 1.0), (5.0, 1.0)]
    assert filter_trajectory(gapped)[2] is None


def test_plausibility_gates():
    p0 = {"left-knee": (0.0, 0.45, 0.0)}
    p1 = {"left-knee": (5.0, 0.45, 0.0)}
    flags = plausibility_flags(p0, p1, 0.033)
    assert any(f.startswith("teleport") for f in flags)
