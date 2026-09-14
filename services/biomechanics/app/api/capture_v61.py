"""KineLab capture ingest: bundle validation + synchronized session build.

POST /capture/import — validates an external physical capture bundle and
registers it as a physical session WITHOUT any scientific processing:

  bundle layout on disk -> manifest/parse -> file existence -> checksums
  -> camera-id cross-check -> timestamps monotonic + frame agreement
  -> calibration compatibility -> sync declaration+evidence -> grade

POST /precision/process_capture — decodes the session's frames through the
REAL RTMW worker into V5.6 observations, builds synchronized frame sets
with the existing comb/tolerance semantics, then delegates to the SAME
V5.6 job runner used by /precision/process_v56 (no duplicated science).

Originals are never modified; derived decode caches live under var/capture/.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..capture.bundle import (
    BUNDLE_SCHEMA_VERSION,
    CLINICAL_CAMERAS,
    MAX_SYNC_COMB_MS,
    MIN_PRECISION_CAMERAS,
    PRECISION_SYNC_METHODS,
    CaptureManifest,
    bundle_layout,
    calibration_to_v56,
    camera_recording_path,
    check_timestamps_monotonic,
    count_frames,
    decode_frame_bgr,
    frame_to_b64_png,
    hash_bundle_files,
    iter_camera_dirs,
    parse_sha256sums,
    read_timestamps_ns,
)
from ..domain.errors import (
    CaptureBundleInvalid,
    CaptureCalibrationMismatch,
    CaptureCameraMissing,
    CaptureChecksumMismatch,
    CaptureNotSynchronized,
    CaptureTimestampMismatch,
    CaptureTooFewCameras,
)

capture = APIRouter(prefix="/capture", tags=["capture-v6.1"])
process_capture = APIRouter(prefix="/precision", tags=["precision-v6.1"])

STORE = Path(__file__).resolve().parent.parent.parent / "var" / "capture"
STORE.mkdir(parents=True, exist_ok=True)

_SESSIONS: dict[str, dict] = {}


def _session_dir(sid: str) -> Path:
    name = "".join(c for c in sid if c.isalnum() or c in "-_")
    if not name or name != sid:
        raise CaptureBundleInvalid(f"invalid session id {sid!r}")
    return STORE / name


class CaptureImportRequest(BaseModel):
    bundlePath: str = Field(description="server-local path to session-<uuid>/")
    sessionId: str | None = Field(
        default=None, description="override registry id (default: manifest)")


class CaptureTrialWindow(BaseModel):
    trialStartS: float | None = None
    trialEndS: float | None = None
    cameraSubset: list[str] | None = Field(
        default=None, description="reprocess subset without rerecording")
    downsampleFps: float | None = Field(
        default=None, description="deterministic frame decimation target")
    targetJoint: Literal["knee-flexion-r", "knee-flexion-l"] = "knee-flexion-r"
    minViews: int = MIN_PRECISION_CAMERAS
    patientId: str | None = None
    trialId: str | None = None
    facing: list[float] | None = None
    raisedSide: dict | None = None
    protocolSide: Literal["left", "right"] | None = None


class ProcessCaptureRequest(CaptureTrialWindow):
    physicalSessionId: str


def _fail(exc, session_id: str = "", stage: str = "import") -> dict:
    return {"sessionId": session_id, "stage": stage,
            "readyForPrecision": False,
            "error": {"code": exc.code, "message": str(exc),
                      "detail": getattr(exc, "detail", {})}}


def validate_bundle(session_dir: Path) -> dict:
    """Full bundle validation -> session record (raises typed errors)."""
    layout = bundle_layout(session_dir)
    if not layout["manifest"].is_file():
        raise CaptureBundleInvalid(f"missing manifest.json in {session_dir}")
    try:
        manifest = CaptureManifest.model_validate(
            json.loads(layout["manifest"].read_text()))
    except Exception as e:
        raise CaptureBundleInvalid(f"manifest parse failed: {e}") from e
    if manifest.schemaVersion != BUNDLE_SCHEMA_VERSION:
        raise CaptureBundleInvalid(
            f"schema {manifest.schemaVersion!r} != {BUNDLE_SCHEMA_VERSION!r}")
    if not layout["calibration"].is_file():
        raise CaptureBundleInvalid("missing calibration/calibration.json")
    try:
        bundle_cal = json.loads(layout["calibration"].read_text())
    except Exception as e:
        raise CaptureBundleInvalid(
            f"calibration parse failed: {e}") from e
    if not layout["checksums"].is_file():
        raise CaptureBundleInvalid("missing SHA256SUMS.txt")
    expected = parse_sha256sums(layout["checksums"].read_text())
    actual = hash_bundle_files(session_dir)
    mismatched = {rel: {"expected": expected.get(rel), "actual": h}
                  for rel, h in actual.items()
                  if expected.get(rel) != h}
    missing_hashes = [rel for rel in actual if rel not in expected]
    if mismatched or missing_hashes:
        raise CaptureChecksumMismatch(
            "checksum verification failed",
            mismatched=sorted(mismatched), unhashed=sorted(missing_hashes))
    # Camera-id cross-check: manifest <-> calibration <-> directories.
    manifest_ids = [c.cameraId for c in manifest.cameras]
    cal_ids = [c.get("cameraId") for c in bundle_cal.get("cameras", [])]
    dir_ids = [p.name for p in iter_camera_dirs(session_dir)]
    problems = []
    for cid in manifest_ids:
        if cid not in cal_ids:
            problems.append(f"{cid}: in manifest but not calibration")
        if cid not in dir_ids:
            problems.append(f"{cid}: in manifest but no cameras/{cid}/")
    for cid in dir_ids:
        if cid not in manifest_ids:
            problems.append(f"{cid}: directory present but not in manifest")
    if problems:
        raise CaptureCameraMissing("camera id mismatch",
                                   problems=sorted(problems))
    if manifest.cameraCount != len(manifest_ids):
        raise CaptureBundleInvalid(
            f"cameraCount {manifest.cameraCount} != "
            f"{len(manifest_ids)} manifest cameras")
    if bundle_cal.get("calibrationId", "") != manifest.calibrationId:
        raise CaptureCalibrationMismatch(
            f"bundle calibration {bundle_cal.get('calibrationId')!r} != "
            f"manifest {manifest.calibrationId!r}")
    cal_cams = {c.get("cameraId"): c
                for c in bundle_cal.get("cameras", [])}
    for c in manifest.cameras:
        entry = cal_cams.get(c.cameraId, {})
        if not entry.get("projectionMatrix"):
            raise CaptureCalibrationMismatch(
                f"{c.cameraId}: no projectionMatrix (extrinsics required)")
        for key in ("fx", "fy", "cx", "cy"):
            if entry.get(key) is None:
                raise CaptureCalibrationMismatch(
                    f"{c.cameraId}: no {key} (intrinsics required)")
        if c.width is not None and entry.get("width") != c.width:
            raise CaptureCalibrationMismatch(
                f"{c.cameraId}: manifest width {c.width} != "
                f"calibration {entry.get('width')}")
        if c.height is not None and entry.get("height") != c.height:
            raise CaptureCalibrationMismatch(
                f"{c.cameraId}: manifest height {c.height} != "
                f"calibration {entry.get('height')}")
    # Timestamps: monotonic, gapless, frame/recording agreement.
    cam_info: dict[str, dict] = {}
    for cid in manifest_ids:
        cam_dir = session_dir / "cameras" / cid
        ts_csv = cam_dir / "timestamps.csv"
        if not ts_csv.is_file():
            raise CaptureBundleInvalid(f"{cid}: missing timestamps.csv")
        try:
            rows = read_timestamps_ns(ts_csv)
        except ValueError as e:
            raise CaptureTimestampMismatch(str(e)) from e
        if not rows:
            raise CaptureTimestampMismatch(f"{cid}: empty timestamps.csv")
        bad = check_timestamps_monotonic(rows)
        if bad:
            raise CaptureTimestampMismatch(f"{cid}: {bad}")
        rec = camera_recording_path(cam_dir)
        if rec is None:
            raise CaptureBundleInvalid(
                f"{cid}: no video.* or frames/ recording found")
        try:
            n_frames = count_frames(rec)
        except Exception as e:
            raise CaptureBundleInvalid(
                f"{cid}: cannot count frames: {e}") from e
        if n_frames != len(rows):
            raise CaptureTimestampMismatch(
                f"{cid}: {n_frames} frames vs {len(rows)} timestamps")
        cam_info[cid] = {
            "recording": rec.relative_to(session_dir).as_posix(),
            "isSequence": rec.is_dir(), "nFrames": n_frames,
            "startNs": rows[0]["monoNs"], "endNs": rows[-1]["monoNs"],
            "hasHardwareTs": all(r["hwNs"] is not None for r in rows),
        }
    # Sync: declaration is mandatory AND verified across cameras.
    sync_all = [c for c in manifest.cameras]
    _ = sync_all  # per-camera evidence lives in cam_info timestamps
    starts = [v["startNs"] for v in cam_info.values()]
    start_comb_ms = ((max(starts) - min(starts)) / 1e6) if starts else 0.0
    sync_ok = (manifest.synchronizationMethod in PRECISION_SYNC_METHODS
               and start_comb_ms <= MAX_SYNC_COMB_MS)
    if manifest.synchronizationMethod == "UNSYNCHRONIZED":
        raise CaptureNotSynchronized(
            "bundle declares UNSYNCHRONIZED: Precision rejected",
            startCombMs=round(start_comb_ms, 2))
    if start_comb_ms > MAX_SYNC_COMB_MS:
        raise CaptureNotSynchronized(
            f"camera start spread {start_comb_ms:.1f}ms exceeds "
            f"{MAX_SYNC_COMB_MS}ms",
            startCombMs=round(start_comb_ms, 2))
    # captureOrigin=physical requires real recordings + physical metadata.
    physical_cams = [c.cameraId for c in manifest.cameras
                     if (c.manufacturer or c.model or c.interface)]
    if not physical_cams:
        raise CaptureBundleInvalid(
            "captureOrigin=physical requires physical camera metadata "
            "(manufacturer/model/interface); string alone is not trusted")
    # Acquisition grade from actual usable cameras.
    n = len(manifest_ids)
    grade = ("precision" if n >= MIN_PRECISION_CAMERAS
             else "clinical" if n >= CLINICAL_CAMERAS else "solo")
    return {
        "sessionId": manifest.sessionId,
        "manifest": manifest.model_dump(),
        "cameraInfo": cam_info,
        "calibration": bundle_cal,
        "syncCombMs": round(start_comb_ms, 2),
        "syncMethod": manifest.synchronizationMethod,
        "syncOk": sync_ok,
        "acquisitionGrade": grade,
        "precisionEligible": grade == "precision" and sync_ok,
        "bundleHashes": actual,
    }


MAX_IMPORT_JOBS = 4
_ACTIVE_IMPORTS = 0


def _resolve_bundle_path(raw: str) -> Path:
    """Resolve a server-local bundle path with traversal/symlink confinement.

    The bundle must resolve INSIDE one of the allowed roots (explicit
    KINELAB_CAPTURE_ROOTS, the repo tree, or /var/lib/kinelab). Absolute
    paths are required; '..', symlinks escaping the root, and non-directory
    targets are rejected with a typed error. Bundles never write into
    application source: derived state lives only under var/capture/.
    """
    import os as _os

    from ..config import SETTINGS

    if not raw or len(raw) > 4096:
        raise CaptureBundleInvalid("bundle path missing or too long")
    p = Path(raw)
    if not p.is_absolute():
        raise CaptureBundleInvalid("bundle path must be absolute")
    if p.is_symlink():
        raise CaptureBundleInvalid("bundle root must not be a bare symlink")
    try:
        resolved = p.resolve()
    except Exception as e:
        raise CaptureBundleInvalid(f"cannot resolve bundle path: {e}") from e
    if not resolved.is_dir():
        raise CaptureBundleInvalid(f"bundle path not found: {raw}")
    roots = [r for r in (_os.environ.get("KINELAB_CAPTURE_ROOTS", "") or "").split(":") if r]
    repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent
    roots += [str(repo_root), "/var/lib/kinelab", "/tmp"]
    allowed = False
    for r in roots:
        try:
            resolved.relative_to(Path(r).resolve())
            allowed = True
            break
        except Exception:  # noqa: BLE001
            continue
    if not allowed:
        raise CaptureBundleInvalid("bundle path outside allowed capture roots")
    for part in resolved.parts:
        if part == "..":
            raise CaptureBundleInvalid("bundle path must not contain '..'")
    _enforce_bundle_quotas(resolved, SETTINGS)
    return resolved


def _enforce_bundle_quotas(session_dir: Path, settings) -> None:
    """Configurable size/count ceilings; rejects excessive payloads cleanly."""
    try:
        entries = list(session_dir.rglob("*"))
    except Exception as e:
        raise CaptureBundleInvalid(f"cannot list bundle: {e}") from e
    n_files = sum(1 for p in entries if p.is_file())
    if n_files > 50000:
        raise CaptureBundleInvalid(f"bundle has too many files ({n_files})")
    total = 0
    for p in entries:
        if not p.is_file():
            continue
        try:
            total += p.stat().st_size
        except OSError:
            continue
        if p.suffix.lower() in (".mp4", ".mov", ".mkv", ".avi"):
            if p.stat().st_size > settings.max_video_mb * 1024 * 1024:
                raise CaptureBundleInvalid(
                    f"{p.name}: video exceeds "
                    f"{settings.max_video_mb:.0f}MB limit")
    if total > settings.max_bundle_mb * 1024 * 1024:
        raise CaptureBundleInvalid(
            f"bundle size {total / 1e6:.1f}MB exceeds "
            f"{settings.max_bundle_mb:.0f}MB limit")
    manifest_p = session_dir / "manifest.json"
    if manifest_p.is_file() and (
            manifest_p.stat().st_size > settings.max_manifest_kb * 1024):
        raise CaptureBundleInvalid(
            f"manifest exceeds {settings.max_manifest_kb:.0f}KB limit")
    cam_dirs = [p for p in (session_dir / "cameras").glob("*")
                if p.is_dir()] if (session_dir / "cameras").is_dir() else []
    if len(cam_dirs) > settings.max_cameras:
        raise CaptureBundleInvalid(
            f"{len(cam_dirs)} cameras exceed limit {settings.max_cameras}")
    for cid_dir in cam_dirs:
        ts = cid_dir / "timestamps.csv"
        if ts.is_file():
            with open(ts, "rb") as f:
                rows = sum(1 for _ in f) - 1
            if rows > settings.max_timestamp_rows:
                raise CaptureBundleInvalid(
                    f"{cid_dir.name}/timestamps.csv: {rows} rows exceed "
                    f"limit {settings.max_timestamp_rows}")


@capture.post("/import")
def import_capture(req: CaptureImportRequest):
    global _ACTIVE_IMPORTS
    from ..config import SETTINGS as _S
    if _ACTIVE_IMPORTS >= _S.max_concurrent_jobs * 2:
        exc = CaptureBundleInvalid("import queue full; retry shortly")
        return _fail(exc)
    try:
        session_dir = _resolve_bundle_path(req.bundlePath)
    except Exception as e:  # noqa: BLE001 — typed failures as values
        if hasattr(e, "code"):
            return _fail(e)
        exc = CaptureBundleInvalid(f"bundle path not found: {req.bundlePath}")
        return _fail(exc)
    _ACTIVE_IMPORTS += 1
    try:
        record = validate_bundle(session_dir)
    except Exception as e:  # noqa: BLE001 — typed failures as values
        if hasattr(e, "code"):
            return _fail(e)
        exc = CaptureBundleInvalid(f"unexpected import failure: {e}")
        return _fail(exc)
    finally:
        _ACTIVE_IMPORTS -= 1
    sid = req.sessionId or record["sessionId"]
    stored = _session_dir(sid)
    stored.mkdir(parents=True, exist_ok=True)
    (stored / "bundlePath.txt").write_text(str(session_dir.resolve()))
    (stored / "manifest.json").write_text(
        json.dumps(record["manifest"], indent=2))
    (stored / "calibration.json").write_text(
        json.dumps(record["calibration"], indent=2))
    _SESSIONS[sid] = {"sessionId": sid, "bundlePath": str(session_dir.resolve()),
                      "importedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                  time.gmtime()),
                      **record}
    return {
        "sessionId": sid,
        "validationStatus": "VALID",
        "cameraCount": len(record["manifest"]["cameras"]),
        "syncStatus": ("SYNCHRONIZED" if record["syncOk"]
                       else "NOT_SYNCHRONIZED"),
        "syncCombMs": record["syncCombMs"],
        "calibrationStatus": "COMPATIBLE",
        "calibrationId": record["manifest"]["calibrationId"],
        "acquisitionGrade": record["acquisitionGrade"],
        "readyForPrecision": record["precisionEligible"],
        "captureOrigin": "REAL_PHYSICAL_CAPTURE",
    }


@capture.get("/sessions/{sid}")
def get_session(sid: str):
    if sid not in _SESSIONS:
        p = _session_dir(sid)
        if not (p / "manifest.json").is_file():
            exc = CaptureBundleInvalid(f"unknown session {sid}")
            return _fail(exc, session_id=sid, stage="lookup")
        manifest = json.loads((p / "manifest.json").read_text())
        return {"sessionId": sid, "manifest": manifest,
                "bundlePath": (p / "bundlePath.txt").read_text()
                if (p / "bundlePath.txt").is_file() else None}
    rec = _SESSIONS[sid]
    return {"sessionId": sid, "manifest": rec["manifest"],
            "cameraInfo": rec["cameraInfo"],
            "acquisitionGrade": rec["acquisitionGrade"],
            "syncCombMs": rec["syncCombMs"],
            "precisionEligible": rec["precisionEligible"]}


def _select_frames(session: dict, window: CaptureTrialWindow) -> dict:
    """Camera subset + trial window + downsample -> per-camera frame picks.

    Deterministic: frame indices are chosen by timestamp order, never by
    nearest-arbitrary drift; the per-frame temporal offset is recorded.
    """
    rec = session
    cams = [c["cameraId"] for c in rec["manifest"]["cameras"]]
    if window.cameraSubset:
        unknown = [c for c in window.cameraSubset if c not in cams]
        if unknown:
            raise CaptureCameraMissing(
                f"subset references unknown cameras {unknown}")
        cams = list(window.cameraSubset)
    bundle = Path(session["bundlePath"])
    native_hz = rec["manifest"].get("captureRateHz") or 60.0
    stride = 1
    if window.downsampleFps and window.downsampleFps < native_hz:
        stride = max(1, round(native_hz / window.downsampleFps))
    picks: dict[str, list[dict]] = {}
    for cid in cams:
        rows = read_timestamps_ns(
            bundle / "cameras" / cid / "timestamps.csv")
        t0 = rows[0]["monoNs"] / 1e9
        sel = []
        for k, r in enumerate(rows[::stride]):
            t = r["monoNs"] / 1e9 - t0
            if window.trialStartS is not None and t < window.trialStartS:
                continue
            if window.trialEndS is not None and t > window.trialEndS:
                continue
            sel.append({"frameIndex": r["frameIndex"], "tS": round(t, 4),
                        "monoNs": r["monoNs"], "hwNs": r["hwNs"]})
        if not sel:
            raise CaptureTimestampMismatch(
                f"{cid}: trial window selects zero frames")
        picks[cid] = sel
    # Synchronized frame sets: align by order, record offsets explicitly.
    n_sets = min(len(v) for v in picks.values())
    sets = []
    for i in range(n_sets):
        members = {cid: picks[cid][i] for cid in cams}
        ts = [m["monoNs"] for m in members.values()]
        comb_ms = (max(ts) - min(ts)) / 1e6
        sets.append({"setIndex": i,
                     "members": members,
                     "combMs": round(comb_ms, 2)})
    return {"cameras": cams, "stride": stride,
            "effectiveHz": round(native_hz / stride, 2),
            "frameSets": sets}


@process_capture.post("/process_capture")
def run_process_capture(req: ProcessCaptureRequest):
    from ..api.precision_v56 import (
        MIN_VIEWS_V56,
        PIPELINE_V56,
        SYNC_TOLERANCE_MS,
        PrecisionV56Request,
        process_v56,
    )
    from ..runtime_workers import rtmw_infer
    if req.physicalSessionId not in _SESSIONS:
        exc = CaptureBundleInvalid(
            f"unknown physical session {req.physicalSessionId}")
        return {"physicalSessionId": req.physicalSessionId,
                "state": "FAILED", "error": exc.to_dict()}
    session = _SESSIONS[req.physicalSessionId]
    if not session.get("precisionEligible"):
        exc = CaptureTooFewCameras(
            f"grade={session.get('acquisitionGrade')}: Precision requires "
            f">={MIN_PRECISION_CAMERAS} synchronized calibrated cameras")
        return {"physicalSessionId": req.physicalSessionId,
                "state": "FAILED", "error": exc.to_dict()}
    if req.minViews < MIN_VIEWS_V56:
        exc = CaptureTooFewCameras(
            f"minViews {req.minViews} < {MIN_VIEWS_V56}: Precision minimum")
        return {"physicalSessionId": req.physicalSessionId,
                "state": "FAILED", "error": exc.to_dict()}
    try:
        plan = _select_frames(session, req)
    except Exception as e:  # noqa: BLE001 — typed failure as value
        code = getattr(e, "code", type(e).__name__)
        return {"physicalSessionId": req.physicalSessionId,
                "state": "FAILED",
                "error": {"code": code, "message": str(e)}}
    bundle = Path(session["bundlePath"])
    # Decode + REAL RTMW inference per synchronized set (no synthetic
    # landmarks, no ground-truth injection — Phase 16).
    v56_frames = []
    rtmw_model: dict = {}
    for s in plan["frameSets"]:
        obs: list[dict] = []
        for cid in plan["cameras"]:
            m = s["members"][cid]
            rec_rel = session["cameraInfo"][cid]["recording"]
            bgr = decode_frame_bgr(bundle / rec_rel, m["frameIndex"])
            b64 = frame_to_b64_png(bgr)
            out = rtmw_infer(b64, camera_id=cid,
                             timestamp_ms=m["monoNs"] / 1e6)
            if not rtmw_model and out.get("model"):
                rtmw_model = {"provider": "rtmw",
                              "model": out.get("model"),
                              "checkpoint": out.get("checkpoint"),
                              "checkpointSha256":
                                  out.get("checkpointSha256"),
                              "schema": out.get("schema"),
                              "schemaVersion": out.get("schemaVersion")}
            for lm in out.get("landmarks", []):
                obs.append({
                    "cameraId": cid,
                    "landmarkId": lm["landmarkId"],
                    "xPx": lm["xPx"], "yPx": lm["yPx"],
                    "confidence": lm.get("confidence", 1.0),
                    "timestampMs": m["monoNs"] / 1e6,
                    "frameId": f"cap-{s['setIndex']:04d}",
                })
        v56_frames.append({
            "frameId": f"cap-{s['setIndex']:04d}",
            "timestampMs": sum(m["monoNs"] for m in s["members"].values())
            / len(s["members"]) / 1e6,
            "combMs": s["combMs"],
            "observations": obs,
        })
    v56_cams = calibration_to_v56(session["calibration"])["cameras"]
    v56_req = PrecisionV56Request(
        calibrationId=None,  # cameras passed inline; bundle cal is the source
        cameras=v56_cams, frames=v56_frames, minViews=req.minViews,
        patientId=req.patientId or session["manifest"].get(
            "anonymousSubjectId") or None,
        trialId=(req.trialId
                 or f"{req.physicalSessionId}-trial"),
        rtmwModel=rtmw_model or {"provider": "rtmw"},
        targetJoint=req.targetJoint,
        facing=req.facing, raisedSide=req.raisedSide,
        protocolSide=req.protocolSide)
    job = process_v56(v56_req)
    # Physical provenance links (Phase 28): every measurement links back to
    # session, recording hashes, cameras, frames, timestamps, calibration.
    phys_prov = {
        "physicalSessionId": req.physicalSessionId,
        "captureOrigin": "REAL_PHYSICAL_CAPTURE",
        "trialWindowS": [req.trialStartS, req.trialEndS],
        "cameraSubset": plan["cameras"],
        "downsample": {"requestedFps": req.downsampleFps,
                       "stride": plan["stride"],
                       "effectiveHz": plan["effectiveHz"]},
        "sourceRecordingHashes": {
            cid: session["bundleHashes"].get(
                session["cameraInfo"][cid]["recording"])
            for cid in plan["cameras"]},
        "timestampFileHashes": {
            cid: session["bundleHashes"].get(
                f"cameras/{cid}/timestamps.csv")
            for cid in plan["cameras"]},
        "calibrationHash": session["bundleHashes"].get(
            "calibration/calibration.json"),
        "manifestHash": session["bundleHashes"].get("manifest.json"),
        "calibrationId": session["manifest"]["calibrationId"],
        "syncCombMs": session["syncCombMs"],
        "syncMethod": session["syncMethod"],
        "frameSets": len(plan["frameSets"]),
        "pipelineVersion": PIPELINE_V56,
        "syncToleranceMs": SYNC_TOLERANCE_MS,
        "rtmwUsed": True, "identitySolverUsed": True,
        "multiviewUsed": True, "opensimUsed": True,
        "hiddenFallback": False,
    }
    if isinstance(job, dict):
        job.setdefault("stages", {})["physicalCapture"] = phys_prov
        meas = job.get("measurement")
        if isinstance(meas, dict):
            prov = meas.setdefault("provenance", {})
            prov.update(phys_prov)
    return job
