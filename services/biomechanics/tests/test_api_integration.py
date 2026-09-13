"""Live API integration: starts the real service (TestClient) and exercises
health -> calibration -> reconstruction -> biomechanics -> validation ->
precision exactly as the frontend client would."""
from fastapi.testclient import TestClient

from app.main import app
from tests.fixtures import knee_chain, project, ring_cameras

c = TestClient(app)


def test_api_integration_full_path():
    h = c.get("/health")
    assert h.status_code == 200 and h.json()["opencv"] is True

    # intrinsic: synthetic known-camera corner sets via projection
    import cv2
    import numpy as np

    spec_rows, spec_cols, sq = 6, 9, 0.025
    objp = np.array(
        [[[cc * sq, rr * sq, 0.0] for cc in range(spec_cols)] for rr in range(spec_rows)],
        dtype=np.float32,
    ).reshape(-1, 3)
    K = np.array([[800.0, 0, 320.0], [0, 800.0, 240.0], [0, 0, 1.0]])
    dist = np.zeros(5)
    corners = []
    for i in range(12):
        gx = (i % 4) / 3.0 - 0.5
        gy = ((i // 4) % 3) / 2.0 - 0.5
        rvec = np.array([0.35 * gx + 0.1 * (i % 2), 0.4 * gy, 0.15 * ((i % 3) - 1)])
        tvec = np.array([gx * 0.35, gy * 0.3, 0.55 + 0.06 * (i % 4)])
        proj, _ = cv2.projectPoints(objp, rvec, tvec, K, dist)
        corners.append(proj.reshape(-1, 2).tolist())
    cal = c.post("/calibration/intrinsic", json={
        "cameraId": "cam-api-01", "width": 640, "height": 480,
        "boardRows": spec_rows, "boardColumns": spec_cols,
        "squareSizeM": sq, "cornerSets": corners,
    })
    assert cal.status_code == 200, cal.text
    bundle = cal.json()
    assert abs(bundle["cameras"][0]["fx"] - 800.0) < 8.0

    # reconstruction + precision on the golden knee fixture
    cams = ring_cameras(8)
    pts = knee_chain(90.0)
    obs = []
    for cam in cams:
        for lid, X in pts.items():
            x, y = project(cam["P"], X)
            obs.append({"cameraId": cam["cameraId"], "xPx": x, "yPx": y, "confidence": 0.95})
    knee_obs = []
    for cam in cams:
        x, y = project(cam["P"], pts["left-knee"])
        knee_obs.append({"cameraId": cam["cameraId"], "xPx": x, "yPx": y, "confidence": 0.95})
    tri = c.post("/reconstruction/triangulate", json={
        "cameras": [{"cameraId": cc["cameraId"], "projectionMatrix": cc["P"].tolist()} for cc in cams],
        "landmarkId": "left-knee", "minViews": 2,
        "observations": knee_obs,
    })
    assert tri.status_code == 200, tri.text
    assert tri.json()["reprojectionErrorPx"] < 1e-3

    kin = c.post("/biomechanics/kinematics", json={
        "points": {k: v.tolist() for k, v in pts.items()},
    })
    assert kin.status_code == 200, kin.text
    assert abs(kin.json()["jointAnglesDeg"]["knee-flexion-l"] - 90.0) < 1e-6

    val = c.post("/validation/compare", json={"kinelab": [89.9, 90.1], "reference": [90.0, 90.0], "unit": "deg"})
    assert val.status_code == 200 and val.json()["rmse"] < 0.2

    prec = c.post("/precision/process", json={
        "cameras": [{"cameraId": cc["cameraId"], "projectionMatrix": cc["P"].tolist()} for cc in cams],
        "frames": [{
            "timestampMs": 0,
            "observations": [
                {"cameraId": cc["cameraId"], "landmarkId": lid, "xPx": px, "yPx": py, "confidence": 0.95}
                for lid, X in pts.items()
                for cc in cams
                for (px, py) in [project(cc["P"], X)]
            ],
        }],
    })
    assert prec.status_code == 200, prec.text
    job = prec.json()
    assert job["state"] == "COMPLETE", job
    assert abs(job["measurement"]["valueDeg"] - 90.0) < 0.5
    assert job["measurement"]["pipeline"] == "kinelab-biomechanics-v2"
