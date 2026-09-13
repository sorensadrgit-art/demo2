import math

import numpy as np
import pytest

from app.domain.errors import InsufficientViews, TriangulationDegenerate
from app.reconstruction.triangulation import CameraView, refine_point, triangulate_weighted
from tests.fixtures import interior_angle, knee_chain, project, ring_cameras


def _views(cams, X, conf=0.95):
    return [
        CameraView(c["cameraId"], c["P"], *project(c["P"], X), conf) for c in cams
    ]


def test_triangulation_exact_two_view():
    cams = ring_cameras(8)[:2]
    X = np.array([0.05, 0.6, 0.02])
    r = triangulate_weighted(_views(cams, X))
    assert np.linalg.norm(r.pointM - X) * 1000 < 2.0
    assert r.usedCameraIds == ["cam-01", "cam-02"]


def test_triangulation_exact_multi_view():
    cams = ring_cameras(8)
    X = np.array([-0.1, 0.75, 0.05])
    r = triangulate_weighted(_views(cams, X))
    assert np.linalg.norm(r.pointM - X) * 1000 < 2.0
    assert len(r.usedCameraIds) == 8


def test_triangulation_noisy():
    rng = np.random.default_rng(11)
    cams = ring_cameras(8)
    X = np.array([0.0, 0.7, 0.0])
    views = []
    for c in cams:
        x, y = project(c["P"], X)
        views.append(CameraView(c["cameraId"], c["P"], x + rng.normal(0, 1.5), y + rng.normal(0, 1.5), 0.9))
    r = triangulate_weighted(views)
    assert np.linalg.norm(r.pointM - X) * 1000 < 15.0
    assert r.reprojectionErrorPx > 0


def test_triangulation_outlier():
    cams = ring_cameras(8)
    X = np.array([0.0, 0.7, 0.0])
    views = _views(cams, X)
    bad = views[2]
    views[2] = CameraView(bad.cameraId, bad.projectionMatrix, bad.xPx + 60.0, bad.yPx - 45.0, 0.95)
    r = triangulate_weighted(views)
    assert r.rejectedCameraIds == ["cam-03"]
    assert np.linalg.norm(r.pointM - X) * 1000 < 5.0
    assert "cam-03" not in r.residualsPx


def test_triangulation_insufficient_views():
    cams = ring_cameras(8)[:1]
    with pytest.raises(InsufficientViews):
        triangulate_weighted(_views(cams, np.zeros(3)), min_views=2)
    # low-confidence camera filtered -> insufficient
    cams2 = ring_cameras(8)[:2]
    vs = _views(cams2, np.zeros(3), conf=0.01)
    with pytest.raises(InsufficientViews):
        triangulate_weighted(vs, min_views=2, min_confidence=0.05)


def test_triangulation_degenerate_parallel():
    cams = ring_cameras(8)
    dup = [CameraView("cam-01", cams[0]["P"], 320.0, 240.0, 1.0),
           CameraView("cam-01b", cams[0]["P"], 320.0, 240.0, 1.0)]
    with pytest.raises(TriangulationDegenerate):
        triangulate_weighted(dup)


def test_sync_mismatch_rejected():
    from fastapi.testclient import TestClient

    from app.main import app

    c = TestClient(app)
    body = {
        "cameras": [],
        "landmarkId": "x",
        "observations": [],
        "timestampCombMs": 40.0,
        "syncToleranceMs": 16.0,
    }
    r = c.post("/reconstruction/triangulate", json=body)
    assert r.status_code == 422
    assert r.json()["code"] == "FRAME_SYNC_INVALID"


def test_ts_python_golden_equivalence():
    """Golden knee 90°: all 8 cams, both engines must agree <0.5° (TS value from V1)."""
    from tests.fixtures import knee_chain

    cams = ring_cameras(8)
    pts = knee_chain(90.0)
    rec = {}
    for lid, X in pts.items():
        r = triangulate_weighted(_views(cams, X))
        rec[lid] = r.pointM
    ang = interior_angle(rec["left-hip"], rec["left-knee"], rec["left-ankle"])
    assert abs(ang - 90.0) < 0.5, ang


def test_refinement_improves_noisy():
    rng = np.random.default_rng(5)
    cams = ring_cameras(8)
    X = np.array([0.02, 0.65, -0.03])
    views = []
    for c in cams:
        x, y = project(c["P"], X)
        views.append(CameraView(c["cameraId"], c["P"], x + rng.normal(0, 2.0), y + rng.normal(0, 2.0), 0.9))
    r = triangulate_weighted(views)
    p2, rmse2, iters, improved = refine_point(r.pointM, views)
    assert rmse2 <= r.reprojectionErrorPx + 1e-9
    assert iters > 0
