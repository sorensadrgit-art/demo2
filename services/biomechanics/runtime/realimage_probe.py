"""V5.5 Domain-B real-image 2D probe (P7/P9/P10/P11/P12/P14).

COCO-2017 val persons with labeled knees/ankles (real photographs, GT 2D
keypoints) through RTMW-L 256x192 AND 384x288 via PoseBenchmarkProvider.
P6: GT bbox is passed as the patient ROI — no person-detector error in the
primary landmark benchmark. Compares det-vs-GT pixel error (normalized by
bbox size), dropout, and L/R-swap proxy per provider, per landmark
(hip/knee/ankle), plus knee-flexion-stratified error where both knees and
ankles are labeled (pose proxy for flexion: hip-knee-ankle GT angle).

Writes /tmp/v55res/realimage_probe.json. Read-only wrt repo (no data
committed; COCO license documented in the V5.5 report).
"""
from __future__ import annotations

import base64
import json
import math
import os
import sys
import time
import urllib.request
import zipfile

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

COCO_DIR = "/tmp/coco20/imgs"
ANN_ZIP = "/tmp/coco20/annotations.zip"
URL_256 = os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
URL_384 = os.environ.get("KINELAB_RTMW_384_URL", "http://127.0.0.1:8103")

# COCO-17 keypoint indices
KP = {"left-hip": 11, "right-hip": 12, "left-knee": 13, "right-knee": 14,
      "left-ankle": 15, "right-ankle": 16}


def infer(url: str, img: np.ndarray, roi: dict, tag: str) -> tuple[dict, float]:
    _, buf = cv2.imencode(".png", img)
    body = json.dumps({
        "imageB64": base64.b64encode(bytes(buf)).decode(),
        "cameraId": "coco-" + tag,
        "patientRoi": roi,
    }).encode()
    req = urllib.request.Request(url + "/infer", data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.load(r)
    return payload, (time.perf_counter() - t0) * 1000.0


def gt_angle(a, b, c) -> float | None:
    u, v = np.array(a) - np.array(b), np.array(c) - np.array(b)
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu < 1e-6 or nv < 1e-6:
        return None
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(u, v) / (nu * nv))))))


def main() -> int:
    z = zipfile.ZipFile(ANN_ZIP)
    ann = json.loads(z.read("annotations/person_keypoints_val2017.json"))
    imgs = {i["id"]: i for i in ann["images"]}
    sl = json.load(open("/tmp/coco20/shortlist.json"))
    fileset = set(sl["files"])

    rows, lat = [], {"256": [], "384": []}
    n_img = 0
    for a in ann["annotations"]:
        if a["category_id"] != 1:
            continue
        im = imgs[a["image_id"]]
        if im["file_name"] not in fileset:
            continue
        path = os.path.join(COCO_DIR, im["file_name"])
        if not os.path.exists(path):
            continue
        img = cv2.imread(path)
        if img is None:
            continue
        kp = np.array(a["keypoints"]).reshape(17, 3)
        x, y, w, h = a["bbox"]
        roi = {"x": x, "y": y, "width": w, "height": h}
        scale = math.sqrt(w * h)  # normalization size
        gt = {}
        for lid, idx in KP.items():
            gx, gy, v = kp[idx]
            if v > 0:
                gt[lid] = (float(gx) * img.shape[1] / im["width"],
                           float(gy) * img.shape[0] / im["height"])
        if len(gt) < 4:
            continue
        n_img += 1
        # GT knee flexion proxy per side
        flex = {}
        for s in ("left", "right"):
            ks = (f"{s}-hip", f"{s}-knee", f"{s}-ankle")
            if all(k in gt for k in ks):
                flex[s] = gt_angle(gt[ks[0]], gt[ks[1]], gt[ks[2]])
        for url, tag in ((URL_256, "256"), (URL_384, "384")):
            try:
                payload, ms = infer(url, img, roi, tag)
            except Exception as e:  # noqa: BLE001 — record worker failure
                rows.append({"img": im["file_name"], "tag": tag,
                             "error": str(e)[:120]})
                continue
            lat[tag].append(ms)
            lm = {l["landmarkId"]: l for l in payload.get("landmarks", [])}
            for lid, g in gt.items():
                l = lm.get(lid)
                if l is None:
                    rows.append({"img": im["file_name"], "tag": tag,
                                 "lid": lid, "drop": True,
                                 "flexDeg": flex.get(lid.split("-")[0])})
                    continue
                d = np.array([l["xPx"], l["yPx"]]) - np.array(g)
                rows.append({"img": im["file_name"], "tag": tag, "lid": lid,
                             "errPx": round(float(np.linalg.norm(d)), 1),
                             "errNorm": round(float(np.linalg.norm(d)) / scale, 4),
                             "conf": round(float(l["confidence"]), 3),
                             "flexDeg": (round(flex[lid.split("-")[0]], 1)
                                         if lid.split("-")[0] in flex else None)})

    def summ(tag: str) -> dict:
        es = [r["errPx"] for r in rows if r.get("tag") == tag and "errPx" in r]
        dr = sum(1 for r in rows if r.get("tag") == tag and r.get("drop"))
        er = sum(1 for r in rows if r.get("tag") == tag and r.get("error"))
        if not es:
            return {"n": 0, "drops": dr, "errors": er}
        e = np.array(es)
        return {"n": len(es), "drops": dr,
                "p50": round(float(np.median(e)), 1),
                "p95": round(float(np.quantile(e, 0.95)), 1),
                "max": round(float(e.max()), 1)}

    out = {"images": n_img, "rows": rows,
           "res256": summ("256"), "res384": summ("384"),
           "latencyMs": {t: {"p50": round(float(np.median(v)), 1),
                             "p95": round(float(np.quantile(v, 0.95)), 1),
                             "n": len(v)} for t, v in lat.items()},
           "dataset": {"name": "COCO-2017 val (person subset, knee/ankle labeled)",
                       "source": "http://images.cocodataset.org",
                       "license": "CC BY 4.0 (images Flickr; annotations COCO)"}}
    json.dump(out, open("/tmp/v55res/realimage_probe.json", "w"), indent=1)
    print("images:", n_img, "256:", out["res256"], "384:", out["res384"])
    print("lat:", out["latencyMs"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
