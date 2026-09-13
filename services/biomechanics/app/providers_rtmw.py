"""RTMW benchmark-provider adapter (V5.5, Phase P3).

Wraps the RTMW worker HTTP API behind PoseBenchmarkProvider so the
benchmark harness compares RTMW-L 256x192 (and future higher-resolution
checkpoints served by a second worker) through the common schema.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request

from .pose_providers import BenchmarkPose, benchmark_pose


class RTMWBenchmarkProvider:
    """PoseBenchmarkProvider backed by a running RTMW worker."""

    def __init__(self, url: str | None = None, meta: dict | None = None) -> None:
        self._url = url or os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
        self._meta = meta or {"provider": "rtmw"}

    @property
    def name(self) -> str:
        return str(self._meta.get("name", "rtmw-l-256x192"))

    @property
    def metadata(self) -> dict:
        return dict(self._meta)

    def infer(self, frame: dict, roi: dict | None = None) -> BenchmarkPose:
        body = json.dumps({
            "imageB64": frame["imageB64"],
            "cameraId": frame.get("cameraId", ""),
            "patientRoi": roi,
        }).encode()
        req = urllib.request.Request(
            self._url + "/infer", data=body,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.load(r)
        pose = benchmark_pose(payload, self._meta)
        pose.detectionPath = "roi" if roi else "own-detector"
        pose.frameId = str(frame.get("frameId", ""))
        pose.cameraId = str(frame.get("cameraId", ""))
        pose.timestampMs = float(frame.get("timestampMs", 0.0))
        return pose

    def health(self) -> dict:
        with urllib.request.urlopen(self._url + "/health", timeout=10) as r:
            return json.load(r)


def encode_frame_png(img_png: bytes, **kw) -> dict:
    """Build an infer() frame dict from encoded PNG bytes."""
    return {"imageB64": base64.b64encode(img_png).decode(), **kw}
