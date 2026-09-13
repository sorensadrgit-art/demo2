"""Canonical bilateral landmark pairs + side-swap permutation.

Provider-independent: any pose provider may exhibit left/right ambiguity,
so ALL semantic side-swapping flows through this single map (Phase 3).
Swapping changes anatomical LABELS only — image coordinates are never
moved (Phase 1 core principle).

H1 (bilateral-swapped) of an observation set relabels left<->right for
every paired landmark; unpaired midline landmarks (nose, torso center)
pass through unchanged.
"""
from __future__ import annotations

# Canonical bilateral pairs over KineLab landmark ids. Hand keypoints use
# indexed face/hand schema names only where the side token is explicit.
BILATERAL_PAIRS: tuple[tuple[str, str], ...] = (
    ("left-shoulder", "right-shoulder"),
    ("left-elbow", "right-elbow"),
    ("left-wrist", "right-wrist"),
    ("left-hip", "right-hip"),
    ("left-knee", "right-knee"),
    ("left-ankle", "right-ankle"),
    ("left-heel", "right-heel"),
    ("left-foot-index", "right-foot-index"),
    ("left-big-toe", "right-big-toe"),
    ("left-small-toe", "right-small-toe"),
    ("left-eye", "right-eye"),
    ("left-ear", "right-ear"),
)

_SWAP: dict[str, str] = {}
for _a, _b in BILATERAL_PAIRS:
    _SWAP[_a] = _b
    _SWAP[_b] = _a


def swap_label(landmark_id: str) -> str:
    """Bilateral counterpart, or the id itself when unpaired (midline)."""
    return _SWAP.get(landmark_id, landmark_id)


def is_bilateral(landmark_id: str) -> bool:
    return landmark_id in _SWAP


def swap_observations(observations: list[dict]) -> list[dict]:
    """H1 hypothesis: relabeled copy of per-camera observations.

    Only the ``landmarkId`` field changes; xPx/yPx/confidence/timestamps
    are carried over untouched — pixels are never moved to make geometry
    work.
    """
    return [{**o, "landmarkId": swap_label(o["landmarkId"])}
            for o in observations]
