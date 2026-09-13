"""Extrinsic multi-camera calibration: every camera into one global frame.

Convention (matches TS capture/calibration.ts):
right-handed, meters, world-up +Y, world-to-camera P = K[R|t], t = -R·C.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class ExtrinsicResult:
    cameraId: str
    rotation: np.ndarray  # 3x3 world-to-camera
    translationM: np.ndarray  # 3-vector
    projectionMatrix: np.ndarray  # 3x4 P = K[R|t]
    rmsePx: float
    maxResidualPx: float


def solve_extrinsic_pnp(
    camera_id: str,
    object_points_m: np.ndarray,
    image_points_px: np.ndarray,
    camera_matrix: np.ndarray,
    distortion: np.ndarray,
    max_rmse_px: float = 5.0,
) -> ExtrinsicResult:
    ok, rvec, tvec, inliers = cv2.solvePnPRansac(
        object_points_m.astype(np.float64),
        image_points_px.astype(np.float64),
        camera_matrix.astype(np.float64),
        distortion.astype(np.float64),
        iterationsCount=200,
        reprojectionError=4.0,
        confidence=0.99,
    )
    if not ok:
        from ..domain.errors import TriangulationDegenerate

        raise TriangulationDegenerate(f"PnP failed for {camera_id}")
    proj, _ = cv2.projectPoints(object_points_m, rvec, tvec, camera_matrix, distortion)
    resid = np.linalg.norm(image_points_px.reshape(-1, 2) - proj.reshape(-1, 2), axis=1)
    rmse = float(math.sqrt(float(np.mean(resid**2))))
    if rmse > max_rmse_px:
        from ..domain.errors import CalibrationHighReprojectionError

        raise CalibrationHighReprojectionError(f"{camera_id} extrinsic rmse {rmse:.2f}px")
    R, _ = cv2.Rodrigues(rvec)
    t = tvec.reshape(3)
    P = camera_matrix @ np.hstack([R, t.reshape(3, 1)])
    _ = inliers
    return ExtrinsicResult(camera_id, R, t, P, rmse, float(np.max(resid)))


def projection_matrix(K: np.ndarray, R: np.ndarray, t: np.ndarray) -> np.ndarray:
    return K @ np.hstack([R, t.reshape(3, 1)])
