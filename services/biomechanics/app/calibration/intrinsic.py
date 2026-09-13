"""Real OpenCV intrinsic calibration: chessboard first, Charuco where supported."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from ..domain.errors import (
    CalibrationBadCoverage,
    CalibrationHighReprojectionError,
    CalibrationInsufficientImages,
)


@dataclass
class BoardSpec:
    type: str  # 'chessboard' | 'charuco'
    rows: int  # inner corners (chessboard) / squares-y (charuco)
    columns: int
    squareSizeM: float


@dataclass
class CoverageReport:
    valid: bool
    reasons: list[str] = field(default_factory=list)
    coverage: float = 0.0


def _object_points(spec: BoardSpec) -> np.ndarray:
    pts = []
    for r in range(spec.rows):
        for c in range(spec.columns):
            pts.append([c * spec.squareSizeM, r * spec.squareSizeM, 0.0])
    return np.array(pts, dtype=np.float32)


def assess_coverage(
    corners_list: list[np.ndarray],
    image_size: tuple[int, int],
    min_views: int = 8,
    min_coverage: float = 0.25,
) -> CoverageReport:
    """Quality gate BEFORE solving: count, sensor coverage, spatial diversity."""
    reasons: list[str] = []
    if len(corners_list) < min_views:
        reasons.append(f"too few valid calibration frames: {len(corners_list)} < {min_views}")
    w, h = image_size
    quadrants = [0, 0, 0, 0]
    xs: list[float] = []
    ys: list[float] = []
    for corners in corners_list:
        pts = corners.reshape(-1, 2)
        xs.extend((pts[:, 0] / w).tolist())
        ys.extend((pts[:, 1] / h).tolist())
        cx = float(np.mean(pts[:, 0]) / w)
        cy = float(np.mean(pts[:, 1]) / h)
        quadrants[(1 if cx > 0.5 else 0) + (2 if cy > 0.5 else 0)] += 1
    coverage = 0.0
    if xs and ys:
        coverage = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if coverage < min_coverage:
            reasons.append(f"board coverage too small: {coverage:.3f} < {min_coverage}")
        occupied = sum(1 for q in quadrants if q > 0)
        if occupied < 3:
            reasons.append("board remained only in image center: <3 sensor quadrants visited")
        # Orientation diversity via corner-spread std across views.
        spreads = []
        for corners in corners_list:
            pts = corners.reshape(-1, 2)
            spreads.append(float(np.std(pts[:, 0] / w) + np.std(pts[:, 1] / h)))
        if len(spreads) >= 2 and (max(spreads) - min(spreads)) < 0.02 and np.mean(spreads) < 0.12:
            reasons.append("insufficient board orientation diversity")
    return CoverageReport(valid=not reasons, reasons=reasons, coverage=coverage)


@dataclass
class IntrinsicResult:
    cameraMatrix: np.ndarray
    distortion: np.ndarray
    rvecs: list[np.ndarray]
    tvecs: list[np.ndarray]
    perViewRmse: list[float]
    rmse: float


def calibrate_chessboard(
    corners_list: list[np.ndarray],
    image_size: tuple[int, int],
    spec: BoardSpec,
    max_rmse_px: float = 3.0,
) -> IntrinsicResult:
    if len(corners_list) < 3:
        raise CalibrationInsufficientImages(f"need >=3 views, got {len(corners_list)}")
    coverage = assess_coverage(corners_list, image_size)
    if not coverage.valid:
        raise CalibrationBadCoverage("; ".join(coverage.reasons))
    objp = _object_points(spec)
    objpoints = [objp for _ in corners_list]
    ret, mtx, dist, rvecs, tvecs = cv2.calibrateCamera(
        objpoints, corners_list, image_size, None, None
    )
    _ = ret
    per_view: list[float] = []
    for i, c in enumerate(corners_list):
        proj, _ = cv2.projectPoints(objp, rvecs[i], tvecs[i], mtx, dist)
        err = float(np.sqrt(np.mean((c.reshape(-1, 2) - proj.reshape(-1, 2)) ** 2)))
        per_view.append(err)
    rmse = float(math.sqrt(sum(e * e for e in per_view) / max(1, len(per_view))))
    if rmse > max_rmse_px:
        raise CalibrationHighReprojectionError(f"rmse {rmse:.2f}px > {max_rmse_px}px")
    return IntrinsicResult(mtx, dist, list(rvecs), list(tvecs), per_view, rmse)


def detect_chessboard(gray: np.ndarray, rows: int, columns: int) -> np.ndarray | None:
    ok, corners = cv2.findChessboardCorners(gray, (columns, rows))
    if not ok:
        return None
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 1e-3)
    cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
    return corners
