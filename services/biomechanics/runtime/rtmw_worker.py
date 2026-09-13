"""RTMW pose worker: local HTTP worker over the isolated kinelab-rtmw venv.

Runs ONLY inside services/biomechanics/runtime/kinelab-rtmw/bin/python
(provisioned by services/biomechanics/scripts/provision_rtmw.sh; the
vendored services/biomechanics/runtime/rtmw_compat/mmdet stub ships with
the repo and is exposed via a .pth file, so no PYTHONPATH is needed).
Loads RTMW-L once, serves POST /infer {imageB64, patientRoi?, cameraId,
timestampMs} -> 133 keypoints mapped to KineLab schema.

Binds 127.0.0.1 only. No patient imagery leaves the machine.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = None
MODEL_INFO: dict = {}


def load_model(cfg: str, ckpt: str, device: str) -> None:
    global MODEL, MODEL_INFO
    from mmpose.apis import init_model  # noqa: PLC0415

    t0 = time.perf_counter()
    MODEL = init_model(cfg, ckpt, device=device)
    MODEL_INFO = {
        "model": "rtmw-l 256x192 (cocktail14)",
        "config": cfg.split("/")[-1],
        "checkpoint": ckpt.split("/")[-1],
        "device": device,
        "loadMs": round((time.perf_counter() - t0) * 1000.0, 1),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # noqa: ANN002,ANN202
        pass

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: ANN202
        if self.path == "/health":
            import torch  # noqa: PLC0415

            self._send(200, {"ok": True, "modelLoaded": MODEL is not None,
                             "model": MODEL_INFO, "torch": torch.__version__})
        else:
            self._send(404, {"ok": False})

    def do_POST(self):  # noqa: ANN202
        if self.path != "/infer":
            self._send(404, {"ok": False})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n) or b"{}")
            import cv2  # noqa: PLC0415
            import numpy as np  # noqa: PLC0415
            from mmpose.apis import inference_topdown  # noqa: PLC0415
            from rtmw_schema import map_inference  # noqa: PLC0415

            raw = base64.b64decode(req["imageB64"])
            img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                self._send(400, {"ok": False, "code": "POSE_DECODE_FAILED"})
                return
            h, w = img.shape[:2]
            roi = req.get("patientRoi")
            x_off, y_off = 0.0, 0.0
            if roi:
                x, y, rw, rh = (float(roi["x"]), float(roi["y"]),
                                float(roi["width"]), float(roi["height"]))
                x0, y0 = max(0, int(x)), max(0, int(y))
                x1, y1 = min(w, int(x + rw)), min(h, int(y + rh))
                if x1 > x0 and y1 > y0:
                    img = img[y0:y1, x0:x1]
                    x_off, y_off = float(x0), float(y0)
            t0 = time.perf_counter()
            results = inference_topdown(MODEL, img)
            infer_ms = (time.perf_counter() - t0) * 1000.0
            if not len(results):
                self._send(200, {"ok": False, "code": "POSE_INFERENCE_FAILED",
                                 "message": "no person detected"})
                return
            pred = results[0].pred_instances
            import numpy as _np  # noqa: PLC0415

            kpts = _np.asarray(pred.keypoints)[0]
            scores = _np.asarray(pred.keypoint_scores)[0]
            if x_off or y_off:
                kpts = kpts.copy()
                kpts[:, 0] += x_off
                kpts[:, 1] += y_off
            mapped = map_inference(kpts, scores, w, h)
            mapped.update({
                "ok": True,
                "inferenceMs": round(infer_ms, 1),
                "model": MODEL_INFO["model"],
                "cameraId": req.get("cameraId"),
                "patientTrackId": req.get("patientTrackId"),
                "timestampMs": req.get("timestampMs"),
                "roiApplied": bool(roi),
            })
            self._send(200, mapped)
        except Exception as e:  # noqa: BLE001
            self._send(500, {"ok": False, "code": "POSE_INFERENCE_FAILED",
                             "message": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8102)
    ap.add_argument("--config", default="/tmp/mmpose-1.3.2/configs/wholebody_2d_keypoint/rtmpose/cocktail14/rtmw-l_8xb1024-270e_cocktail14-256x192.py")
    ap.add_argument("--checkpoint", default="/workspace/project/demo2/services/biomechanics/models/rtmw/rtmw-l_256x192.pth")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    load_model(args.config, args.checkpoint, args.device)
    print(f"RTMW worker ready: {MODEL_INFO}", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
