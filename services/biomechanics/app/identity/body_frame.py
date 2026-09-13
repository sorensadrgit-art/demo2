"""Body-centric coordinate frame from resolved anatomy (Phase 7).

origin       = pelvis center (midpoint of hips)
vertical     = pelvis -> shoulder center (unit)
lateral      = hip lateral axis, SIGN UNRESOLVED without orientation evidence
forward      = vertical x lateral

The frame exposes the reflection ambiguity honestly: without trusted
orientation evidence the lateral/forward signs are unknown, and callers
must treat identity as ambiguous. Sign is resolved ONLY from real
evidence (face anchors, anchor views, prior resolved state) — never by
assuming image-left == anatomical-left.
"""
from __future__ import annotations

import numpy as np


def build_body_frame(points3d: dict[str, list | tuple],
                     orientation_hint: dict | None = None) -> dict:
    """Construct subject frame; lateral sign resolved iff evidence present."""
    P = {k: np.array(v, dtype=float) for k, v in points3d.items()}
    req = ("left-hip", "right-hip", "left-shoulder", "right-shoulder")
    if any(k not in P for k in req):
        return {"ok": False, "reason": "insufficient-landmarks"}
    pelvis = (P["left-hip"] + P["right-hip"]) / 2
    thorax = (P["left-shoulder"] + P["right-shoulder"]) / 2
    up = thorax - pelvis
    if float(np.linalg.norm(up)) < 1e-6:
        return {"ok": False, "reason": "degenerate-vertical"}
    up = up / np.linalg.norm(up)
    lateral = P["right-hip"] - P["left-hip"]
    if float(np.linalg.norm(lateral)) < 1e-6:
        return {"ok": False, "reason": "degenerate-lateral"}
    lateral = lateral / np.linalg.norm(lateral)
    fwd = np.cross(up, lateral)
    if float(np.linalg.norm(fwd)) < 1e-6:
        return {"ok": False, "reason": "degenerate-forward"}
    fwd = fwd / np.linalg.norm(fwd)
    sign_resolved = bool(orientation_hint)
    return {"ok": True, "originM": [round(float(v), 4) for v in pelvis],
            "vertical": [round(float(v), 4) for v in up],
            "lateral": [round(float(v), 4) for v in lateral],
            "forward": [round(float(v), 4) for v in fwd],
            "lateralSignResolved": sign_resolved,
            "orientationHint": orientation_hint or {}}


__all__ = ["build_body_frame"]
