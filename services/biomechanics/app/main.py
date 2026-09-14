"""FastAPI application: health, calibration, reconstruction, pose,
biomechanics, validation, precision pipeline."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api import health, calibration, pipeline as pipeline_mod
from .api.capture_v61 import capture, process_capture
from .api.pipeline import biomechanics, pose, precision, reconstruction, validation
from .api.precision_v5 import precision_v5
from .api.precision_v56 import precision_v56
from .config import SETTINGS
from .domain.errors import BiomechanicsError
from .logging_util import log_event, new_request_id, set_request_id

logging.basicConfig(level=getattr(logging, SETTINGS.log_level, logging.INFO))

app = FastAPI(title="KineLab Biomechanics", version="2.0.0")

if SETTINGS.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(SETTINGS.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Request-Id"],
        max_age=600,
    )


@app.middleware("http")
async def _request_ids(request: Request, call_next):
    rid = request.headers.get("x-request-id") or new_request_id()
    set_request_id(rid)
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        log_event("info", request.url.path, "ok",
                  duration_ms=round((time.perf_counter() - t0) * 1000, 1))
        return response
    except Exception as e:  # noqa: BLE001 — 500 envelope with request id
        log_event("error", request.url.path, "exception",
                  duration_ms=round((time.perf_counter() - t0) * 1000, 1),
                  error_code=type(e).__name__)
        return JSONResponse(status_code=500, headers={"X-Request-Id": rid},
                            content={"code": "INTERNAL_ERROR",
                                     "message": "internal error",
                                     "requestId": rid})


@app.exception_handler(BiomechanicsError)
async def _domain_error(_: Request, exc: BiomechanicsError):
    return JSONResponse(status_code=422, content=exc.to_dict())


app.include_router(health.router)
app.include_router(calibration.router)
app.include_router(reconstruction)
app.include_router(pose)
app.include_router(biomechanics)
app.include_router(validation)
app.include_router(precision)
app.include_router(precision_v5)
app.include_router(precision_v56)
app.include_router(capture)
app.include_router(process_capture)


@app.get("/")
def root():
    return {"service": "kinelab-biomechanics", "version": "2.0.0"}


@app.get("/version")
def version():
    """Safe build metadata: versions and channel, never secrets or paths."""
    from .api.precision_v56 import PIPELINE_V56
    import subprocess

    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:  # noqa: BLE001
        sha = "unknown"
    return {
        "service": "kinelab-biomechanics",
        "version": "2.0.0",
        "gitSha": sha or "unknown",
        "releaseChannel": SETTINGS.release_channel,
        "precisionPipeline": PIPELINE_V56,
    }


@app.get("/ready")
def ready():
    """Readiness: process alive + required production deps usable.

    Research Preview is APP_READY even when Precision is degraded; the
    precision block reports exactly which runtime is missing.
    """
    from .runtime import runtime_status

    rt = runtime_status()
    precision_ok = bool(rt.get("precision_runtime"))
    reasons: list[str] = []
    if not rt.get("rtmw"):
        reasons.append(f"RTMW unavailable: {rt.get('rtmw_reason')}")
    if not rt.get("opensim"):
        reasons.append(f"OpenSim unavailable: {rt.get('opensim_reason')}")
    return {
        "status": "APP_READY" if precision_ok else "PRECISION_DEGRADED",
        "releaseChannel": SETTINGS.release_channel,
        "storage": "ok",
        "backend": "ok",
        "rtmw": "ok" if rt.get("rtmw") else "unavailable",
        "opensim": "ok" if rt.get("opensim") else "unavailable",
        "precision": "ok" if precision_ok else "degraded",
        "reasons": reasons,
    }
