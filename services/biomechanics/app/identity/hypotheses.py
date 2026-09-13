"""Per-camera polarity hypotheses H0/H1 (Phase 2).

Each camera frame yields exactly two anatomical-label hypotheses over the
SAME detected coordinates:

  H0 = provider labels unchanged ("provider")
  H1 = bilateral semantic labels swapped ("bilateral-swapped")

No pixels move. No provider-specific logic: any future provider with side
ambiguity flows through the same structure.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .bilateral import swap_label, swap_observations

POLARITY_PROVIDER = "provider"
POLARITY_SWAPPED = "bilateral-swapped"


@dataclass
class PolarityEvidence:
    """Weak per-hypothesis evidence recorded at construction time.

    Detector confidence is informational only (V5.5: corr(conf, err)
    = -0.316) — it must never dominate the global solve (Phase 15).
    """
    n_observations: int = 0
    mean_confidence: float = 0.0
    n_bilateral: int = 0


@dataclass
class PosePolarityHypothesis:
    cameraId: str
    frameId: str
    polarity: str  # POLARITY_PROVIDER | POLARITY_SWAPPED
    landmarks: list[dict] = field(default_factory=list)
    evidence: PolarityEvidence = field(default_factory=PolarityEvidence)


def _evidence(observations: list[dict]) -> PolarityEvidence:
    from .bilateral import is_bilateral

    confs = [float(o.get("confidence", 0.0)) for o in observations]
    return PolarityEvidence(
        n_observations=len(observations),
        mean_confidence=(sum(confs) / len(confs)) if confs else 0.0,
        n_bilateral=sum(1 for o in observations
                        if is_bilateral(o.get("landmarkId", ""))),
    )


def build_hypotheses(camera_id: str, frame_id: str,
                     observations: list[dict]) -> list[PosePolarityHypothesis]:
    """Both polarity hypotheses for one camera frame."""
    obs = [dict(o) for o in observations]
    return [
        PosePolarityHypothesis(cameraId=camera_id, frameId=frame_id,
                               polarity=POLARITY_PROVIDER,
                               landmarks=obs, evidence=_evidence(obs)),
        PosePolarityHypothesis(cameraId=camera_id, frameId=frame_id,
                               polarity=POLARITY_SWAPPED,
                               landmarks=swap_observations(obs),
                               evidence=_evidence(swap_observations(obs))),
    ]


__all__ = ["POLARITY_PROVIDER", "POLARITY_SWAPPED", "PolarityEvidence",
           "PosePolarityHypothesis", "build_hypotheses",
           "swap_label", "swap_observations"]
