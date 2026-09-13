"""Python weighted-DLT triangulation: mirrors TS reconstruction/triangulation.ts.

Same contract: confidence row weights (sqrt), minViews gate, worst-view
outlier rejection + recompute, per-camera residuals, deterministic output.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from ..domain.errors import InsufficientViews, TriangulationDegenerate


@dataclass
class CameraView:
    cameraId: str
    projectionMatrix: np.ndarray  # 3x4
    xPx: float
    yPx: float
    confidence: float = 1.0


@dataclass
class TriangulationResult:
    pointM: np.ndarray
    usedCameraIds: list[str]
    rejectedCameraIds: list[str] = field(default_factory=list)
    residualsPx: dict[str, float] = field(default_factory=dict)
    reprojectionErrorPx: float = 0.0
    refined: bool = False
    refineIterations: int = 0


def _dlt(views: list[CameraView]) -> np.ndarray:
    rows = []
    for v in views:
        w = math.sqrt(max(0.0, min(1.0, v.confidence)))
        P = v.projectionMatrix
        rows.append(w * (v.xPx * P[2] - P[0]))
        rows.append(w * (v.yPx * P[2] - P[1]))
    A = np.stack(rows)
    if A.shape[0] < 4 or np.linalg.matrix_rank(A) < 3:
        raise TriangulationDegenerate("degenerate view geometry")
    _, _, Vt = np.linalg.svd(A)
    X = Vt[-1]
    if abs(X[3]) < 1e-12:
        raise TriangulationDegenerate("homogeneous solution at infinity")
    return X[:3] / X[3]


def _residuals(point: np.ndarray, views: list[CameraView]) -> dict[str, float]:
    out: dict[str, float] = {}
    X = np.append(point, 1.0)
    for v in views:
        p = v.projectionMatrix @ X
        out[v.cameraId] = float(math.hypot(p[0] / p[2] - v.xPx, p[1] / p[2] - v.yPx))
    return out


def triangulate_weighted(
    views: list[CameraView],
    min_views: int = 2,
    min_confidence: float = 0.05,
    outlier_threshold_px: float = 12.0,
    max_reproj_px: float = 25.0,
    max_reject_rounds: int = 1,
) -> TriangulationResult:
    usable = [v for v in views if v.confidence >= min_confidence]
    if len(usable) < min_views:
        raise InsufficientViews(f"{len(usable)} usable views < min {min_views}")
    if len(usable) < 2:
        raise InsufficientViews("need >=2 views for triangulation")
    point = _dlt(usable)
    resid = _residuals(point, usable)
    rejected: list[str] = []
    for _ in range(max(1, max_reject_rounds)):
        if len(usable) <= min_views:
            break
        worst = max(usable, key=lambda v: resid[v.cameraId])
        if resid[worst.cameraId] <= outlier_threshold_px:
            break
        rejected.append(worst.cameraId)
        usable = [v for v in usable if v.cameraId != worst.cameraId]
        point = _dlt(usable)
        resid = _residuals(point, usable)
    rmse = float(math.sqrt(sum(r * r for r in resid.values()) / max(1, len(resid))))
    if rmse > max_reproj_px:
        from ..domain.errors import TriangulationHighReprojectionError

        raise TriangulationHighReprojectionError(f"rmse {rmse:.2f}px")
    return TriangulationResult(
        pointM=point,
        usedCameraIds=[v.cameraId for v in usable],
        rejectedCameraIds=rejected,
        residualsPx={k: resid[k] for k in [v.cameraId for v in usable]},
        reprojectionErrorPx=rmse,
    )


def refine_point(
    initial: np.ndarray, views: list[CameraView], max_iter: int = 50
) -> tuple[np.ndarray, float, int, bool]:
    """SciPy least-squares reprojection refinement (optional post-DLT)."""
    from scipy.optimize import least_squares

    def fun(X):
        r = []
        Xh = np.append(X, 1.0)
        for v in views:
            p = v.projectionMatrix @ Xh
            r += [p[0] / p[2] - v.xPx, p[1] / p[2] - v.yPx]
        return np.array(r)

    init_rmse = float(math.sqrt(float(np.mean(fun(initial) ** 2))))
    res = least_squares(fun, initial.astype(float), max_nfev=max_iter, xtol=1e-10, ftol=1e-10)
    final_rmse = float(math.sqrt(float(np.mean(res.fun**2))))
    return res.x, final_rmse, int(res.nfev), bool(res.success) and final_rmse < init_rmse
