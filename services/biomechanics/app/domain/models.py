"""Shared pydantic domain models mirroring the TS measurement contracts."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

PIPELINE_VERSION = "kinelab-biomechanics-v2"
SCHEMA_VERSION = "1.0"

AcquisitionGrade = Literal["precision", "clinical", "solo"]
CoordinateHandedness = Literal["right", "left"]


class CoordinateConvention(BaseModel):
    handedness: CoordinateHandedness = "right"
    units: Literal["meters"] = "meters"
    worldUp: Literal["+Y"] = "+Y"
    # World-to-camera: X = P @ X_world with P = K[R|t], t = -R·C (matches TS).
    rotationSense: Literal["world-to-camera"] = "world-to-camera"


class CameraIntrinsics(BaseModel):
    fx: float
    fy: float
    cx: float
    cy: float
    distortion: list[float] = Field(default_factory=list)
    width: int
    height: int


class CameraExtrinsics(BaseModel):
    rotation: list[list[float]]
    translationM: list[float]


class CalibratedCameraModel(BaseModel):
    cameraId: str
    intrinsics: CameraIntrinsics
    extrinsics: CameraExtrinsics
    projectionMatrix: list[list[float]]


class FrameTimestamp(BaseModel):
    monotonicMs: float
    frameIndex: int
    wallClockIso: str | None = None


class Observation2D(BaseModel):
    cameraId: str
    landmarkId: str
    xPx: float
    yPx: float
    confidence: float = 1.0
    visibility: float | None = None


class TriangulatedPoint(BaseModel):
    landmarkId: str
    xM: float
    yM: float
    zM: float
    sourceCameraIds: list[str]
    validViewCount: int
    reprojectionErrorPx: float
    residualsPx: dict[str, float] = Field(default_factory=dict)
    rejectedCameraIds: list[str] = Field(default_factory=list)
