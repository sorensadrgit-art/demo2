"""KineLab production configuration contract (R1 release hardening).

All production behavior is driven by environment variables documented in
the repo-root `.env.example`. No secrets are committed. Startup fails
fast with an explicit reason when required production values are invalid,
instead of surfacing as a broken patient assessment later.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

RELEASE_CHANNELS = ("DEVELOPMENT", "RESEARCH_PREVIEW", "CLINICAL_RESEARCH")

DEFAULT_CORS_DEV = "http://127.0.0.1:8011,http://localhost:8011"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be a number, got {os.environ.get(name)!r}")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        raise ValueError(f"{name} must be an integer, got {os.environ.get(name)!r}")


@dataclass
class Settings:
    release_channel: str = "DEVELOPMENT"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8101
    cors_origins: list[str] = field(default_factory=list)
    rtmw_url: str = "http://127.0.0.1:8102"
    opensim_model_path: str = ""
    storage_root: str = ""
    max_bundle_mb: float = 4096.0
    max_video_mb: float = 2048.0
    max_cameras: int = 12
    max_manifest_kb: float = 256.0
    max_timestamp_rows: int = 200000
    max_concurrent_jobs: int = 2
    log_level: str = "INFO"

    def problems(self) -> list[str]:
        out: list[str] = []
        if self.release_channel not in RELEASE_CHANNELS:
            out.append(
                f"KINELAB_RELEASE_CHANNEL={self.release_channel!r} invalid; "
                f"expected one of {RELEASE_CHANNELS}")
        for o in self.cors_origins:
            if o == "*":
                out.append(
                    "KINELAB_CORS_ORIGINS must not contain '*' for "
                    "credentialed production use; list explicit origins")
            elif not (o.startswith("http://") or o.startswith("https://")):
                out.append(f"CORS origin {o!r} must start with http:// or https://")
        if not (1 <= self.backend_port <= 65535):
            out.append(f"KINELAB_BACKEND_PORT={self.backend_port} out of range")
        if self.max_bundle_mb <= 0 or self.max_video_mb <= 0:
            out.append("bundle/video size limits must be positive")
        if self.max_cameras < 1 or self.max_cameras > 32:
            out.append("KINELAB_MAX_CAMERAS must be 1..32")
        return out


def load_settings() -> Settings:
    channel = _env("KINELAB_RELEASE_CHANNEL", "DEVELOPMENT").strip() or "DEVELOPMENT"
    cors_raw = _env("KINELAB_CORS_ORIGINS", "")
    if not cors_raw and channel == "DEVELOPMENT":
        cors_raw = DEFAULT_CORS_DEV
    origins = [o.strip() for o in cors_raw.split(",") if o.strip()]
    repo = _env("KINELAB_REPO_ROOT", "/workspace/project/demo2")
    return Settings(
        release_channel=channel,
        backend_host=_env("KINELAB_BACKEND_HOST", "127.0.0.1"),
        backend_port=_env_int("KINELAB_BACKEND_PORT", 8101),
        cors_origins=origins,
        rtmw_url=_env("KINELAB_RTMW_URL", "http://127.0.0.1:8102"),
        opensim_model_path=_env(
            "KINELAB_OPENSIM_MODEL",
            f"{repo}/services/biomechanics/models/opensim/"
            "gait2392_thelen2003muscle.osim"),
        storage_root=_env("KINELAB_STORAGE_ROOT", ""),
        max_bundle_mb=_env_float("KINELAB_MAX_BUNDLE_MB", 4096.0),
        max_video_mb=_env_float("KINELAB_MAX_VIDEO_MB", 2048.0),
        max_cameras=_env_int("KINELAB_MAX_CAMERAS", 12),
        max_manifest_kb=_env_float("KINELAB_MAX_MANIFEST_KB", 256.0),
        max_timestamp_rows=_env_int("KINELAB_MAX_TIMESTAMP_ROWS", 200000),
        max_concurrent_jobs=_env_int("KINELAB_MAX_CONCURRENT_JOBS", 2),
        log_level=_env("KINELAB_LOG_LEVEL", "INFO").upper(),
    )


SETTINGS = load_settings()


def validate_startup() -> list[str]:
    """Collectors of blocking config problems; empty means startable."""
    return SETTINGS.problems()
