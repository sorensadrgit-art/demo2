import numpy as np

from app.calibration.intrinsic import BoardSpec, assess_coverage, calibrate_chessboard
from app.domain.errors import (
    CalibrationBadCoverage,
    CalibrationHighReprojectionError,
    CalibrationInsufficientImages,
)
import pytest


def _synthetic_views(fx=800.0, fy=800.0, cx=320.0, cy=240.0, n=12, w=640, h=480):
    rng = np.random.default_rng(7)
    spec = BoardSpec("chessboard", 6, 9, 0.025)
    objp = np.array(
        [[[c * 0.025, r * 0.025, 0.0] for c in range(9)] for r in range(6)],
        dtype=np.float32,
    ).reshape(-1, 3)
    K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1.0]])
    dist = np.zeros(5)
    corners = []
    import cv2

    # Diverse board poses across the sensor: grid of centers + tilts.
    for i in range(n):
        gx = (i % 4) / 3.0 - 0.5
        gy = ((i // 4) % 3) / 2.0 - 0.5
        rvec = np.array([0.35 * gx + 0.1 * (i % 2), 0.4 * gy, 0.15 * ((i % 3) - 1)])
        tvec = np.array([gx * 0.35, gy * 0.3, 0.55 + 0.06 * (i % 4)])
        proj, _ = cv2.projectPoints(objp, rvec, tvec, K, dist)
        corners.append(proj.reshape(-1, 1, 2).astype(np.float32))
    return spec, K, corners, (w, h)


def test_intrinsic_known_camera():
    spec, K, corners, size = _synthetic_views()
    res = calibrate_chessboard(corners, size, spec)
    assert abs(res.cameraMatrix[0, 0] - 800.0) < 8.0, res.cameraMatrix
    assert abs(res.cameraMatrix[1, 1] - 800.0) < 8.0
    assert abs(res.cameraMatrix[0, 2] - 320.0) < 8.0
    assert abs(res.cameraMatrix[1, 2] - 240.0) < 8.0
    assert res.rmse < 1.0


def test_intrinsic_insufficient_frames():
    spec, _, corners, size = _synthetic_views(n=2)
    with pytest.raises(CalibrationInsufficientImages):
        calibrate_chessboard(corners[:2], size, spec)


def test_intrinsic_bad_coverage():
    spec, _, corners, size = _synthetic_views(n=10)
    # All views identical board pose -> no diversity.
    with pytest.raises(CalibrationBadCoverage):
        calibrate_chessboard([corners[0]] * 10, size, spec)
