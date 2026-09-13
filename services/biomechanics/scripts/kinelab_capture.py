#!/usr/bin/env python3
"""kinelab-capture: workstation CLI for KineLab physical capture bundles.

  kinelab-capture pack --session session.json --calibration calibration.json
      --camera cam01=cam01.mp4 --timestamps cam01=cam01.csv ... --out bundle/
  kinelab-capture inspect <bundle-dir>

pack assembles the versioned bundle layout, copies (never alters) the
originals, and computes SHA256SUMS.txt automatically. inspect reports
camera count, resolution, FPS, sync method, frame counts, duration,
calibration ID, checksum status, and Precision eligibility — no science.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

SVC = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SVC))

from app.capture.bundle import (
    BUNDLE_SCHEMA_VERSION,
    MAX_SYNC_COMB_MS,
    MIN_PRECISION_CAMERAS,
    PRECISION_SYNC_METHODS,
    CaptureManifest,
    bundle_layout,
    hash_bundle_files,
    parse_sha256sums,
    read_timestamps_ns,
    render_sha256sums,
)


def _parse_kv(items: list[str], flag: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"{flag} expects camId=value, got {item!r}")
        k, v = item.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def cmd_pack(args: argparse.Namespace) -> int:
    session = json.loads(Path(args.session).read_text())
    calibration = json.loads(Path(args.calibration).read_text())
    rec_map = _parse_kv(args.camera, "--camera")
    ts_map = _parse_kv(args.timestamps, "--timestamps")
    if set(rec_map) != set(ts_map):
        raise SystemExit("--camera and --timestamps must cover the same ids: "
                         f"{sorted(rec_map)} vs {sorted(ts_map)}")
    cams = session.get("cameras", [])
    if sorted(c["cameraId"] for c in cams) != sorted(rec_map):
        raise SystemExit("session.json cameras must match --camera ids")
    manifest = CaptureManifest.model_validate({
        "schemaVersion": BUNDLE_SCHEMA_VERSION, **session,
        "cameraCount": len(cams),
        "calibrationId": calibration.get("calibrationId", ""),
    })
    out = Path(args.out)
    if out.exists() and any(out.iterdir()) and not args.force:
        raise SystemExit(f"{out} not empty (use --force)")
    layout = bundle_layout(out)
    layout["calibration"].parent.mkdir(parents=True, exist_ok=True)
    for cid in rec_map:
        (out / "cameras" / cid).mkdir(parents=True, exist_ok=True)
    (layout["manifest"]).write_text(
        manifest.model_dump_json(indent=2) + "\n")
    shutil.copy(args.calibration, layout["calibration"])
    for cid, src in rec_map.items():
        dst = out / "cameras" / cid / Path(src).name
        if Path(src).is_dir():
            shutil.copytree(src, dst.parent / "frames", dirs_exist_ok=True)
        else:
            shutil.copy(src, dst)
        shutil.copy(ts_map[cid], out / "cameras" / cid / "timestamps.csv")
    if args.events:
        shutil.copy(args.events, layout["events"])
    else:
        layout["events"].write_text("")
    hashes = hash_bundle_files(out)
    (layout["checksums"]).write_text(render_sha256sums(hashes))
    print(f"packed session {manifest.sessionId}: "
          f"{len(cams)} cameras, {len(hashes)} files -> {out}")
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    bundle = Path(args.bundle)
    layout = bundle_layout(bundle)
    if not layout["manifest"].is_file():
        print("INVALID: missing manifest.json");
        return 1
    manifest = CaptureManifest.model_validate(
        json.loads(layout["manifest"].read_text()))
    cal = (json.loads(layout["calibration"].read_text())
           if layout["calibration"].is_file() else {})
    print(f"session:      {manifest.sessionId}")
    print(f"schema:       {manifest.schemaVersion}")
    print(f"cameras:      {manifest.cameraCount}")
    print(f"sync method:  {manifest.synchronizationMethod}")
    print(f"capture rate: {manifest.captureRateHz} Hz")
    print(f"origin:       {manifest.captureOrigin}")
    total_frames, starts, durs = 0, [], []
    for c in manifest.cameras:
        cid = c.cameraId
        ts_csv = bundle / "cameras" / cid / "timestamps.csv"
        try:
            rows = read_timestamps_ns(ts_csv)
        except (OSError, ValueError) as e:
            print(f"  {cid}: TIMESTAMPS INVALID ({e})")
            continue
        n = len(rows)
        dur = (rows[-1]["monoNs"] - rows[0]["monoNs"]) / 1e9 if n > 1 else 0.0
        total_frames += n
        starts.append(rows[0]["monoNs"])
        durs.append(dur)
        res = f"{c.width}x{c.height}" if c.width else "unknown"
        print(f"  {cid}: {res} @ {c.frameRateHz or '?'}Hz, "
              f"{n} frames, {dur:.2f}s")
    if starts:
        spread = (max(starts) - min(starts)) / 1e6
        print(f"start spread: {spread:.2f}ms "
              f"(limit {MAX_SYNC_COMB_MS}ms)")
        sync_ok = (manifest.synchronizationMethod in PRECISION_SYNC_METHODS
                   and spread <= MAX_SYNC_COMB_MS)
    else:
        sync_ok = False
    print(f"calibration:  {manifest.calibrationId or '(missing)'} "
          f"({len(cal.get('cameras', []))} cameras in bundle calibration)")
    if layout["checksums"].is_file():
        expected = parse_sha256sums(layout["checksums"].read_text())
        actual = hash_bundle_files(bundle)
        bad = [r for r, h in actual.items() if expected.get(r) != h]
        print(f"checksums:    {'OK' if not bad else 'MISMATCH: ' + str(bad)}")
        checks_ok = not bad
    else:
        print("checksums:    MISSING SHA256SUMS.txt")
        checks_ok = False
    eligible = (manifest.cameraCount >= MIN_PRECISION_CAMERAS and sync_ok
                and checks_ok and bool(manifest.calibrationId))
    print(f"precision eligible: {'YES' if eligible else 'NO'}")
    return 0 if eligible else 2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="kinelab-capture",
                                 description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pack", help="assemble a versioned capture bundle")
    p.add_argument("--session", required=True)
    p.add_argument("--calibration", required=True)
    p.add_argument("--camera", action="append", default=[],
                   help="camId=video-or-frames-dir (repeatable)")
    p.add_argument("--timestamps", action="append", default=[],
                   help="camId=timestamps.csv (repeatable)")
    p.add_argument("--events", default=None)
    p.add_argument("--out", required=True)
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_pack)
    q = sub.add_parser("inspect", help="report bundle status, no science")
    q.add_argument("bundle")
    q.set_defaults(fn=cmd_inspect)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
