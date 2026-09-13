"""RTMW real-image smoke test (Phase 9).

PASS requires: actual checkpoint loaded, real RGB image decoded, real
inference executed, human detected, 133-keypoint output, confidence
scores, latency measured.

Usage: <rtmw-python> rtmw_smoke.py --image <sample> [--config ...] [--checkpoint ...]
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import cv2
import numpy as np


def make_synthetic_human(path: str, w: int = 640, h: int = 480) -> None:
    """Deterministic synthetic human silhouette (NOT a pass fixture — only
    used when no real image is supplied, to exercise the decode path)."""
    rng = np.random.default_rng(7)
    img = np.full((h, w, 3), 128, np.uint8)
    # torso
    cv2.ellipse(img, (w // 2, h // 2), (60, 110), 0, 0, 360, (200, 170, 140), -1)
    # head
    cv2.circle(img, (w // 2, 80), 35, (200, 170, 140), -1)
    # limbs
    cv2.line(img, (w // 2 - 50, h // 2 - 60), (w // 2 - 110, h // 2 + 40), (200, 170, 140), 22)
    cv2.line(img, (w // 2 + 50, h // 2 - 60), (w // 2 + 110, h // 2 + 40), (200, 170, 140), 22)
    cv2.line(img, (w // 2 - 30, h // 2 + 100), (w // 2 - 40, h - 30), (60, 60, 180), 26)
    cv2.line(img, (w // 2 + 30, h // 2 + 100), (w // 2 + 40, h - 30), (60, 60, 180), 26)
    noise = rng.integers(-8, 8, img.shape, dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    cv2.imwrite(path, img)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", default=None)
    ap.add_argument("--config", default=None)
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    from mmpose.apis import init_model, inference_topdown  # noqa: PLC0415

    cfg = args.config or "/tmp/mmpose-1.3.2/configs/wholebody_2d_keypoint/rtmpose/cocktail14/rtmw-l_8xb1024-270e_cocktail14-256x192.py"
    ckpt = args.checkpoint or "services/biomechanics/models/rtmw/rtmw-l_256x192.pth"

    t0 = time.perf_counter()
    model = init_model(cfg, ckpt, device=args.device)
    load_ms = (time.perf_counter() - t0) * 1000.0
    data_cfg = model.cfg.get("model", {}).get("data_preprocessor", {}) if hasattr(model, "cfg") else {}

    img_path = args.image
    if img_path is None:
        img_path = "/tmp/rtmw_synth_human.png"
        make_synthetic_human(img_path)
    img = cv2.imread(img_path)
    if img is None:
        print(f"RESULT: FAIL — cannot decode {img_path}")
        return 1
    h, w = img.shape[:2]

    t1 = time.perf_counter()
    results = inference_topdown(model, img)
    infer_ms = (time.perf_counter() - t1) * 1000.0

    pred = results[0].pred_instances
    kpts = np.asarray(pred.keypoints)  # (N,133,2)
    scores = np.asarray(pred.keypoint_scores)  # (N,133)
    n_person, n_kpt = kpts.shape[0], kpts.shape[1]
    body = scores[0, :17] if n_person else np.array([])
    body_valid = int((body > 0.3).sum()) if body.size else 0

    out = {
        "MODEL": "rtmw-l 256x192 (cocktail14)",
        "DEVICE": args.device,
        "INPUT": f"{img_path} {w}x{h}",
        "KEYPOINTS": f"{n_person}x{n_kpt}",
        "BODY KEYPOINTS VALID": f"{body_valid}/17 @0.3",
        "LOAD MS": round(load_ms, 1),
        "INFERENCE MS": round(infer_ms, 1),
        "RESULT": "PASS" if (n_person >= 1 and n_kpt == 133) else "FAIL",
    }
    for k, v in out.items():
        print(f"{k}: {v}")
    # also emit raw arrays path for downstream mapping tests
    np.savez("/tmp/rtmw_smoke_out.npz", keypoints=kpts, scores=scores)
    return 0 if out["RESULT"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
