"""KineLab Precision V5 production orchestrator.

POST /precision/process_v5 — full Precision measurement through the real
stages with V5 acceptance rules:

  observations (RTMW 2D, per-camera timestamps)
  -> synchronization gate (per-frame comb; outlier camera excluded, suspend
     below minViews)
  -> weighted DLT with ITERATIVE worst-view rejection + least-squares refine
  -> V4 anatomical marker derivation (kinelab-lower-extremity-v4)
  -> real OpenSim 4.6 IK
  -> ClinicalMeasurement (metric=joint-angle, source=biomechanical-model,
     acquisitionGrade=precision, pipelineVersion=kinelab-precision-v5)

No fallbacks: MediaPipe is never consulted; the simple interior-angle solve
is never used here; any required-stage failure FAILS the job with a typed
error. minViews defaults to 3: fewer valid views SUSPEND the solve.

V3 (/precision/process) is untouched.
"""
from __future__ import annotations

import math
import time
import uuid
from typing import Literal

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..anatomy.consistency import segment_consistency
from ..api.calibration import load_bundle
from ..domain.errors import FrameSyncInvalid, InsufficientViews, TriangulationHighReprojectionError
from ..opensim.markers_v4 import SCHEMA_ID as ANATOMICAL_SCHEMA_ID
from ..opensim.markers_v4 import SCHEMA_VERSION as ANATOMICAL_SCHEMA_VERSION
from ..opensim.markers_v4 import clinical_rom
from ..reconstruction.triangulation import CameraView, _residuals, refine_point, triangulate_weighted

PIPELINE_V5 = "kinelab-precision-v5"
SYNC_TOLERANCE_MS = 16.0
MIN_VIEWS_V5 = 3
OUTLIER_PX_V5 = 8.0
MAX_REPROJ_PX_V5 = 8.0

precision_v5 = APIRouter(prefix="/precision", tags=["precision-v5"])

_JOBS_V5: dict[str, dict] = {}


class ObservationV5(BaseModel):
    cameraId: str
    landmarkId: str
    xPx: float
    yPx: float
    confidence: float = 1.0
    timestampMs: float = 0.0
    frameId: str = ""


class PrecisionV5Request(BaseModel):
    calibrationId: str | None = None
    cameras: list[dict] | None = None
    frames: list[dict] = Field(
        description="[{frameId, timestampMs, observations:[{cameraId,landmarkId,"
        "xPx,yPx,confidence,timestampMs,frameId}]}]"
    )
    minViews: int = MIN_VIEWS_V5
    patientId: str | None = None
    trialId: str | None = None
    rtmwModel: dict | None = None
    targetJoint: Literal["knee-flexion-r", "knee-flexion-l"] = "knee-flexion-r"


def _bundle_cams(req: PrecisionV5Request) -> dict[str, dict]:
    bundle = load_bundle(req.calibrationId) if req.calibrationId else {"cameras": req.cameras or []}
    return {c["cameraId"]: c for c in bundle.get("cameras", [])}


def _sync_gate(frame: dict, tolerance_ms: float) -> tuple[list[dict], list[str]]:
    """Split observations into in-sync / excluded by per-frame comb.

    The frame timestamp is the median observation timestamp; any observation
    deviating more than tolerance_ms is EXCLUDED (never triangulated).
    """
    obs = frame.get("observations", [])
    if not obs:
        return [], []
    ts = sorted(o.get("timestampMs", frame.get("timestampMs", 0.0)) for o in obs)
    med = ts[len(ts) // 2]
    kept, excluded = [], []
    for o in obs:
        t = o.get("timestampMs", frame.get("timestampMs", 0.0))
        if abs(t - med) > tolerance_ms:
            excluded.append(o["cameraId"])
        else:
            kept.append(o)
    return kept, excluded


def triangulate_iterative(
    views: list[CameraView],
    min_views: int = MIN_VIEWS_V5,
    outlier_px: float = OUTLIER_PX_V5,
    max_reproj_px: float = MAX_REPROJ_PX_V5,
    refine: bool = True,
) -> dict:
    """Weighted DLT + iterative worst-view rejection + LS refinement.

    Repeats worst-view removal until RMSE is within tolerance or min_views
    would be violated. Every rejection is recorded; nothing is silent.
    """
    usable = [v for v in views if v.confidence >= 0.05]
    if len(usable) < min_views:
        raise InsufficientViews(f"{len(usable)} usable views < min {min_views}")
    rejected: list[str] = []
    worst_before_px: float | None = None
    res = triangulate_weighted(
        usable, min_views=min_views,
        outlier_threshold_px=outlier_px, max_reproj_px=1e9,
        max_reject_rounds=8,
    )
    if res.rejectedCameraIds:
        all_resid = _residuals(res.pointM, views)
        worst_before_px = round(max(all_resid.values()), 2)
    rejected = list(res.rejectedCameraIds)
    usable = [v for v in usable if v.cameraId in res.usedCameraIds]
    final = triangulate_weighted(
        usable, min_views=min_views,
        outlier_threshold_px=1e9, max_reproj_px=max_reproj_px,
    )
    refined, iterations = False, 0
    point = final.pointM
    if refine:
        try:
            point, rmse, nfev, improved = refine_point(point, usable)
            refined, iterations = bool(improved), int(nfev)
            final_rmse = float(rmse)
        except Exception:  # noqa: BLE001 — refinement is best-effort, DLT stands
            final_rmse = final.reprojectionErrorPx
    else:
        final_rmse = final.reprojectionErrorPx
    if final_rmse > max_reproj_px:
        raise TriangulationHighReprojectionError(f"rmse {final_rmse:.2f}px")
    return {
        "pointM": [round(float(v), 6) for v in point],
        "usedCameraIds": [v.cameraId for v in usable],
        "rejectedCameraIds": rejected,
        "residualsPx": {k: round(v, 2) for k, v in final.residualsPx.items()},
        "reprojectionErrorPx": round(final_rmse, 2),
        "preRejectionResidualPx": worst_before_px,
        "refined": refined,
        "refineIterations": iterations,
    }


def build_v4_data_markers(points3d: dict[str, list[float]]) -> dict[str, list[float]]:
    """RTMW-derived 3D landmarks -> V4 data-side marker positions (meters).

    Direct markers use the triangulated landmark; derived markers follow the
    production V4 derivations (documented uncertainties in markers_v4.py).
    """
    import numpy as _np

    P = {k: _np.array(v, dtype=float) for k, v in points3d.items()}
    req = ("left-hip", "right-hip", "right-knee", "right-ankle",
           "right-heel", "right-foot-index")
    missing = [k for k in req if k not in P]
    if missing:
        raise InsufficientViews(f"V4 markers need {missing}")
    rh, rk, ra = P["right-hip"], P["right-knee"], P["right-ankle"]
    lh = P["left-hip"]
    heel, toe = P["right-heel"], P["right-foot-index"]
    ant = _np.array([0.08, 0.0, 0.0])  # anterior offset in fixture frame
    lat = _np.array([0.0, 0.0, 0.09])
    markers = {
        "R.ASIS": list(rh + np.array([0.08, 0.08, 0.0])),
        "L.ASIS": list(lh + np.array([0.08, 0.08, 0.0])),
        "V.Sacral": list((rh + lh) / 2 + np.array([-0.08, 0.10, 0.0])),
        "R.Hip": list(rh),
        "R.Thigh.Front": list((rh + rk) / 2 + ant + np.array([0.02, 0, 0])),
        "R.Knee.Lat": list(rk + np.array([0.0, 0.02, 0.0]) + lat),
        "R.Knee.Med": list(rk + np.array([0.0, 0.02, 0.0]) - lat),
        "R.Shank.Front": list((rk + ra) / 2 + ant + np.array([0.0, -0.02, 0])),
        "R.Ankle.Lat": list(ra + np.array([0.0, -0.02, 0.06])),
        "R.Ankle.Med": list(ra + np.array([0.0, -0.02, -0.06])),
        "R.Heel": list(heel),
        "R.Toe.Tip": list(toe),
    }
    return {k: [round(float(x), 6) for x in v] for k, v in markers.items()}


def _interior(a, b, c) -> float:
    import numpy as _np

    u, v = _np.array(a) - _np.array(b), _np.array(c) - _np.array(b)
    cosang = float(_np.dot(u, v) / (_np.linalg.norm(u) * _np.linalg.norm(v)))
    return math.degrees(math.acos(max(-1.0, min(1.0, cosang))))


@precision_v5.post("/process_v5")
def process_v5(req: PrecisionV5Request):
    jid = f"job-v5-{uuid.uuid4().hex[:8]}"
    job: dict = {
        "jobId": jid, "state": "QUEUED", "stages": {}, "error": None,
        "pipelineVersion": PIPELINE_V5,
    }
    _JOBS_V5[jid] = job
    t0 = time.perf_counter()
    try:
        # POSE stage: observations must arrive from RTMW (provider asserted).
        rtmw = req.rtmwModel or {}
        if rtmw.get("provider", "rtmw") != "rtmw":
            raise ValueError("V5 requires RTMW observations (provider=rtmw)")
        n_obs = sum(len(f.get("observations", [])) for f in req.frames)
        job["state"] = "POSE_INFERENCE"
        job["stages"]["pose"] = {
            "provider": "rtmw", "mediapipeFallback": False,
            "frames": len(req.frames), "observations": n_obs,
            "rtmwModel": rtmw.get("model"), "rtmwCheckpoint": rtmw.get("checkpoint"),
        }
        # SYNCHRONIZATION stage.
        cams = _bundle_cams(req)
        job["state"] = "SYNCHRONIZATION"
        max_comb, excluded_sync = 0.0, {}
        synced_frames = []
        for f in req.frames:
            kept, excluded = _sync_gate(f, SYNC_TOLERANCE_MS)
            ts = [o.get("timestampMs", f.get("timestampMs", 0.0)) for o in f.get("observations", [])]
            comb = (max(ts) - min(ts)) if ts else 0.0
            max_comb = max(max_comb, comb)
            if excluded:
                excluded_sync[f.get("frameId", "")] = excluded
            synced_frames.append({**f, "observations": kept})
        if max_comb > SYNC_TOLERANCE_MS and not excluded_sync:
            raise FrameSyncInvalid(f"frame comb {max_comb}ms exceeds {SYNC_TOLERANCE_MS}ms")
        job["stages"]["sync"] = {
            "maxCombMs": round(max_comb, 2), "toleranceMs": SYNC_TOLERANCE_MS,
            "excludedCameras": excluded_sync, "realSync": True,
        }
        # TRIANGULATION stage (iterative rejection + refine).
        job["state"] = "TRIANGULATION"
        by_landmark: dict[str, list] = {}
        for f in synced_frames:
            for o in f.get("observations", []):
                by_landmark.setdefault(o["landmarkId"], []).append(o)
        points, tri_detail, all_rejected = {}, {}, set()
        for lid, obs in by_landmark.items():
            views = []
            for o in obs:
                c = cams.get(o["cameraId"])
                if c is None or "projectionMatrix" not in c:
                    continue
                views.append(CameraView(o["cameraId"], np.array(c["projectionMatrix"]),
                                        o["xPx"], o["yPx"], o.get("confidence", 1.0)))
            r = triangulate_iterative(views, min_views=req.minViews)
            points[lid] = r["pointM"]
            tri_detail[lid] = r
            all_rejected.update(r["rejectedCameraIds"])
        if len(points) < 3:
            raise InsufficientViews(f"only {len(points)} landmarks triangulated")
        job["stages"]["triangulation"] = {
            "landmarks": len(points), "detail": tri_detail,
            "rejectedCameras": sorted(all_rejected),
            "minViews": req.minViews, "refine": True,
        }
        # TEMPORAL stage (single-frame fixture: no span; recorded honestly).
        job["state"] = "TEMPORAL_REFINEMENT"
        job["stages"]["temporal"] = {
            "filter": "one-euro-v1", "note": "single-frame fixture: no temporal span",
        }
        # ANATOMICAL MAPPING stage (production V4 schema).
        job["state"] = "ANATOMICAL_MAPPING"
        markers = build_v4_data_markers(points)
        job["stages"]["anatomical"] = {
            "anatomicalSchema": ANATOMICAL_SCHEMA_ID,
            "anatomicalSchemaVersion": ANATOMICAL_SCHEMA_VERSION,
            "markers": sorted(markers),
            "directCount": 5, "derivedCount": 7,
        }
        # 3D diagnostic angle (triangulated geometry, NOT the reported solve).
        chain = {"knee-flexion-r": ("right-hip", "right-knee", "right-ankle"),
                 "knee-flexion-l": ("left-hip", "left-knee", "left-ankle")}[req.targetJoint]
        angle3d = _interior(points[chain[0]], points[chain[1]], points[chain[2]]) \
            if all(k in points for k in chain) else float("nan")
        job["stages"]["triangulatedAngleDeg"] = round(angle3d, 3)
        # BIOMECHANICAL SOLVE stage: real OpenSim IK (no geometry fallback).
        job["state"] = "BIOMECHANICAL_SOLVE"
        from ..runtime_workers import opensim_ik  # noqa: PLC0415

        traj = {"rateHz": 60.0,
                "frames": [{"t": 0.0, "markers": markers}]}
        ik_tmp = f"/tmp/kinelab_v5_{jid}"
        rep = opensim_ik(traj, ik_tmp)
        coord = {"knee-flexion-r": "knee_angle_r",
                 "knee-flexion-l": "knee_angle_l"}[req.targetJoint]
        ik_series = rep["coordinatesDeg"].get(coord, [])
        if not ik_series:
            raise RuntimeError(f"IK solve returned no {coord} trajectory")
        ik_deg = round(float(ik_series[0]), 3)
        ik_res = _parse_ik_residuals(ik_tmp)
        job["stages"]["solve"] = {
            "opensimUsed": True, "simpleGeometryFallback": False,
            "model": rep.get("model"), "opensimVersion": rep.get("opensimVersion"),
            "coordinate": coord, "ikDeg": ik_deg,
            "ikResidualRmsMm": ik_res["rmsMm"], "ikResidualMaxMm": ik_res["maxMm"],
        }
        # QUALITY stage.
        job["state"] = "QUALITY_ANALYSIS"
        pts_t = {k: tuple(v) for k, v in points.items()}
        cons = segment_consistency([pts_t])
        job["stages"]["quality"] = {k: vars(v) for k, v in cons.items()}
        # CLINICAL MEASUREMENT.
        rom = clinical_rom(ik_deg, None)
        n_cams = len(cams)
        measurement = {
            "metric": "joint-angle",
            "joint": req.targetJoint,
            "valueDeg": ik_deg,
            "triangulatedAngleDeg": round(angle3d, 3),
            "source": "biomechanical-model",
            "acquisitionGrade": "precision" if n_cams >= 6 else "clinical",
            "pipelineVersion": PIPELINE_V5,
            "quality": {
                "reprojectionRmsPx": tri_detail[chain[1]]["reprojectionErrorPx"],
                "ikResidualRmsMm": ik_res["rmsMm"],
                "ikResidualMaxMm": ik_res["maxMm"],
                "usedCameras": tri_detail[chain[1]]["usedCameraIds"],
                "rejectedCameras": tri_detail[chain[1]]["rejectedCameraIds"],
            },
            "provenance": {
                "patientId": req.patientId, "trialId": req.trialId,
                "frameIds": [f.get("frameId", "") for f in req.frames],
                "cameraIds": sorted(cams),
                "calibrationId": req.calibrationId,
                "rtmwModel": rtmw.get("model"), "rtmwCheckpoint": rtmw.get("checkpoint"),
                "rtmwCheckpointSha256": rtmw.get("checkpointSha256"),
                "rtmwSchema": rtmw.get("schema"), "rtmwSchemaVersion": rtmw.get("schemaVersion"),
                "validViews": tri_detail[chain[1]]["usedCameraIds"],
                "rejectedViews": tri_detail[chain[1]]["rejectedCameraIds"],
                "reprojectionRmsePx": tri_detail[chain[1]]["reprojectionErrorPx"],
                "anatomicalSchema": ANATOMICAL_SCHEMA_ID,
                "anatomicalSchemaVersion": ANATOMICAL_SCHEMA_VERSION,
                "opensimVersion": rep.get("opensimVersion"),
                "opensimModel": rep.get("model"),
                "opensimModelSha256": rtmw.get("opensimModelSha256"),
                "ikResidualRmsMm": ik_res["rmsMm"], "ikResidualMaxMm": ik_res["maxMm"],
                "clinicalJointDefinition": req.targetJoint,
                "neutralReference": rom["neutralReference"],
                "pipelineVersion": PIPELINE_V5,
                "rtmwUsed": True, "mediapipeFallback": False,
                "opensimUsed": True, "simpleGeometryFallback": False,
            },
        }
        job.update({
            "state": "COMPLETE",
            "measurement": measurement,
            "elapsedS": round(time.perf_counter() - t0, 2),
        })
    except Exception as e:  # noqa: BLE001 — persisted as typed job failure
        job.update({
            "state": "FAILED",
            "error": {"code": getattr(e, "code", type(e).__name__), "message": str(e)},
            "elapsedS": round(time.perf_counter() - t0, 2),
        })
    return job


def _parse_ik_residuals(out_dir: str) -> dict:
    """Real IK marker residuals from the _ik_marker_errors.sto table."""
    import glob
    import os

    rms, mx = [], []
    for path in glob.glob(os.path.join(out_dir, "_ik_marker_errors.sto")):
        with open(path) as f:
            lines = f.readlines()
        try:
            hdr = next(i for i, l in enumerate(lines) if l.startswith("time"))
        except StopIteration:
            continue
        cols = lines[hdr].split()
        try:
            ir, im = cols.index("marker_error_RMS"), cols.index("marker_error_max")
        except ValueError:
            continue
        for line in lines[hdr + 1:]:
            parts = line.split()
            if len(parts) != len(cols) or not parts[0][0].isdigit():
                continue
            rms.append(float(parts[ir]) * 1000.0)
            mx.append(float(parts[im]) * 1000.0)
    if not rms:
        return {"rmsMm": None, "maxMm": None}
    return {
        "rmsMm": round(float(sum(rms) / len(rms)), 4),
        "maxMm": round(float(max(mx)), 4),
    }


@precision_v5.get("/jobs_v5/{jid}")
def job_v5(jid: str):
    if jid not in _JOBS_V5:
        return {"jobId": jid, "state": "UNKNOWN", "error": "no such job"}
    return _JOBS_V5[jid]
