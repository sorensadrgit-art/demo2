"""Segment length consistency + anatomical plausibility: quality gates, not diagnoses."""
from __future__ import annotations

import math
from dataclasses import dataclass

SEGMENT_PAIRS: dict[str, tuple[str, str]] = {
    "femur-l": ("left-hip", "left-knee"),
    "femur-r": ("right-hip", "right-knee"),
    "tibia-l": ("left-knee", "left-ankle"),
    "tibia-r": ("right-knee", "right-ankle"),
    "humerus-l": ("left-shoulder", "left-elbow"),
    "humerus-r": ("right-shoulder", "right-elbow"),
    "forearm-l": ("left-elbow", "left-wrist"),
    "forearm-r": ("right-elbow", "right-wrist"),
}


def _dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


@dataclass
class SegmentStats:
    mean: float
    sd: float
    cv: float
    maxDeviation: float
    warn: bool


def segment_consistency(
    frames: list[dict[str, tuple[float, float, float]]], cv_warn: float = 0.05
) -> dict[str, SegmentStats]:
    out: dict[str, SegmentStats] = {}
    for seg, (a, b) in SEGMENT_PAIRS.items():
        lens = [_dist(f[a], f[b]) for f in frames if a in f and b in f]
        if len(lens) < 2:
            continue
        mean = sum(lens) / len(lens)
        var = sum((x - mean) ** 2 for x in lens) / len(lens)
        sd = math.sqrt(var)
        cv = sd / mean if mean > 0 else float("inf")
        out[seg] = SegmentStats(mean, sd, cv, max(abs(x - mean) for x in lens), cv > cv_warn)
    return out


def plausibility_flags(
    prev: dict[str, tuple[float, float, float]],
    curr: dict[str, tuple[float, float, float]],
    dt_s: float,
    max_speed_m_s: float = 15.0,
) -> list[str]:
    """Teleport / swap / fabrication gates between consecutive frames."""
    flags: list[str] = []
    if dt_s <= 0:
        return ["nonpositive-dt"]
    for lid, c in curr.items():
        if lid in prev:
            v = _dist(prev[lid], c) / dt_s
            if v > max_speed_m_s:
                flags.append(f"teleport:{lid}:{v:.1f}m/s")
    for left, right in [("left-knee", "right-knee"), ("left-ankle", "right-ankle")]:
        if all(k in prev and k in curr for k in (left, right)):
            d_prev = _dist(prev[left], prev[right])
            d_curr = _dist(curr[left], curr[right])
            if d_prev > 0.05 and d_curr < 0.02:
                flags.append(f"possible-swap:{left}/{right}")
    return flags


# ---------- V5.5 cross-view semantic consistency (P24/P25) ----------
# Reprojection error alone cannot catch a WRONG point every view agrees on
# (V5: six views at 2.7px RMSE on a 450mm-wrong ankle). This layer checks
# the triangulated lower-limb solution against weak anatomical priors that
# use NO ground truth and NO angle-specific expectations:
#   - segment-length plausibility (fixture-calibrated reference bands)
#   - hip -> knee -> ankle topology ordering (knee between hip and ankle)
#   - bilateral separation (limbs must not collapse onto each other)
# A solution violating these is flagged "anatomically-rejected" even when
# its reprojection RMSE is low. Thresholds are deliberately loose (25-40%
# bands): this is a wrong-structure catcher, not a precision gate.

# Reference segment lengths (m) from the gait2392-derived fixture. A real
# deployment calibrates these per patient; the benchmark passes them in.
REFERENCE_SEGMENTS_M: dict[str, float] = {
    "femur": 0.3958,
    "tibia": 0.4300,
}


def anatomical_consistency(
    points: dict[str, tuple[float, float, float] | list[float]],
    reference: dict[str, float] | None = None,
    band: float = 0.30,
    min_inter_limb_m: float = 0.05,
) -> dict:
    """Truth-free anatomical check of a triangulated lower-limb solution.

    Returns {"pass": bool, "checks": {...}, "rejections": [...]}.
    """
    ref = reference or REFERENCE_SEGMENTS_M
    checks: dict[str, dict] = {}
    rejections: list[str] = []
    P = {k: (float(v[0]), float(v[1]), float(v[2])) for k, v in points.items()}

    for side, (hip, knee, ankle) in (
        ("r", ("right-hip", "right-knee", "right-ankle")),
        ("l", ("left-hip", "left-knee", "left-ankle")),
    ):
        if all(k in P for k in (hip, knee, ankle)):
            fem = _dist(P[hip], P[knee])
            tib = _dist(P[knee], P[ankle])
            fem_ok = abs(fem - ref["femur"]) <= band * ref["femur"]
            tib_ok = abs(tib - ref["tibia"]) <= band * ref["tibia"]
            # topology: knee must lie strictly between hip and ankle along
            # the chain (both sub-segments shorter than the hip-ankle span
            # unless the limb is folded past ~150deg flexion, impossible
            # for a knee).
            span = _dist(P[hip], P[ankle])
            topo_ok = (fem < span + 1e-6 and tib < span + 1e-6) or span < 1e-6
            checks[f"femur-{side}"] = {"lengthM": round(fem, 4), "ok": fem_ok}
            checks[f"tibia-{side}"] = {"lengthM": round(tib, 4), "ok": tib_ok}
            checks[f"topology-{side}"] = {"spanM": round(span, 4), "ok": topo_ok}
            if not fem_ok:
                rejections.append(f"segment:femur-{side}:{fem:.3f}m")
            if not tib_ok:
                rejections.append(f"segment:tibia-{side}:{tib:.3f}m")
            if not topo_ok:
                rejections.append(f"topology:knee-not-between-{side}")

    for a, b in (("left-knee", "right-knee"), ("left-ankle", "right-ankle")):
        if a in P and b in P:
            d = _dist(P[a], P[b])
            ok = d >= min_inter_limb_m
            checks[f"separation:{a}/{b}"] = {"distM": round(d, 4), "ok": ok}
            if not ok:
                rejections.append(f"collapse:{a}/{b}:{d:.3f}m")

    return {"pass": not rejections, "checks": checks, "rejections": rejections}
