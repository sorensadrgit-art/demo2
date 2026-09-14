"""Structured backend logging with redaction (R1 release hardening).

Every operational log line is JSON with timestamp/severity/requestId/route/
jobId/stage/status/duration/errorCode. Patient imagery, image bytes, API
keys, Authorization headers, tokens, and biometric embeddings are never
logged — only opaque ids (request/session/trial/job) plus safe metadata.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("kinelab_request_id", default="")

REDACTED_KEYS = frozenset({
    "authorization", "api_key", "apikey", "token", "secret", "password",
    "imageb64", "image_b64", "imagebytes", "embedding", "embeddings",
    "landmarks_raw_pixels",
})


def new_request_id() -> str:
    rid = f"req-{uuid.uuid4().hex[:12]}"
    _request_id.set(rid)
    return rid


def current_request_id() -> str:
    return _request_id.get() or ""


def set_request_id(rid: str) -> None:
    _request_id.set(rid)


def redact(value):
    if isinstance(value, dict):
        return {k: ("<redacted>" if str(k).lower() in REDACTED_KEYS else redact(v))
                for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


_logger = logging.getLogger("kinelab")


def log_event(level: str, route: str, status: str, *,
              job_id: str = "", session_id: str = "",
              stage: str = "", duration_ms: float | None = None,
              error_code: str = "", detail: dict | None = None) -> None:
    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "severity": level.upper(),
        "requestId": current_request_id(),
        "route": route,
        "sessionId": session_id,
        "jobId": job_id,
        "stage": stage,
        "status": status,
        "durationMs": duration_ms,
        "errorCode": error_code,
        "detail": redact(detail or {}),
    }
    fn = getattr(_logger, level.lower(), _logger.info)
    fn(json.dumps(record))
