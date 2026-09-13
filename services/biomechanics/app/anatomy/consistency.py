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
