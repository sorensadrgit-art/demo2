import math

import numpy as np
import pytest

from app.calibration.extrinsic import solve_extrinsic_pnp
from app.domain.errors import CalibrationHighReprojectionError, TriangulationDegenerate
from tests.fixtures import DIST, project, ring_cameras

K = np.array([[800.0, 0, 320.0], [0, 800.0, 240.0], [0, 0, 1.0]])


def _target(n=20):
    rng = np.random.default_rng(3)
    return rng.uniform(-0.3, 0.3, (n, 3)) + np.array([0.0, 0.8, 0.0])


def test_extrinsic_known_transform():
    cam = ring_cameras(8)[0]
    pts = _target()
    img = np.array([project(cam["P"], X) for X in pts])
    res = solve_extrinsic_pnp("cam-01", pts, img, K, DIST)
    assert res.rmsePx < 1e-4, res.rmsePx
    assert np.allclose(res.rotation, cam["R"], atol=1e-4)
    assert np.allclose(res.translationM, cam["t"], atol=1e-4)


def test_extrinsic_bad_transform():
    cam = ring_cameras(8)[0]
    pts = _target()
    img = np.array([project(cam["P"], X) for X in pts])
    # Scramble correspondences: no rigid transform can explain these.
    img = img[np.random.default_rng(9).permutation(len(img))]
    with pytest.raises((CalibrationHighReprojectionError, TriangulationDegenerate)):
        solve_extrinsic_pnp("cam-01", pts, img, K, DIST)


def test_reprojection_rmse():
    cam = ring_cameras(8)[2]
    pts = _target(30)
    img = np.array([project(cam["P"], X) for X in pts])
    res = solve_extrinsic_pnp("cam-03", pts, img, K, DIST)
    assert res.maxResidualPx < 1e-3
