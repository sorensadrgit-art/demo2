"""KineLab physical capture bundle v6.1: schema, hashing, validation.

A capture bundle is produced on a PHYSICAL CAPTURE WORKSTATION (where real
cameras exist) and imported into this backend for Precision V5.6 processing:

  session-<uuid>/
    manifest.json                  session-level metadata
    calibration/calibration.json   real physical calibration (KineLab schema)
    cameras/<camId>/video.mp4 (or frames/NNNNNN.png) + timestamps.csv
    events.jsonl                   session events (optional)
    SHA256SUMS.txt                 sha256 of every file above

Design rules (V6.1 spec):
- never invent metadata: unknown fields are null, never fabricated;
- synchronization is declared AND verified: UNSYNCHRONIZED bundles are
  rejected for Precision (Phase 41);
- originals are immutable: ingest only reads; derived caches live elsewhere;
- captureOrigin=physical alone is not trusted: real recordings + physical
  camera metadata are required (Phase 30).
"""
from __future__ import annotations

import csv
import hashlib
from itertools import pairwise
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

BUNDLE_SCHEMA_VERSION = "kinelab-capture-bundle-v6.1"

SyncMethod = Literal[
    "HARDWARE_TRIGGER", "PTP", "GENLOCK", "SHARED_CLOCK",
    "SOFTWARE_SYNC", "UNSYNCHRONIZED",
]

PRECISION_SYNC_METHODS = frozenset(
    {"HARDWARE_TRIGGER", "PTP", "GENLOCK", "SHARED_CLOCK", "SOFTWARE_SYNC"})

MIN_PRECISION_CAMERAS = 3
CLINICAL_CAMERAS = 2
MAX_SYNC_COMB_MS = 16.0

VIDEO_EXTENSIONS = (".mp4", ".mov", ".mkv", ".avi")
FRAME_EXTENSIONS = (".png", ".jpg", ".jpeg", ".bmp")


class CaptureCameraMetadata(BaseModel):
    cameraId: str
    manufacturer: str | None = None
    model: str | None = None
    serial: str | None = None
    width: int | None = None
    height: int | None = None
    frameRateHz: float | None = None
    pixelFormat: str | None = None
    shutterType: str | None = None
    exposure: str | None = None
    gain: str | None = None
    focusState: str | None = None
    interface: str | None = None


class CaptureManifest(BaseModel):
    schemaVersion: str = BUNDLE_SCHEMA_VERSION
    sessionId: str
    createdAt: str = ""
    anonymousSubjectId: str = ""
    protocolId: str = ""
    targetSide: Literal["left", "right"] | None = None
    cameraCount: int = 0
    captureRateHz: float | None = None
    synchronizationMethod: SyncMethod = "UNSYNCHRONIZED"
    captureOrigin: Literal["physical"] = "physical"
    cameras: list[CaptureCameraMetadata] = Field(default_factory=list)
    calibrationId: str = ""
    coordinateConvention: dict = Field(default_factory=dict)
    recordingStartIso: str = ""
    recordingDurationS: float | None = None
    captureSoftware: str = ""
    captureSoftwareVersion: str = ""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def bundle_layout(session_dir: Path) -> dict[str, Path]:
    return {
        "manifest": session_dir / "manifest.json",
        "calibration": session_dir / "calibration" / "calibration.json",
        "events": session_dir / "events.jsonl",
        "checksums": session_dir / "SHA256SUMS.txt",
        "cameras": session_dir / "cameras",
    }


def iter_camera_dirs(session_dir: Path) -> list[Path]:
    cams = session_dir / "cameras"
    if not cams.is_dir():
        return []
    return sorted(p for p in cams.iterdir() if p.is_dir())


def camera_recording_path(cam_dir: Path) -> Path | None:
    for ext in VIDEO_EXTENSIONS:
        hits = sorted(cam_dir.glob(f"*{ext}"))
        if hits:
            return hits[0]
    frames = cam_dir / "frames"
    if frames.is_dir():
        for ext in FRAME_EXTENSIONS:
            if sorted(frames.glob(f"*{ext}")):
                return frames
    return None


def read_timestamps_ns(csv_path: Path) -> list[dict]:
    """Parse timestamps.csv rows -> [{frameIndex, monoNs, hwNs|None}]."""
    rows: list[dict] = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        cols = {c.strip(): c for c in (reader.fieldnames or [])}
        low = {k.lower().replace("_", ""): v for k, v in cols.items()}

        def pick(*names: str) -> str | None:
            for n in names:
                if n in low:
                    return low[n]
            return None

        c_idx = pick("frameindex", "frame", "index")
        c_mono = pick("monotonictimestampns", "monotonicns",
                      "capturetimestampns", "capturens", "timestampns",
                      "timestamp", "t")
        c_hw = pick("hardwaretimestampns", "hardwarens", "hwtimestampns")
        if c_idx is None or c_mono is None:
            raise ValueError(
                f"{csv_path}: need frame-index + timestamp columns, "
                f"got {reader.fieldnames}")
        for row in reader:
            try:
                idx = int(row[c_idx])
                mono = int(row[c_mono])
            except (ValueError, TypeError) as e:
                raise ValueError(
                    f"{csv_path}: bad timestamp row {row}: {e}") from e
            hw = None
            if c_hw and row.get(c_hw) not in (None, ""):
                try:
                    hw = int(row[c_hw])
                except (ValueError, TypeError) as e:
                    raise ValueError(
                        f"{csv_path}: bad hardware timestamp {row}: {e}"
                    ) from e
            rows.append({"frameIndex": idx, "monoNs": mono, "hwNs": hw})
    return rows


def count_frames(recording: Path) -> int:
    if recording.is_dir():  # image sequence
        return sum(1 for ext in FRAME_EXTENSIONS
                   for _ in recording.glob(f"*{ext}"))
    import cv2  # local import: only needed for video bundles
    cap = cv2.VideoCapture(str(recording))
    try:
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        cap.release()
    return n


def decode_frame_bgr(recording: Path, frame_index: int):
    """Deterministic frame decode -> BGR ndarray (0-based frameIndex)."""
    import cv2  # local import: only needed for video bundles
    if recording.is_dir():
        imgs = [p for ext in FRAME_EXTENSIONS
                for p in sorted(recording.glob(f"*{ext}"))]
        if not 0 <= frame_index < len(imgs):
            raise IndexError(
                f"frame {frame_index} out of range ({len(imgs)} frames)")
        img = cv2.imread(str(imgs[frame_index]), cv2.IMREAD_COLOR)
        if img is None:
            raise OSError(f"cannot decode frame image {imgs[frame_index]}")
        return img
    cap = cv2.VideoCapture(str(recording))
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, img = cap.read()
    finally:
        cap.release()
    if not ok or img is None:
        raise OSError(f"cannot decode frame {frame_index} of {recording}")
    return img


def frame_to_b64_png(bgr) -> str:
    import base64

    import cv2  # local import: only needed when decoding frames
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise OSError("png encode failed")
    return base64.b64encode(bytes(buf)).decode()


def parse_sha256sums(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        digest, rel = parts[0], parts[-1].lstrip("./")
        out[rel] = digest
    return out


def render_sha256sums(hashes: dict[str, str]) -> str:
    return "".join(f"{h}  {rel}\n" for rel, h in sorted(hashes.items()))


def hash_bundle_files(session_dir: Path) -> dict[str, str]:
    """sha256 of every bundle file except SHA256SUMS.txt itself."""
    out: dict[str, str] = {}
    for p in sorted(session_dir.rglob("*")):
        if p.is_file() and p.name != "SHA256SUMS.txt":
            out[p.relative_to(session_dir).as_posix()] = sha256_file(p)
    return out


def check_timestamps_monotonic(rows: list[dict]) -> str | None:
    for a, b in pairwise(rows):
        if b["monoNs"] <= a["monoNs"]:
            return (f"non-monotonic timestamps at frame {a['frameIndex']} "
                    f"-> {b['frameIndex']}")
    for i, r in enumerate(rows):
        if r["frameIndex"] != i:
            return (f"frame index gap: row {i} has frameIndex "
                    f"{r['frameIndex']}")
    return None


def calibration_to_v56(bundle_cal: dict) -> dict:
    """Bridge bundle calibration -> V5.6 camera entries (unchanged schema).

    The bundle calibration reuses the existing KineLab calibration schema
    (intrinsics + distortion + projectionMatrix + image dims + RMSE per
    camera); this only renames bundle keys into the shape `_bundle_cams`
    already consumes. No geometry logic is touched.
    """
    cams = []
    for c in bundle_cal.get("cameras", []):
        cams.append({
            "cameraId": c["cameraId"],
            "width": c.get("width"), "height": c.get("height"),
            "fx": c.get("fx"), "fy": c.get("fy"),
            "cx": c.get("cx"), "cy": c.get("cy"),
            "distortion": c.get("distortion", []),
            "cameraMatrix": c.get("cameraMatrix"),
            "projectionMatrix": c.get("projectionMatrix"),
            "rotation": c.get("rotation"),
            "translationM": c.get("translationM"),
            "rmsePx": c.get("rmsePx"),
        })
    return {"cameras": cams}
