"""Dense anatomical schema: observed vs derived vs model-estimated markers."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel

MarkerOrigin = Literal["observed", "derived", "model-estimated"]

DENSE_SCHEMA_ID = "biomechanics-dense-v1"


class DenseMarker(BaseModel):
    markerId: str
    origin: MarkerOrigin
    xM: float
    yM: float
    zM: float
    sourceLandmarks: list[str] = []


# Body-only biomechanics subset: direct MediaPipe observations.
OBSERVED_BODY = [
    "left-shoulder", "right-shoulder", "left-elbow", "right-elbow",
    "left-wrist", "right-wrist", "left-hip", "right-hip",
    "left-knee", "right-knee", "left-ankle", "right-ankle",
    "left-heel", "right-heel", "left-foot-index", "right-foot-index",
]

# Derived midpoints (never claimed as detections).
DERIVED_DEFS: dict[str, tuple[str, str]] = {
    "pelvis-center": ("left-hip", "right-hip"),
    "thorax-center": ("left-shoulder", "right-shoulder"),
    "neck-base": ("left-shoulder", "right-shoulder"),
}


def build_dense_markers(points: dict[str, tuple[float, float, float]]) -> list[DenseMarker]:
    out: list[DenseMarker] = []
    for lid in OBSERVED_BODY:
        if lid in points:
            x, y, z = points[lid]
            out.append(DenseMarker(markerId=lid, origin="observed", xM=x, yM=y, zM=z))
    for mid, (a, b) in DERIVED_DEFS.items():
        if a in points and b in points:
            ax, ay, az = points[a]
            bx, by, bz = points[b]
            out.append(DenseMarker(
                markerId=mid, origin="derived",
                xM=(ax + bx) / 2, yM=(ay + by) / 2, zM=(az + bz) / 2,
                sourceLandmarks=[a, b],
            ))
    return out
