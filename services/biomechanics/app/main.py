"""FastAPI application: health, calibration, reconstruction, pose,
biomechanics, validation, precision pipeline."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import health, calibration, pipeline as pipeline_mod
from .api.capture_v61 import capture, process_capture
from .api.pipeline import biomechanics, pose, precision, reconstruction, validation
from .api.precision_v5 import precision_v5
from .api.precision_v56 import precision_v56
from .domain.errors import BiomechanicsError

app = FastAPI(title="KineLab Biomechanics", version="2.0.0")


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
