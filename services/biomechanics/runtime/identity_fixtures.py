"""V5.6 identity fixtures: orientation-cued + symmetric + V5 adversarial.

- V5 adversarial fixture is IMPORTED UNCHANGED from runtime/vision_v5.py
  (Phase 28): pose_body_v5 / ring_cameras_v5 / SEED. It is the regression
  benchmark (identityFails = 154 baseline).
- Orientation-cued fixture (Phase 29): same walk-cycle body but with a
  detector-visible anatomical asymmetry — the anatomical RIGHT arm is
  abducted ~70 deg while the left arm rests. Shoulders/elbows/wrists are
  in the RTMW clinical subset and reliably detected, so the raised limb
  breaks the global reflection ambiguity from every viewpoint.
- Symmetric fixture (Phase 30): both arms rest in mirrored stance and the
  head/torso carry no sided cue. Global mirror assignments are then
  geometrically indistinguishable: the honest answer is AMBIGUOUS.

All fixture functions return truth ONLY for test metric computation.
Production solver inputs exclude truth fields (Phase 43).
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

RUNTIME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "..", "runtime")
if RUNTIME_DIR not in sys.path:
    sys.path.insert(0, RUNTIME_DIR)

from vision_v5 import (  # noqa: E402
    ANGLES, LOWER_LIMB, SEED, mirror_of, pose_body_v5, project, render_v5,
    ring_cameras_v5)


def pose_cued_v56(knee_deg: float) -> dict:
    """Orientation-cued body: V5 walk-cycle + abducted anatomical right arm.

    Right shoulder stays; right elbow/wrist swing out laterally (+Z) and up
    so the raised limb is visible from front, side, AND rear views.
    The head turns toward the raised side (+Z) so the facing cue is
    detector-visible; RTMW returns no facial landmarks on these renders,
    so the cue acts through the neck-side chain (shoulders) instead.
    """
    pts = pose_body_v5(knee_deg)
    rsho = np.array(pts["right-shoulder"], dtype=float)
    # abduct ~70deg: elbow out+up, wrist further out+up (upper-arm ~0.30m)
    pts["right-elbow"] = rsho + np.array([0.02, 0.10, 0.28])
    pts["right-wrist"] = rsho + np.array([0.03, 0.34, 0.47])
    return pts


# Protocolled setup facing for the cued fixture (subject faces the ring's
# reference direction; strong +X component so the nose-anterior check in
# the solver fires on synthetic observations too). Metadata, not truth:
# the production caller passes the equivalent setup parameter.
CUED_FACING_V56 = [0.9, 0.0, 0.44]


def pose_symmetric_v56(knee_deg: float) -> dict:
    """Symmetric body: mirrored arm stance, centered head, no sided cue."""
    pts = pose_body_v5(knee_deg)
    # average the arms into perfect mirror symmetry about the sagittal plane
    for joint in ("shoulder", "elbow", "wrist"):
        l, r = np.array(pts[f"left-{joint}"]), np.array(pts[f"right-{joint}"])
        mid = (l + r) / 2
        lat = abs((r - l)[2]) / 2
        pts[f"left-{joint}"] = np.array([mid[0], mid[1], -lat])
        pts[f"right-{joint}"] = np.array([mid[0], mid[1], lat])
    pts["_nose"] = np.array([0.0, 1.52, 0.0])  # centered: no facing cue
    return pts


def render_cued(P, C, pts, seed: int):
    """Render the cued body with the V5 painter (raised arm included)."""
    return render_v5(P, C, pts, seed)


__all__ = ["ANGLES", "LOWER_LIMB", "SEED", "mirror_of", "pose_body_v5",
           "pose_cued_v56", "pose_symmetric_v56", "project", "render_v5",
           "render_cued", "ring_cameras_v5", "math", "np"]
