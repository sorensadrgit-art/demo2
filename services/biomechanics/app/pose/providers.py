"""Pose provider boundary: normalized schema, MediaPipe adapter today,
RTMW skeleton with explicit BLOCKED until weights+runtime exist."""
from __future__ import annotations

from typing import Protocol
from pydantic import BaseModel


class PoseLandmark(BaseModel):
    landmarkId: str
    xPx: float
    yPx: float
    confidence: float
    visibility: float | None = None


class PoseResult(BaseModel):
    provider: str
    schemaId: str
    schemaVersion: str
    landmarks: list[PoseLandmark]
    latencyMs: float | None = None


class PoseProvider(Protocol):
    name: str
    schema_id: str
    schema_version: str

    def infer(self, image) -> PoseResult: ...


MEDIAPIPE_33 = [
    "nose", "left-eye-inner", "left-eye", "left-eye-outer", "right-eye-inner",
    "right-eye", "right-eye-outer", "left-ear", "right-ear", "mouth-left",
    "mouth-right", "left-shoulder", "right-shoulder", "left-elbow",
    "right-elbow", "left-wrist", "right-wrist", "left-pinky", "right-pinky",
    "left-index", "right-index", "left-thumb", "right-thumb", "left-hip",
    "right-hip", "left-knee", "right-knee", "left-ankle", "right-ankle",
    "left-heel", "right-heel", "left-foot-index", "right-foot-index",
]


class MediaPipeAdapter:
    """Server-side schema mapping for MediaPipe index landmarks."""

    name = "mediapipe"
    schema_id = "mediapipe-33"
    schema_version = "1.0"

    def map_indexed(self, xs: list[float], ys: list[float], confs: list[float]) -> PoseResult:
        lms = [
            PoseLandmark(landmarkId=MEDIAPIPE_33[i], xPx=xs[i], yPx=ys[i], confidence=confs[i])
            for i in range(min(len(MEDIAPIPE_33), len(xs)))
        ]
        return PoseResult(provider=self.name, schemaId=self.schema_id, schemaVersion=self.schema_version, landmarks=lms)


class RTMWPoseProvider:
    name = "rtmw"
    schema_id = "rtmw-wholebody"
    schema_version = "1.0"
    BLOCKED_REASON = (
        "RTMW: BLOCKED — no torch/mmpose runtime, no checkpoint weights, "
        "no inference service in this environment"
    )

    def status(self) -> dict:
        try:
            import torch  # noqa: F401
            import mmpose  # noqa: F401

            return {"rtmw": True, "reason": None}
        except Exception as e:  # noqa: BLE001
            return {"rtmw": False, "reason": f"{self.BLOCKED_REASON} ({type(e).__name__})"}

    def infer(self, image) -> PoseResult:  # noqa: ARG002
        from ..domain.errors import PoseProviderUnavailable

        raise PoseProviderUnavailable(self.status()["reason"])
