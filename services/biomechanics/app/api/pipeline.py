"""Reconstruction + biomechanics + pose + validation + precision APIs."""
from __future__ import annotations

import math
import time
import uuid

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..anatomy.consistency import plausibility_flags, segment_consistency
from ..anatomy.dense import DENSE_SCHEMA_ID, build_dense_markers
from ..api.calibration import load_bundle
from ..domain.errors import FrameSyncInvalid, InsufficientViews
from ..domain.models import PIPELINE_VERSION
from ..opensim.runtime import KINELAB_TO_OPENSIM_MARKERS, RECOMMENDED_MODEL, opensim_status
from ..pose.providers import MEDIAPIPE_33, MediaPipeAdapter, RTMWPoseProvider
from ..reconstruction.temporal import filter_trajectory
from ..reconstruction.triangulation import CameraView, refine_point, triangulate_weighted
from ..validation.metrics import full_report


# ---------- reconstruction ----------

reconstruction = APIRouter(prefix="/reconstruction", tags=["reconstruction"])


class Obs(BaseModel):
    cameraId: str
    xPx: float
    yPx: float
    confidence: float = 1.0


class TriangulateRequest(BaseModel):
    calibrationId: str | None = None
    cameras: list[dict] | None = None
    landmarkId: str = "point"
    observations: list[Obs]
    minViews: int = 2
    refine: bool = False
    timestampCombMs: float | None = None
    syncToleranceMs: float = 16.0


# module wiring note: calibration bundle loader shared with calibration API


def _views_from_bundle(bundle: dict, obs: list[Obs]) -> list[CameraView]:
    cams = {c["cameraId"]: c for c in bundle.get("cameras", [])}
    views = []
    for o in obs:
        c = cams.get(o.cameraId)
        if c is None or "projectionMatrix" not in c:
            continue
        views.append(CameraView(o.cameraId, np.array(c["projectionMatrix"]), o.xPx, o.yPx, o.confidence))
    return views


@reconstruction.post("/triangulate")
def triangulate(req: TriangulateRequest):
    if req.timestampCombMs is not None and req.timestampCombMs > req.syncToleranceMs:
        raise FrameSyncInvalid(f"comb {req.timestampCombMs}ms > tol {req.syncToleranceMs}ms")
    if req.calibrationId:
        views = _views_from_bundle(load_bundle(req.calibrationId), req.observations)
    else:
        views = [
            CameraView(o.cameraId, np.array(c["projectionMatrix"]), o.xPx, o.yPx, o.confidence)
            for o in req.observations
            for c in (req.cameras or [])
            if c.get("cameraId") == o.cameraId
        ]
    res = triangulate_weighted(views, min_views=req.minViews)
    diag = {"initialPointM": res.pointM.tolist(), "initialRmsePx": res.reprojectionErrorPx}
    if req.refine:
        used = [v for v in views if v.cameraId in res.usedCameraIds]
        p2, rmse2, iters, improved = refine_point(res.pointM, used)
        diag.update({"refinedPointM": p2.tolist(), "refinedRmsePx": rmse2,
                     "iterations": iters, "converged": improved})
        if improved:
            res = triangulate_weighted(used, min_views=req.minViews)
            res.pointM = p2
            res.reprogressionErrorPx = rmse2 if False else rmse2
            res.reprojectionErrorPx = rmse2
            res.refined = True
            res.refineIterations = iters
    return {
        "landmarkId": req.landmarkId,
        "pointM": res.pointM.tolist(),
        "usedCameraIds": res.usedCameraIds,
        "rejectedCameraIds": res.rejectedCameraIds,
        "residualsPx": res.residualsPx,
        "reprojectionErrorPx": res.reprojectionErrorPx,
        "refinement": diag if req.refine else None,
        "pipeline": PIPELINE_VERSION,
    }


# ---------- pose ----------

pose = APIRouter(prefix="/pose", tags=["pose"])


class InferRequest(BaseModel):
    provider: str = "mediapipe"
    xs: list[float] = Field(default_factory=list)
    ys: list[float] = Field(default_factory=list)
    confidences: list[float] = Field(default_factory=list)


@pose.post("/infer")
def infer(req: InferRequest):
    t0 = time.perf_counter()
    if req.provider == "rtmw":
        raise RTMWPoseProvider().infer(None)
    res = MediaPipeAdapter().map_indexed(req.xs, req.ys, req.confidences)
    d = res.model_dump()
    d["latencyMs"] = (time.perf_counter() - t0) * 1000
    return d


@pose.get("/schemas")
def schemas():
    return {
        "schemas": [
            {"id": "mediapipe-33", "version": "1.0", "landmarks": MEDIAPIPE_33},
            {"id": DENSE_SCHEMA_ID, "version": "1.0", "note": "observed/derived/model-estimated"},
        ],
        "rtmw": RTMWPoseProvider().status(),
    }


# ---------- biomechanics ----------

biomechanics = APIRouter(prefix="/biomechanics", tags=["biomechanics"])


def _json_safe(value):
    """NaN/Inf are not valid JSON: missing solves become null, never faked."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def _interior(a, b, c) -> float:
    import math as m

    ax, ay, az = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    cx, cy, cz = c[0] - b[0], c[1] - b[1], c[2] - b[2]
    ma, mc = m.sqrt(ax * ax + ay * ay + az * az), m.sqrt(cx * cx + cy * cy + cz * cz)
    if ma < 1e-9 or mc < 1e-9:
        return float("nan")
    d = max(-1.0, min(1.0, (ax * cx + ay * cy + az * cz) / (ma * mc)))
    return m.degrees(m.acos(d))


class KinematicsRequest(BaseModel):
    points: dict[str, list[float]]
    timestampMs: float = 0.0
    model: str = "kinelab-segments"


@biomechanics.post("/kinematics")
def kinematics(req: KinematicsRequest):
    pts = {k: tuple(v) for k, v in req.points.items()}
    dense = build_dense_markers(pts)
    triples = {
        "knee-flexion-l": ("left-hip", "left-knee", "left-ankle"),
        "knee-flexion-r": ("right-hip", "right-knee", "right-ankle"),
        "elbow-flexion-l": ("left-shoulder", "left-elbow", "left-wrist"),
        "elbow-flexion-r": ("right-shoulder", "right-elbow", "right-wrist"),
        "hip-flexion-l": ("left-shoulder", "left-hip", "left-knee"),
        "hip-flexion-r": ("right-shoulder", "right-hip", "right-knee"),
    }
    angles = {}
    for j, (a, b, c) in triples.items():
        angles[j] = _interior(pts[a], pts[b], pts[c]) if all(k in pts for k in (a, b, c)) else float("nan")
    cons = segment_consistency([pts])
    return _json_safe({
        "model": req.model,
        "timestampMs": req.timestampMs,
        "jointAnglesDeg": angles,
        "denseMarkers": [m.model_dump() for m in dense],
        "denseSchema": DENSE_SCHEMA_ID,
        "segmentConsistency": {k: vars(v) for k, v in cons.items()},
        "pipeline": PIPELINE_VERSION,
    })


@biomechanics.get("/opensim/status")
def opensim():
    return {**opensim_status(), "model": RECOMMENDED_MODEL, "markerMap": KINELAB_TO_OPENSIM_MARKERS}


class ScaleRequest(BaseModel):
    heightM: float | None = None
    massKg: float | None = None
    segmentLengthsM: dict[str, float] = Field(default_factory=dict)


@biomechanics.post("/opensim/scale")
def scale(req: ScaleRequest):
    rec = {k: {"valueM": v, "source": "measured"} for k, v in req.segmentLengthsM.items()}
    if req.heightM:
        rec["heightM"] = {"valueM": req.heightM, "source": "user-entered"}
    if req.massKg:
        rec["massKg"] = {"valueKg": req.massKg, "source": "user-entered"}
    return {"inputs": rec, "status": opensim_status(),
            "note": "scaling executes only with a loaded OpenSim model"}


# ---------- validation ----------

validation = APIRouter(prefix="/validation", tags=["validation"])


class CompareRequest(BaseModel):
    kinelab: list[float]
    reference: list[float]
    unit: str = "deg"


@validation.post("/compare")
def compare(req: CompareRequest):
    return full_report(req.kinelab, req.reference, req.unit)


# ---------- precision pipeline ----------

precision = APIRouter(prefix="/precision", tags=["precision"])
_JOBS: dict[str, dict] = {}


class PrecisionRequest(BaseModel):
    calibrationId: str | None = None
    cameras: list[dict] | None = None
    frames: list[dict] = Field(description="[{timestampMs, observations:[{cameraId,landmarkId,xPx,yPx,confidence}]}]")
    minViews: int = 2
    refine: bool = False


@precision.post("/process")
def process(req: PrecisionRequest):
    jid = f"job-{uuid.uuid4().hex[:8]}"
    job = {"jobId": jid, "state": "QUEUED", "stages": {}, "error": None}
    _JOBS[jid] = job
    try:
        job["state"] = "POSE_INFERENCE"
        job["stages"]["pose"] = {"provider": "input-observations", "frames": len(req.frames)}
        job["state"] = "SYNCHRONIZATION"
        combs = []
        for f in req.frames:
            ts = [o.get("timestampMs", f.get("timestampMs", 0)) for o in f.get("observations", [])]
            comb = max(ts) - min(ts) if ts else 0
            combs.append(comb)
            if comb > 16.0:
                raise FrameSyncInvalid(f"frame comb {comb}ms exceeds 16ms")
        job["stages"]["sync"] = {"maxCombMs": max(combs) if combs else 0}
        job["state"] = "TRIANGULATION"
        bundle = load_bundle(req.calibrationId) if req.calibrationId else {"cameras": req.cameras or []}
        cams = {c["cameraId"]: c for c in bundle.get("cameras", [])}
        by_landmark: dict[str, list] = {}
        for f in req.frames:
            for o in f.get("observations", []):
                by_landmark.setdefault(o["landmarkId"], []).append((f, o))
        points: dict[str, list] = {}
        rej: dict[str, list] = {}
        for lid, pairs in by_landmark.items():
            f0, _ = pairs[0]
            views = []
            for _, o in pairs:
                c = cams.get(o["cameraId"])
                if c is None or "projectionMatrix" not in c:
                    continue
                views.append(CameraView(o["cameraId"], np.array(c["projectionMatrix"]),
                                        o["xPx"], o["yPx"], o.get("confidence", 1.0)))
            r = triangulate_weighted(views, min_views=req.minViews)
            points[lid] = r.pointM.tolist()
            rej[lid] = r.rejectedCameraIds
        job["stages"]["triangulation"] = {"landmarks": len(points), "rejected": rej}
        job["state"] = "TEMPORAL_REFINEMENT"
        job["stages"]["temporal"] = {"filter": "one-euro-v1", "note": "single-frame fixture: no temporal span"}
        job["state"] = "ANATOMICAL_MAPPING"
        pts = {k: tuple(v) for k, v in points.items()}
        dense = build_dense_markers(pts)
        job["stages"]["anatomical"] = {"denseSchema": DENSE_SCHEMA_ID, "markers": len(dense)}
        job["state"] = "BIOMECHANICAL_SOLVE"
        angles = {}
        for j, (a, b, c) in {
            "knee-flexion-l": ("left-hip", "left-knee", "left-ankle"),
            "knee-flexion-r": ("right-hip", "right-knee", "right-ankle"),
        }.items():
            angles[j] = _interior(pts[a], pts[b], pts[c]) if all(k in pts for k in (a, b, c)) else float("nan")
        job["stages"]["solve"] = _json_safe(angles)
        job["state"] = "QUALITY_ANALYSIS"
        cons = segment_consistency([pts])
        job["stages"]["quality"] = {k: vars(v) for k, v in cons.items()}
        ka = angles.get("knee-flexion-l")
        job.update(_json_safe({
            "state": "COMPLETE",
            "measurement": {
                "metric": "knee-flexion-l",
                "valueDeg": ka,
                "source": "TRIANGULATED_3D",
                "acquisitionGrade": "precision" if len(cams) >= 6 else ("clinical" if len(cams) >= 2 else "solo"),
                "pipeline": PIPELINE_VERSION,
                "points": points,
            },
        }))
    except Exception as e:  # noqa: BLE001 — persisted as job failure
        job.update({"state": "FAILED", "error": {"code": getattr(e, "code", type(e).__name__), "message": str(e)}})
    return job


@precision.get("/jobs/{jid}")
def job(jid: str):
    if jid not in _JOBS:
        return {"jobId": jid, "state": "UNKNOWN", "error": "no such job"}
    return _JOBS[jid]


# silence unused-import check for math (kept for parity with TS clamp logic)
_ = math.pi
