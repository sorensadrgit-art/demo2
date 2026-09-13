"""V5.5 resolution comparison: RTMW-L 256x192 vs RTMW-L 384x288 (P5).

Same-pose controlled comparison on the synthetic fixture at a fixed
flexion angle: identical renders are sent to BOTH workers (256 on :8102,
384 on :8103) via PoseBenchmarkProvider, then per-landmark det error vs
truth, dropout, L/R swaps, and latency are compared. No triangulation
tuning, no threshold changes (P2: geometry frozen).

Usage: KINELAB_RTMW_URL=http://127.0.0.1:8102 python3 scripts... (run from
services/biomechanics; needs both workers up).
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.request

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "runtime"))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

MANIFEST_256 = json.load(open("models/rtmw/manifest.json"))

META_384 = {
    "name": "rtmw-l-384x288",
    "provider": "rtmw",
    "model": "rtmw-l 384x288 (cocktail14, COCO-WholeBody)",
    "inputResolution": "384x288",
    "checkpoint": "rtmw-l_384x288.pth",
    "checkpointSha256": None,  # filled at runtime
    "keypointSchema": "coco-wholebody-133",
    "schemaVersion": "1.0",
    "license": "CC BY-NC-SA 4.0 (checkpoint, OpenMMLab model zoo terms)",
    "device": "cpu",
}

URL_256 = os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
URL_384 = os.environ.get("KINELAB_RTMW_384_URL", "http://127.0.0.1:8103")


def infer(url: str, img: np.ndarray, camera_id: str) -> tuple[dict, float]:
    _, buf = cv2.imencode(".png", img)
    body = json.dumps({
        "imageB64": base64.b64encode(bytes(buf)).decode(),
        "cameraId": camera_id,
    }).encode()
    req = urllib.request.Request(url + "/infer", data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.load(r)
    return payload, (time.perf_counter() - t0) * 1000.0


def main() -> int:
    import hashlib
    from vision_v5 import (  # noqa: E402
        ANGLES, LOWER_LIMB, SEED, mirror_of, pose_body_v5, project,
        render_v5, ring_cameras_v5)

    with open("models/rtmw/rtmw-l_384x288.pth", "rb") as f:
        h = hashlib.sha256()
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
        META_384["checkpointSha256"] = h.hexdigest()

    angle = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    assert angle in ANGLES, ANGLES
    truth = pose_body_v5(float(angle))
    cams = ring_cameras_v5()
    rows, lat256, lat384 = [], [], []
    for ci, cam in enumerate(cams):
        img = render_v5(cam["P"], cam["C"], truth, SEED + ANGLES.index(angle) * 100 + ci)
        r256, ms256 = infer(URL_256, img, cam["cameraId"])
        r384, ms384 = infer(URL_384, img, cam["cameraId"])
        lat256.append(ms256)
        lat384.append(ms384)
        l256 = {l["landmarkId"]: l for l in r256["landmarks"]}
        l384 = {l["landmarkId"]: l for l in r384["landmarks"]}
        for lid in LOWER_LIMB:
            if lid not in truth:
                continue
            t = np.array(project(cam["P"], truth[lid]))
            tm = np.array(project(cam["P"], truth[mirror_of(lid)]))
            if float(np.linalg.norm(t - tm)) < 30.0:
                continue
            for tag, lm in (("256", l256.get(lid)), ("384", l384.get(lid))):
                if lm is None:
                    rows.append({"cam": cam["cameraId"], "lid": lid, "tag": tag,
                                 "drop": True})
                    continue
                d = np.array([lm["xPx"], lm["yPx"]])
                rows.append({"cam": cam["cameraId"], "lid": lid, "tag": tag,
                             "errPx": round(float(np.linalg.norm(d - t)), 1),
                             "swap": bool(float(np.linalg.norm(d - tm)) + 15
                                          < float(np.linalg.norm(d - t))),
                             "conf": round(float(lm["confidence"]), 3)})

    def summ(tag: str) -> dict:
        errs = [r["errPx"] for r in rows if r["tag"] == tag and "errPx" in r]
        swaps = sum(1 for r in rows if r["tag"] == tag and r.get("swap"))
        drops = sum(1 for r in rows if r["tag"] == tag and r.get("drop"))
        n = sum(1 for r in rows if r["tag"] == tag)
        e = np.array(errs)
        return {"n": n, "drops": drops, "swaps": swaps,
                "p50": round(float(np.median(e)), 1),
                "p95": round(float(np.quantile(e, 0.95)), 1),
                "max": round(float(e.max()), 1)}

    out = {
        "angle": angle, "seed": SEED,
        "res256": summ("256"), "res384": summ("384"),
        "latencyMs": {
            "256": {"p50": round(float(np.median(lat256)), 1),
                    "p95": round(float(np.quantile(lat256, 0.95)), 1)},
            "384": {"p50": round(float(np.median(lat384)), 1),
                    "p95": round(float(np.quantile(lat384, 0.95)), 1)}},
        "providers": {
            "256": {"model": MANIFEST_256["model"],
                    "checkpointSha256": MANIFEST_256["checkpointSha256"],
                    "inputSize": MANIFEST_256["inputSize"],
                    "license": MANIFEST_256["license"]},
            "384": {k: META_384[k] for k in
                    ("model", "checkpoint", "checkpointSha256",
                     "inputResolution", "keypointSchema", "license", "device")}},
        "rows": rows,
    }
    os.makedirs("/tmp/v55res", exist_ok=True)
    path = f"/tmp/v55res/resolution_a{angle}.json"
    json.dump(out, open(path, "w"), indent=1)
    print(f"angle={angle} 256={out['res256']} lat256={out['latencyMs']['256']}")
    print(f"angle={angle} 384={out['res384']} lat384={out['latencyMs']['384']}")
    print("wrote", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
