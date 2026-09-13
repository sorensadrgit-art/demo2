"""V6.1 INGEST FIXTURE builder (NOT physical validation).

Builds a small deterministic non-patient capture bundle that exercises
bundle mechanics only: file packaging, timestamps, checksums, ingest,
frame decode, synchronized frame sets, camera subsets, downsampling,
provenance. Frames are synthetic stick-figure renders (no human, no
patient); the fixture is labeled INGEST FIXTURE wherever it appears.

Usage:
    python3 tests/fixtures/build_ingest_fixture.py --out /tmp/ingest-fixture
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import cv2
import numpy as np

TESTS_DIR = Path(__file__).resolve().parent
SVC = TESTS_DIR.parent.parent  # tests/capture_fixtures -> services/biomechanics
for _p in (str(SVC),):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from app.capture.bundle import (
    BUNDLE_SCHEMA_VERSION,
    hash_bundle_files,
    render_sha256sums,
)

INGEST_FIXTURE_TAG = "INGEST FIXTURE — synthetic bundle mechanics only"

N_CAMERAS = 3
N_FRAMES = 6
WIDTH, HEIGHT = 320, 240
RATE_HZ = 30.0
FRAME_DT_NS = int(1e9 / RATE_HZ)

# Pinhole cameras on a 2m ring, looking at origin (real extrinsics math,
# synthetic scene — geometry is consistent so decode/sync paths are real).
FX = FY = 300.0
CX, CY = WIDTH / 2.0, HEIGHT / 2.0
K = np.array([[FX, 0, CX], [0, FY, CY], [0, 0, 1.0]])


def _cam_pose(idx: int):
    az = 2 * np.pi * idx / N_CAMERAS
    C = np.array([2.0 * np.cos(az), 0.6, 2.0 * np.sin(az)])
    fwd = -C / np.linalg.norm(C)
    right = np.cross(fwd, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    R = np.stack([right, up, -fwd], axis=0)
    t = -R @ C
    P = K @ np.hstack([R, t.reshape(3, 1)])
    return R, C, P


def _stick_body(phase: float) -> dict[str, np.ndarray]:
    """Non-patient stick figure: torso + limb segments as 3D joints.

    The anatomical RIGHT arm is raised laterally (cued asymmetry): this
    gives the identity solver a genuine left/right signal so the joint
    solve can RESOLVE on the fixture. Still a stick figure — no human,
    no patient, INGEST FIXTURE mechanics only.
    """
    swing = 0.15 * np.sin(phase)
    return {
        "head": np.array([0.0, 1.55, 0.0]),
        "left-shoulder": np.array([0.0, 1.35, -0.20]),
        "right-shoulder": np.array([0.0, 1.35, 0.20]),
        "left-elbow": np.array([0.0, 1.10, -0.22]),
        "right-elbow": np.array([0.02, 1.42, 0.46]),
        "left-wrist": np.array([0.0, 0.88, -0.24]),
        "right-wrist": np.array([0.03, 1.62, 0.62]),
        "left-hip": np.array([0.0, 0.95, -0.10]),
        "right-hip": np.array([0.0, 0.95, 0.10]),
        "left-knee": np.array([swing, 0.50, -0.11]),
        "right-knee": np.array([-swing, 0.50, 0.11]),
        "left-ankle": np.array([2 * swing, 0.08, -0.11]),
        "right-ankle": np.array([-2 * swing, 0.08, 0.11]),
        "left-heel": np.array([2 * swing - 0.03, 0.05, -0.11]),
        "right-heel": np.array([-2 * swing - 0.03, 0.05, 0.11]),
        "left-foot-index": np.array([2 * swing + 0.10, 0.04, -0.11]),
        "right-foot-index": np.array([-2 * swing + 0.10, 0.04, 0.11]),
    }


EDGES = [("head", "left-shoulder"), ("head", "right-shoulder"),
         ("left-shoulder", "right-shoulder"),
         ("left-shoulder", "left-elbow"), ("left-elbow", "left-wrist"),
         ("right-shoulder", "right-elbow"), ("right-elbow", "right-wrist"),
         ("left-shoulder", "left-hip"), ("right-shoulder", "right-hip"),
         ("left-hip", "right-hip"),
         ("left-hip", "left-knee"), ("left-knee", "left-ankle"),
         ("left-ankle", "left-heel"), ("left-heel", "left-foot-index"),
         ("right-hip", "right-knee"), ("right-knee", "right-ankle"),
         ("right-ankle", "right-heel"), ("right-heel", "right-foot-index")]


def _render(P: np.ndarray, body: dict) -> np.ndarray:
    img = np.full((HEIGHT, WIDTH, 3), 24, np.uint8)
    proj = {}
    for name, pt in body.items():
        h = P @ np.append(pt, 1.0)
        proj[name] = (h[:2] / h[2]).astype(int)
    for a, b in EDGES:
        cv2.line(img, tuple(proj[a]), tuple(proj[b]), (240, 240, 240), 3)
    for pt in proj.values():
        cv2.circle(img, tuple(pt), 4, (0, 200, 255), -1)
    return img


def build(out: Path) -> Path:
    session_id = "ingest-fixture-0001"
    root = out / f"session-{session_id}"
    if root.exists():
        raise SystemExit(f"{root} exists — remove first")
    t0 = 1_700_000_000_000_000_000
    Rs, Ps = [], []
    for i in range(N_CAMERAS):
        R, _C, P = _cam_pose(i)
        Rs.append(R.tolist())
        Ps.append(P.tolist())
    cal_cams, manifest_cams = [], []
    for i in range(N_CAMERAS):
        cid = f"cam-{i + 1:02d}"
        cal_cams.append({
            "cameraId": cid, "width": WIDTH, "height": HEIGHT,
            "fx": FX, "fy": FY, "cx": CX, "cy": CY,
            "distortion": [0.0, 0.0, 0.0, 0.0, 0.0],
            "cameraMatrix": K.tolist(), "projectionMatrix": Ps[i],
            "rotation": Rs[i],
            "translationM": (-np.array(Rs[i]) @ np.array(
                [2.0 * np.cos(2 * np.pi * i / N_CAMERAS), 0.6,
                 2.0 * np.sin(2 * np.pi * i / N_CAMERAS)])).tolist(),
            "rmsePx": 0.1,
        })
        manifest_cams.append({
            "cameraId": cid, "manufacturer": "ingest-fixture",
            "model": "synthetic-stick-camera", "serial": None,
            "width": WIDTH, "height": HEIGHT, "frameRateHz": RATE_HZ,
            "pixelFormat": "BGR8", "shutterType": "global",
            "exposure": "locked-5ms", "gain": "0dB",
            "focusState": "locked", "interface": "file-import",
        })
    calibration = {
        "schemaVersion": "1.0", "calibrationId": "cal-ingest-fixture-01",
        "createdAt": "2026-09-13T00:00:00Z",
        "coordinateConvention": {"handedness": "right", "units": "meters",
                                 "worldUp": "+Y",
                                 "rotationSense": "world-to-camera"},
        "board": {"type": "chessboard", "rows": 6, "columns": 9,
                  "squareSizeM": 0.025},
        "cameras": cal_cams, "overallRmsePx": 0.1,
        "quality": "ingest-fixture",
        "fixtureTag": INGEST_FIXTURE_TAG,
    }
    manifest = {
        "schemaVersion": BUNDLE_SCHEMA_VERSION, "sessionId": session_id,
        "createdAt": "2026-09-13T00:00:00Z",
        "anonymousSubjectId": "FIXTURE-NONE",
        "protocolId": "ingest-fixture-protocol",
        "targetSide": "right", "cameraCount": N_CAMERAS,
        "captureRateHz": RATE_HZ,
        "synchronizationMethod": "SHARED_CLOCK",
        "captureOrigin": "physical",
        "cameras": manifest_cams,
        "calibrationId": "cal-ingest-fixture-01",
        "coordinateConvention": calibration["coordinateConvention"],
        "recordingStartIso": "2026-09-13T00:00:00Z",
        "recordingDurationS": round(N_FRAMES / RATE_HZ, 3),
        "captureSoftware": "kinelab-ingest-fixture-builder",
        "captureSoftwareVersion": "6.1",
        "fixtureTag": INGEST_FIXTURE_TAG,
    }
    (root / "calibration").mkdir(parents=True)
    (root / "calibration" / "calibration.json").write_text(
        json.dumps(calibration, indent=2))
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    for i in range(N_CAMERAS):
        cid = f"cam-{i + 1:02d}"
        cam_dir = root / "cameras" / cid
        cam_dir.mkdir(parents=True)
        vw = cv2.VideoWriter(str(cam_dir / "video.mp4"), fourcc,
                             RATE_HZ, (WIDTH, HEIGHT))
        if not vw.isOpened():
            raise RuntimeError("VideoWriter failed (no mp4v codec?)")
        with open(cam_dir / "timestamps.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["frameIndex", "monotonicTimestampNs",
                        "hardwareTimestampNs"])
            for k in range(N_FRAMES):
                body = _stick_body(2 * np.pi * k / N_FRAMES)
                vw.write(_render(np.array(Ps[i]), body))
                mono = t0 + k * FRAME_DT_NS
                w.writerow([k, mono, mono])
        vw.release()
    (root / "events.jsonl").write_text(
        json.dumps({"event": "SESSION_START",
                    "fixtureTag": INGEST_FIXTURE_TAG}) + "\n")
    hashes = hash_bundle_files(root)
    (root / "SHA256SUMS.txt").write_text(render_sha256sums(hashes))
    print(f"built {INGEST_FIXTURE_TAG}: {root} "
          f"({N_CAMERAS} cams x {N_FRAMES} frames)")
    return root


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    build(Path(args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
