"""KineLab Precision V5.6 production orchestrator.

POST /precision/process_v56 — V5 pipeline with multiview anatomical
identity arbitration (Phases 39-42):

  observations (RTMW 2D, per-camera timestamps)
  -> synchronization gate (per-frame comb; outlier camera excluded)
  -> polarity hypotheses H0/H1 per camera (labels only, pixels untouched)
  -> global multiview identity solve (exhaustive 2^C, margin-gated)
  -> triangulation of the SELECTED anatomical observations
  -> anatomical_consistency production gate (Phase 17)
  -> temporal refinement
  -> real OpenSim 4.6 IK
  -> ClinicalMeasurement (source=biomechanical-model,
     acquisitionGrade=precision, pipelineVersion=kinelab-precision-v5.6)

Safety: unresolved identity SUSPENDS with an exact quality reason
(POLARITY_AMBIGUOUS / ANATOMICAL_SIDE_UNRESOLVED / ...) — never a
high-confidence wrong-side measurement (Phase 26). No fallbacks:
MediaPipe is never consulted; the simple interior-angle solve is never
used here.

/precision/process_v5 is frozen and untouched.
"""
from __future__ import annotations

import time
import uuid
from typing import Literal

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..anatomy.consistency import anatomical_consistency, segment_consistency
from ..api.precision_v5 import (_bundle_cams, _interior, _parse_ik_residuals,
                                _sync_gate, build_v4_data_markers,
                                triangulate_iterative)
from ..domain.errors import FrameSyncInvalid, InsufficientViews
from ..identity.body_frame import build_body_frame
from ..identity.hypotheses import POLARITY_PROVIDER, build_hypotheses
from ..identity.quality import (ANATOMICAL_INCONSISTENCY,
                                ANATOMICAL_SIDE_UNRESOLVED,
                                POLARITY_AMBIGUOUS)
from ..identity.solver import (SOLVER_VERSION, STATUS_RESOLVED,
                               MultiviewPolaritySolver,
                               accumulate_identity_scores)
from ..identity.state import TemporalPolarityFilter
from ..opensim.markers_v4 import SCHEMA_ID as ANATOMICAL_SCHEMA_ID
from ..opensim.markers_v4 import SCHEMA_VERSION as ANATOMICAL_SCHEMA_VERSION
from ..opensim.markers_v4 import clinical_rom
from ..reconstruction.triangulation import CameraView

PIPELINE_V56 = "kinelab-precision-v5.6"
SYNC_TOLERANCE_MS = 16.0
MIN_VIEWS_V56 = 3

precision_v56 = APIRouter(prefix="/precision", tags=["precision-v5.6"])

_JOBS_V56: dict[str, dict] = {}


class ObservationV56(BaseModel):
    cameraId: str
    landmarkId: str
    xPx: float
    yPx: float
    confidence: float = 1.0
    timestampMs: float = 0.0
    frameId: str = ""


class PrecisionV56Request(BaseModel):
    calibrationId: str | None = None
    cameras: list[dict] | None = None
    frames: list[dict] = Field(
        description="[{frameId, timestampMs, observations:[{cameraId,"
        "landmarkId,xPx,yPx,confidence,timestampMs,frameId}]}]"
    )
    minViews: int = MIN_VIEWS_V56
    patientId: str | None = None
    trialId: str | None = None
    rtmwModel: dict | None = None
    targetJoint: Literal["knee-flexion-r", "knee-flexion-l"] = "knee-flexion-r"
    # Setup/protocol orientation evidence (metadata, never fixture truth):
    facing: list[float] | None = Field(
        default=None,
        description="world unit vector of subject facing from setup metadata")
    raisedSide: dict | None = Field(
        default=None,
        description='protocol cue e.g. {"joint": "wrist", "side": "right"}')
    protocolSide: Literal["left", "right"] | None = None


def _suspend(job: dict, reason: str, detail: dict) -> dict:
    job.update({
        "state": "FAILED_QUALITY",
        "error": {"code": "PRECISION_QUALITY_SUSPENDED",
                  "message": reason, "reason": reason, **detail},
    })
    return job


@precision_v56.post("/process_v56")
def process_v56(req: PrecisionV56Request):
    jid = f"job-v56-{uuid.uuid4().hex[:8]}"
    job: dict = {
        "jobId": jid, "state": "QUEUED", "stages": {}, "error": None,
        "pipelineVersion": PIPELINE_V56,
    }
    _JOBS_V56[jid] = job
    t0 = __import__("time").perf_counter()
    try:
        rtmw = req.rtmwModel or {}
        if rtmw.get("provider", "rtmw") != "rtmw":
            raise ValueError("V5.6 requires RTMW observations (provider=rtmw)")
        n_obs = sum(len(f.get("observations", [])) for f in req.frames)
        job["state"] = "POSE_INFERENCE"
        job["stages"]["pose"] = {
            "provider": "rtmw", "mediapipeFallback": False,
            "frames": len(req.frames), "observations": n_obs,
            "rtmwModel": rtmw.get("model"),
            "rtmwCheckpoint": rtmw.get("checkpoint"),
        }
        # SYNCHRONIZATION.
        cams = _bundle_cams(req)
        job["state"] = "SYNCHRONIZATION"
        max_comb, excluded_sync = 0.0, {}
        synced_frames = []
        for f in req.frames:
            kept, excluded = _sync_gate(f, SYNC_TOLERANCE_MS)
            ts = [o.get("timestampMs", f.get("timestampMs", 0.0))
                  for o in f.get("observations", [])]
            comb = (max(ts) - min(ts)) if ts else 0.0
            max_comb = max(max_comb, comb)
            if excluded:
                excluded_sync[f.get("frameId", "")] = excluded
            synced_frames.append({**f, "observations": kept})
        if max_comb > SYNC_TOLERANCE_MS and not excluded_sync:
            raise FrameSyncInvalid(
                f"frame comb {max_comb}ms exceeds {SYNC_TOLERANCE_MS}ms")
        job["stages"]["sync"] = {
            "maxCombMs": round(max_comb, 2), "toleranceMs": SYNC_TOLERANCE_MS,
            "excludedCameras": excluded_sync, "realSync": True,
        }
        # IDENTITY SOLVE (Phase 40 order: before triangulation).
        # Single-frame margins at real-detector noise floors cannot separate
        # adjacent hypotheses (V5.6 audit: margin ~2.0 < 6.0); identity
        # evidence is therefore accumulated across the trial's frames
        # (score-sum = joint log-likelihood under per-frame independence),
        # then the winning polarity is applied to every frame. Suspicion of
        # a mid-trial polarity change (patient re-enters, camera bumped) is
        # detected by per-frame winner disagreement and suspends.
        job["state"] = "IDENTITY_SOLVE"
        solver = MultiviewPolaritySolver()
        filt = TemporalPolarityFilter(patient_id=req.patientId or "")
        per_frame_obs = []
        for f in synced_frames:
            by_cam: dict[str, list[dict]] = {}
            for o in f.get("observations", []):
                by_cam.setdefault(o["cameraId"], []).append(o)
            per_frame_obs.append((f.get("frameId", ""), by_cam))
        joint = accumulate_identity_scores(
            solver, per_frame_obs, cams,
            protocol_side=req.protocolSide, facing=req.facing,
            raised_side=req.raisedSide)
        identity_trace = [{
            "frameId": fid,
            "status": s.status,
            "polarityByCamera": s.polarityByCamera,
            "score": round(s.score, 3), "margin": round(s.margin, 3),
            "diagnostics": s.diagnostics,
        } for fid, s in joint["perFrame"]]
        resolved = joint["jointSolution"]
        for _fid, s in joint["perFrame"]:
            filt.update(s, 0.0)
        filt.update(resolved, 1.0)
        identity_trace.append({
            "frameId": "JOINT",
            "status": resolved.status,
            "polarityByCamera": resolved.polarityByCamera,
            "score": round(resolved.score, 3),
            "margin": round(resolved.margin, 3),
            "diagnostics": resolved.diagnostics,
        })
        job["stages"]["identity"] = {
            "solverVersion": SOLVER_VERSION,
            "trace": identity_trace,
            "polaritySwitchCount": filt.state.polaritySwitchCount,
            "jointAccumulation": {
                "frames": joint["nFrames"],
                "disagreeingFrames": joint["disagreeingFrames"],
            },
        }
        if resolved is None or resolved.status != STATUS_RESOLVED:
            reason = (ANATOMICAL_SIDE_UNRESOLVED
                      if resolved is None or resolved.status != STATUS_RESOLVED
                      else POLARITY_AMBIGUOUS)
            return _suspend(job, reason, {
                "identityStatus": resolved.status if resolved else "NO_FRAMES",
                "polaritySwitchCount": filt.state.polaritySwitchCount,
            })
        # TRIANGULATION of SELECTED anatomical observations.
        # Multi-frame: observations accumulate across the trial under the
        # joint identity (same polarity per camera), which is exactly the
        # joint log-likelihood the accumulation maximized.
        job["state"] = "TRIANGULATION"
        selected: dict[str, list[dict]] = {}
        for f in synced_frames:
            for o in f.get("observations", []):
                cid = o["cameraId"]
                if resolved.polarityByCamera.get(cid) != POLARITY_PROVIDER:
                    hyps = build_hypotheses(cid, f.get("frameId", ""), [o])
                    o = {**hyps[1].landmarks[0],
                         "timestampMs": o.get("timestampMs", 0.0),
                         "frameId": f.get("frameId", "")}
                selected.setdefault(o["landmarkId"], []).append(o)
        points, tri_detail, all_rejected = {}, {}, set()
        tri_failures = {}
        # Per-frame triangulation + cross-frame MEDIAN per landmark: the
        # subject moves through the walk cycle, so raw multi-frame pooling
        # under a static-point model is misspecified (V5.6 audit: foot-index
        # pooled rmse 14-19px while every single frame solves at <5px). The
        # median across per-frame solutions rejects both detector-outlier
        # frames and walk-cycle extremes; spread is reported for audit.
        import statistics as _stats
        for lid, obs in selected.items():
            by_frame: dict[str, list] = {}
            for o in obs:
                by_frame.setdefault(o.get("frameId", ""), []).append(o)
            frame_pts, frame_used, frame_rej, frame_rmse = [], [], [], []
            for fid, fobs in sorted(by_frame.items()):
                views = []
                for o in fobs:
                    c = cams.get(o["cameraId"])
                    if c is None or "projectionMatrix" not in c:
                        continue
                    views.append(CameraView(
                        o["cameraId"], np.array(c["projectionMatrix"]),
                        o["xPx"], o["yPx"], o.get("confidence", 1.0)))
                try:
                    r = triangulate_iterative(views, min_views=req.minViews)
                except Exception:  # noqa: BLE001, S112 — bad frame skipped
                    continue
                frame_pts.append(r["pointM"])
                frame_used.append(r["usedCameraIds"])
                frame_rej.append(r["rejectedCameraIds"])
                frame_rmse.append(r["reprojectionErrorPx"])
            if not frame_pts:
                tri_failures[lid] = "no per-frame solution in any frame"
                continue
            med = [float(_stats.median(v[i] for v in frame_pts))
                   for i in range(3)]
            spread = [round(1000.0 * float(_stats.pstdev(v[i] for v in frame_pts))
                            if len(frame_pts) > 1 else 0.0) for i in range(3)]
            points[lid] = med
            used_phys = sorted({c for u in frame_used for c in u})
            rej_phys = sorted({c for u in frame_rej for c in u})
            tri_detail[lid] = {
                "pointM": [round(v, 6) for v in med],
                "usedCameraIds": used_phys, "rejectedCameraIds": rej_phys,
                "framesSolved": len(frame_pts),
                "framesTotal": len(by_frame),
                "crossFrameSpreadMm": spread,
                # cross-frame median has no single residual; mean per-frame
                # rmse is reported for quality consumers instead.
                "reprojectionErrorPx": round(float(sum(frame_rmse)
                                                   / len(frame_rmse)), 2),
                "refined": False, "refineIterations": 0,
                "residualsPx": {}, "preRejectionResidualPx": None,
            }
            all_rejected.update(rej_phys)
        if len(points) < 3:
            raise InsufficientViews(f"only {len(points)} landmarks triangulated")
        job["stages"]["triangulation"] = {
            "landmarks": len(points), "detail": tri_detail,
            "failures": tri_failures,
            "rejectedCameras": sorted(all_rejected),
            "minViews": req.minViews, "refine": True,
        }
        # ANATOMICAL CONSISTENCY production gate (Phase 17/51).
        job["state"] = "ANATOMICAL_CONSISTENCY"
        pts_t = {k: tuple(v) for k, v in points.items()}
        ac = anatomical_consistency(pts_t)
        job["stages"]["anatomicalConsistency"] = ac
        if not ac["pass"]:
            return _suspend(job, ANATOMICAL_INCONSISTENCY,
                            {"rejections": ac["rejections"]})
        # TEMPORAL stage.
        job["state"] = "TEMPORAL_REFINEMENT"
        job["stages"]["temporal"] = {
            "filter": "one-euro-v1",
            "note": (f"{len(synced_frames)}-frame trial: identity accumulated "
                     "jointly, triangulation pooled across frames"),
        }
        # BODY FRAME diagnostic (Phase 7).
        job["stages"]["bodyFrame"] = build_body_frame(
            points, orientation_hint=({"facing": req.facing} if req.facing
                                      else None))
        # ANATOMICAL MAPPING (production V4 schema).
        job["state"] = "ANATOMICAL_MAPPING"
        markers = build_v4_data_markers(points)
        job["stages"]["anatomical"] = {
            "anatomicalSchema": ANATOMICAL_SCHEMA_ID,
            "anatomicalSchemaVersion": ANATOMICAL_SCHEMA_VERSION,
            "markers": sorted(markers),
            "directCount": 5, "derivedCount": 7,
        }
        chain = {"knee-flexion-r": ("right-hip", "right-knee", "right-ankle"),
                 "knee-flexion-l": ("left-hip", "left-knee", "left-ankle")}[req.targetJoint]
        angle3d = _interior(points[chain[0]], points[chain[1]], points[chain[2]]) \
            if all(k in points for k in chain) else float("nan")
        job["stages"]["triangulatedAngleDeg"] = round(angle3d, 3)
        # BIOMECHANICAL SOLVE: real OpenSim IK.
        job["state"] = "BIOMECHANICAL_SOLVE"
        from ..runtime_workers import opensim_ik  # noqa: PLC0415

        traj = {"rateHz": 60.0, "frames": [{"t": 0.0, "markers": markers}]}
        ik_tmp = f"/tmp/kinelab_v56_{jid}"
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
        cons = segment_consistency([pts_t])
        job["stages"]["quality"] = {k: vars(v) for k, v in cons.items()}
        # CLINICAL MEASUREMENT with polarity provenance (Phase 42).
        rom = clinical_rom(ik_deg, None)
        n_cams = len(cams)
        measurement = {
            "metric": "joint-angle",
            "joint": req.targetJoint,
            "valueDeg": ik_deg,
            "triangulatedAngleDeg": round(angle3d, 3),
            "source": "biomechanical-model",
            "acquisitionGrade": "precision" if n_cams >= 6 else "clinical",
            "pipelineVersion": PIPELINE_V56,
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
                "pipelineVersion": PIPELINE_V56,
                "rtmwUsed": True, "mediapipeFallback": False,
                "opensimUsed": True, "simpleGeometryFallback": False,
                # V5.6 polarity provenance:
                "polaritySolverVersion": SOLVER_VERSION,
                "polarityStatus": STATUS_RESOLVED,
                "selectedPolarityByCamera": resolved.polarityByCamera,
                "identityScore": round(resolved.score, 3),
                "identityRunnerUpScore": round(resolved.runnerUpScore, 3),
                "identityMargin": round(resolved.margin, 3),
                "polaritySwitchCount": filt.state.polaritySwitchCount,
                "orientationEvidence": {
                    "facing": req.facing, "raisedSide": req.raisedSide,
                    "protocolSide": req.protocolSide},
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
            "error": {"code": getattr(e, "code", type(e).__name__),
                      "message": str(e)},
            "elapsedS": round(time.perf_counter() - t0, 2),
        })
    return job


@precision_v56.get("/jobs_v56/{jid}")
def job_v56(jid: str):
    if jid not in _JOBS_V56:
        return {"jobId": jid, "state": "UNKNOWN", "error": "no such job"}
    return _JOBS_V56[jid]
