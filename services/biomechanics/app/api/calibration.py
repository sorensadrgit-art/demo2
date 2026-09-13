"""Calibration + bundle storage API: controlled data only, bundles immutable."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..calibration.charuco import charuco_status
from ..calibration.extrinsic import solve_extrinsic_pnp
from ..calibration.intrinsic import (
    BoardSpec,
    assess_coverage,
    calibrate_chessboard,
)
from ..domain.errors import CameraNotCalibrated
from ..domain.models import CoordinateConvention

router = APIRouter(prefix="/calibration", tags=["calibration"])

STORE = Path(__file__).resolve().parent.parent.parent / "var" / "calibrations"
STORE.mkdir(parents=True, exist_ok=True)


class IntrinsicRequest(BaseModel):
    cameraId: str
    width: int
    height: int
    boardRows: int = 6
    boardColumns: int = 9
    squareSizeM: float = 0.025
    cornerSets: list[list[list[float]]] = Field(description="detected corners per view, Nx1x2")


class ExtrinsicRequest(BaseModel):
    calibrationId: str
    cameraId: str
    objectPointsM: list[list[float]]
    imagePointsPx: list[list[float]]


class ValidateRequest(BaseModel):
    calibrationId: str


def _bundle_path(cid: str) -> Path:
    name = "".join(c for c in cid if c.isalnum() or c in "-_")
    if not name or name != cid:
        raise CameraNotCalibrated(f"invalid calibration id {cid!r}")
    return STORE / f"{name}.json"


def load_bundle(cid: str) -> dict:
    p = _bundle_path(cid)
    if not p.exists():
        raise CameraNotCalibrated(f"unknown calibration {cid}")
    return json.loads(p.read_text())


@router.post("/intrinsic")
def intrinsic(req: IntrinsicRequest):
    corners = [np.array(c, dtype=np.float32) for c in req.cornerSets]
    spec = BoardSpec("chessboard", req.boardRows, req.boardColumns, req.squareSizeM)
    res = calibrate_chessboard(corners, (req.width, req.height), spec)
    K = res.cameraMatrix
    cid = f"cal-{uuid.uuid4().hex[:8]}"
    bundle = {
        "schemaVersion": "1.0",
        "calibrationId": cid,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "coordinateConvention": CoordinateConvention().model_dump(),
        "board": {"type": "chessboard", "rows": spec.rows, "columns": spec.columns, "squareSizeM": spec.squareSizeM},
        "cameras": [{
            "cameraId": req.cameraId,
            "width": req.width, "height": req.height,
            "fx": float(K[0, 0]), "fy": float(K[1, 1]),
            "cx": float(K[0, 2]), "cy": float(K[1, 2]),
            "distortion": [float(x) for x in np.asarray(res.distortion).ravel()],
            "cameraMatrix": K.tolist(),
            "rmsePx": res.rmse, "perViewRmsePx": res.perViewRmse,
        }],
        "overallRmsePx": res.rmse,
        "quality": "engineering-qa",
    }
    _bundle_path(cid).write_text(json.dumps(bundle, indent=2))
    return bundle


@router.post("/extrinsic")
def extrinsic(req: ExtrinsicRequest):
    bundle = load_bundle(req.calibrationId)
    cam = next((c for c in bundle["cameras"] if c["cameraId"] == req.cameraId), None)
    if cam is None:
        raise CameraNotCalibrated(f"{req.cameraId} not in {req.calibrationId}")
    K = np.array(cam["cameraMatrix"])
    dist = np.array(cam["distortion"])
    res = solve_extrinsic_pnp(
        req.cameraId, np.array(req.objectPointsM), np.array(req.imagePointsPx), K, dist
    )
    return {
        "cameraId": req.cameraId,
        "rotation": res.rotation.tolist(),
        "translationM": res.translationM.tolist(),
        "projectionMatrix": res.projectionMatrix.tolist(),
        "rmsePx": res.rmsePx,
        "maxResidualPx": res.maxResidualPx,
    }


@router.post("/validate")
def validate(req: ValidateRequest):
    bundle = load_bundle(req.calibrationId)
    return {
        "calibrationId": req.calibrationId,
        "overallRmsePx": bundle.get("overallRmsePx"),
        "cameras": len(bundle.get("cameras", [])),
        "quality": bundle.get("quality"),
    }


@router.get("/{cid}")
def get_bundle(cid: str):
    return load_bundle(cid)


@router.get("/charuco/status")
def charuco():
    return charuco_status()


@router.post("/detect-chessboard")
def detect(req: IntrinsicRequest):
    return {"note": "server-side image upload not enabled; submit cornerSets", "views": len(req.cornerSets)}


@router.post("/coverage")
def coverage(req: IntrinsicRequest):
    corners = [np.array(c, dtype=np.float32) for c in req.cornerSets]
    rep = assess_coverage(corners, (req.width, req.height))
    return {"valid": rep.valid, "reasons": rep.reasons, "coverage": rep.coverage}


def _fingerprint(obj: object) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:16]
