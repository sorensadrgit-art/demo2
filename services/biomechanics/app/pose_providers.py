"""KineLab pose-benchmark provider interface (V5.5, Phase P3/P28).

Every Precision pose provider — RTMW-L, higher-resolution RTMW/RTMPose
variants, future dense biomechanical models — implements
``PoseBenchmarkProvider.infer`` so benchmarks compare providers through
ONE common schema instead of incompatible coordinate definitions.

Contract
--------
``infer(frame, roi) -> BenchmarkPose`` where

- ``frame``: dict with ``imageB64`` (PNG/JPEG bytes, base64), ``widthPx``,
  ``heightPx``, ``cameraId``, ``timestampMs``.
- ``roi``: optional dict ``{x, y, w, h}`` in pixels (AutoLock patient ROI).
  Providers SHOULD crop to the ROI when given (P6: no generic person
  detector in the primary landmark benchmark); when ``roi`` is None the
  provider may use its own detection path and MUST report it.

``BenchmarkPose`` (see ``benchmark_pose``) normalizes to KineLab semantic
landmark ids (``left-knee`` …) with pixel coordinates, raw confidence,
schema provenance, and provider metadata (model, input resolution,
checkpoint + SHA, keypoint schema, license, device).

Provider selection (P28): the Precision pipeline resolves the active
provider via ``KINELAB_PRECISION_POSE_PROVIDER`` (see ``select_provider``).
No pipeline code may hardwire RTMW class names; scientific internals
depend on this interface only.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class BenchmarkObservation:
    landmarkId: str
    xPx: float
    yPx: float
    confidence: float  # raw provider score, uncalibrated
    origin: str = "observed"  # observed | derived | model


@dataclass
class BenchmarkPose:
    observations: list[BenchmarkObservation] = field(default_factory=list)
    missingLandmarks: list[str] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    inputResolution: str = ""  # e.g. "256x192"
    checkpoint: str = ""
    checkpointSha256: str = ""
    keypointSchema: str = ""  # e.g. "coco-wholebody-133"
    schemaVersion: str = ""
    license: str = ""
    device: str = ""  # e.g. "cpu"
    inferenceMs: float = 0.0
    detectionPath: str = "roi"  # roi | own-detector
    frameId: str = ""
    cameraId: str = ""
    timestampMs: float = 0.0


class PoseBenchmarkProvider(Protocol):
    """Standardized benchmark interface for Precision pose providers."""

    @property
    def name(self) -> str: ...  # noqa: D102

    @property
    def metadata(self) -> dict: ...  # noqa: D102

    def infer(self, frame: dict, roi: dict | None = None) -> BenchmarkPose: ...  # noqa: D102


# Registry of Precision pose providers (P28). Keys are the values accepted
# by KINELAB_PRECISION_POSE_PROVIDER. Entries are lazy "module:attr" paths
# so importing this module never pulls in torch/mmpose.
PROVIDER_REGISTRY: dict[str, str] = {
    "rtmw-l-256x192": "providers_rtmw:RTMWBenchmarkProvider",
}

DEFAULT_PROVIDER = "rtmw-l-256x192"


def selected_provider_name() -> str:
    """Active Precision provider from the environment (P28)."""
    return os.environ.get("KINELAB_PRECISION_POSE_PROVIDER", DEFAULT_PROVIDER)


def benchmark_pose(payload: dict, meta: dict) -> BenchmarkPose:
    """Normalize a provider payload (rtmw_schema-style dict) to BenchmarkPose."""
    obs = [
        BenchmarkObservation(
            landmarkId=l["landmarkId"], xPx=float(l["xPx"]), yPx=float(l["yPx"]),
            confidence=float(l.get("confidence", 0.0)),
            origin=str(l.get("origin", "observed")),
        )
        for l in payload.get("landmarks", [])
    ]
    return BenchmarkPose(
        observations=obs,
        missingLandmarks=list(payload.get("missingLandmarks", [])),
        provider=str(payload.get("provider", meta.get("provider", ""))),
        model=str(meta.get("model", "")),
        inputResolution=str(meta.get("inputResolution", "")),
        checkpoint=str(meta.get("checkpoint", "")),
        checkpointSha256=str(meta.get("checkpointSha256", "")),
        keypointSchema=str(payload.get("schemaId", meta.get("keypointSchema", ""))),
        schemaVersion=str(payload.get("schemaVersion", meta.get("schemaVersion", ""))),
        license=str(meta.get("license", "")),
        device=str(meta.get("device", "")),
        inferenceMs=float(payload.get("inferenceMs", 0.0)),
    )
