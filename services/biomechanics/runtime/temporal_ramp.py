"""V5.5 temporal flexion sequence 0→120→0 stability test (P26).

Renders the synthetic fixture through a smooth flexion ramp
0→30→60→90→120→90→60→30→0 at 30fps-equivalent steps, runs the FULL V5
pipeline per frame (both knees tracked per view for polarity arbitration),
then checks:
  1. angle estimate continuity (no jumps > 15deg frame-to-frame),
  2. polarity arbitration stability per camera (mirrored/correct must not
     flip-flop mid-sequence),
  3. segment-length stability (femur/tibia CV across the sequence),
  4. anatomical_consistency pass rate across the sequence.

No truth is used inside the pipeline (same arbitration as vision_v5);
truth angles are compared only afterwards for the report.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from vision_v5 import (  # noqa: E402
    ANGLES, LOWER_LIMB, SEED, mirror_of, pose_body_v5, project,
    render_v5, ring_cameras_v5)
from app.reconstruction.triangulation import (  # noqa: E402
    CameraView, triangulate_weighted)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.anatomy.consistency import anatomical_consistency  # noqa: E402

RAMP = [0, 15, 30, 45, 60, 75, 90, 105, 120, 105, 90, 75, 60, 45, 30, 15, 0]


def run(url: str) -> dict:
    import base64
    import urllib.request

    import cv2

    truth = {a: pose_body_v5(float(a)) for a in RAMP}
    cams = ring_cameras_v5()
    sweep = []
    lat = []
    for fi, angle in enumerate(RAMP):
        for ci, cam in enumerate(cams):
            img = render_v5(cam["P"], cam["C"], truth[angle],
                            SEED + fi * 100 + ci)
            _, buf = cv2.imencode(".png", img)
            body = json.dumps({
                "imageB64": base64.b64encode(bytes(buf)).decode(),
                "cameraId": cam["cameraId"],
            }).encode()
            req = urllib.request.Request(
                url + "/infer", data=body,
                headers={"Content-Type": "application/json"})
            t0 = time.perf_counter()
            with urllib.request.urlopen(req, timeout=300) as r:
                payload = json.load(r)
            lat.append((time.perf_counter() - t0) * 1000.0)
            for l in payload.get("landmarks", []):
                sweep.append({"frame": fi, "angle": angle,
                              "cameraId": cam["cameraId"],
                              "landmarkId": l["landmarkId"],
                              "xPx": l["xPx"], "yPx": l["yPx"],
                              "confidence": l["confidence"]})
    # polarity arbitration over the SEQUENCE (same rule as vision_v5)
    tracks: dict[str, dict[str, list]] = {}
    for o in sweep:
        if o["landmarkId"] in ("right-knee", "left-knee"):
            tracks.setdefault(o["cameraId"], {}).setdefault(
                o["landmarkId"], []).append(o["xPx"] + 1j * o["yPx"])
    polarity: dict[str, str] = {}
    for cid, tr in tracks.items():
        rk = np.array(tr.get("right-knee", []))
        lk = np.array(tr.get("left-knee", []))
        if len(rk) < 3 or len(lk) < 3:
            polarity[cid] = "unknown"
            continue
        rk_range = float(np.ptp(np.abs(rk - rk[0])))
        lk_range = float(np.ptp(np.abs(lk - lk[0])))
        if rk_range < 40.0 and lk_range > 120.0:
            polarity[cid] = "mirrored"
        elif rk_range > 120.0 and lk_range < 40.0:
            polarity[cid] = "correct"
        else:
            polarity[cid] = "ambiguous"

    angles3d, anat_pass, femora, tibiae = [], 0, [], []
    per_frame = []
    for fi, angle in enumerate(RAMP):
        by_lid: dict[str, list] = {}
        for o in [s for s in sweep if s["frame"] == fi]:
            lid = o["landmarkId"]
            if polarity.get(o["cameraId"]) == "mirrored" and "-" in lid:
                lid = mirror_of(lid)
            by_lid.setdefault(lid, []).append(o)
        pts = {}
        for lid, obs in by_lid.items():
            if lid not in truth[angle]:
                continue
            vs = [CameraView(
                o["cameraId"], next(c["P"] for c in cams
                                    if c["cameraId"] == o["cameraId"]),
                o["xPx"], o["yPx"], o["confidence"]) for o in obs]
            try:
                res = triangulate_weighted(vs, min_views=3,
                                           outlier_threshold_px=8.0,
                                           max_reproj_px=8.0, max_reject_rounds=6)
            except Exception:  # noqa: BLE001
                continue
            pts[lid] = res.pointM
        chain = ("right-hip", "right-knee", "right-ankle")
        if all(k in pts for k in chain):
            a, b, c = (np.array(pts[k]) for k in chain)
            u, v = a - b, c - b
            ang = math.degrees(math.acos(max(-1.0, min(1.0, float(
                np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))))))
            angles3d.append(ang)
            femora.append(float(np.linalg.norm(
                np.array(pts["right-hip"]) - np.array(pts["right-knee"]))))
            tibiae.append(float(np.linalg.norm(
                np.array(pts["right-knee"]) - np.array(pts["right-ankle"]))))
            ac = anatomical_consistency(
                {k: tuple(pts[k]) for k in pts if k in truth[angle]})
            anat_pass += int(ac["pass"])
            per_frame.append({"frame": fi, "truthAngle": angle,
                              "angle3d": round(ang, 2),
                              "angleErr": round(abs(ang - angle), 2),
                              "anatPass": ac["pass"],
                              "rejections": ac["rejections"]})
        else:
            angles3d.append(float("nan"))
            per_frame.append({"frame": fi, "truthAngle": angle,
                              "angle3d": None, "dropout": True})

    jumps = [abs(angles3d[i + 1] - angles3d[i])
             for i in range(len(angles3d) - 1)
             if math.isfinite(angles3d[i]) and math.isfinite(angles3d[i + 1])]
    fem = np.array(femora)
    tib = np.array(tibiae)
    return {
        "ramp": RAMP, "polarity": polarity, "perFrame": per_frame,
        "continuity": {"maxJumpDeg": round(max(jumps), 2) if jumps else None,
                       "jumpsOver15": sum(1 for j in jumps if j > 15)},
        "segments": {"femurR": {"mean": round(float(fem.mean()), 4),
                                "cv": round(float(fem.std() / fem.mean()), 4)},
                     "tibiaR": {"mean": round(float(tib.mean()), 4),
                                "cv": round(float(tib.std() / tib.mean()), 4)}},
        "anatomicalPassRate": f"{anat_pass}/{len(per_frame)}",
        "latencyMs": {"p50": round(float(np.median(lat)), 1),
                      "p95": round(float(np.quantile(lat, 0.95)), 1)},
    }


def main() -> int:
    url = os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
    out = run(url)
    os.makedirs("/tmp/v55res", exist_ok=True)
    json.dump(out, open("/tmp/v55res/temporal_ramp256.json", "w"), indent=1)
    print("polarity:", out["polarity"])
    print("continuity:", out["continuity"])
    print("segments:", out["segments"])
    print("anat:", out["anatomicalPassRate"], "lat:", out["latencyMs"])
    for f in out["perFrame"]:
        print(f["frame"], f["truthAngle"], f.get("angle3d"), f.get("angleErr"),
              "ANAT-FAIL" if f.get("anatPass") is False else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
