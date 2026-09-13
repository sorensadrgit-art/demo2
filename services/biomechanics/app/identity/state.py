"""Persistent anatomical identity + temporal hysteresis (Phases 11-13).

Once high-confidence anatomy is established, continuity is maintained:
RESOLVED persists through weak frames; only strong contradictory evidence
across MULTIPLE consecutive frames may reopen ambiguity. Identity never
flip-flops frame to frame.

  polaritySwitchCount == 0 per trial is the production expectation
  unless the prior state was explicitly unresolved.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .solver import (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT, STATUS_RESOLVED,
                     IdentitySolution)

EVIDENCE_STRONG_MARGIN = 12.0  # challenger must beat incumbent by this
CONFIRM_FRAMES = 3             # ... on this many consecutive frames ...


@dataclass
class AnatomicalIdentityState:
    patientId: str = ""
    orientationResolved: bool = False
    bodyFrame: dict | None = None
    leftRightConfidence: float = 0.0
    sourceEvidence: list[str] = field(default_factory=list)
    lastResolvedTimestamp: float = 0.0
    solution3d: dict[str, list] = field(default_factory=dict)
    polarityByCamera: dict[str, str] = field(default_factory=dict)
    polaritySwitchCount: int = 0
    _pendingChallenger: dict | None = None
    _pendingCount: int = 0


class TemporalPolarityFilter:
    """Hysteresis wrapper around the per-frame solver (Phase 13)."""

    def __init__(self, patient_id: str = ""):
        self.state = AnatomicalIdentityState(patientId=patient_id)

    def update(self, solution: IdentitySolution,
               timestamp: float) -> IdentitySolution:
        st = self.state
        if solution.status != STATUS_RESOLVED:
            # AMBIGUOUS / INSUFFICIENT: gather evidence, keep prior.
            st._pendingChallenger = None
            st._pendingCount = 0
            if not st.orientationResolved:
                return solution
            # prior resolved: preserve identity, report ambiguity honestly.
            out = IdentitySolution(
                status=solution.status,
                polarityByCamera=dict(st.polarityByCamera),
                score=solution.score, runnerUpScore=solution.runnerUpScore,
                margin=solution.margin, solution3d=dict(st.solution3d),
                diagnostics={**solution.diagnostics,
                             "temporal": "prior-preserved-ambiguous-frame"})
            return out
        if not st.orientationResolved:
            st.orientationResolved = True
            st.solution3d = dict(solution.solution3d)
            st.polarityByCamera = dict(solution.polarityByCamera)
            st.leftRightConfidence = min(1.0, solution.margin / 20.0)
            st.sourceEvidence = ["initial-resolution"]
            st.lastResolvedTimestamp = timestamp
            return solution
        # resolved frame vs incumbent: same assignment -> refresh continuity.
        if solution.polarityByCamera == st.polarityByCamera:
            st.solution3d = dict(solution.solution3d)
            st.leftRightConfidence = min(1.0, solution.margin / 20.0)
            st.lastResolvedTimestamp = timestamp
            st._pendingChallenger = None
            st._pendingCount = 0
            return solution
        # challenger assignment: require strong margin, repeatedly.
        if solution.margin < EVIDENCE_STRONG_MARGIN:
            st._pendingChallenger = None
            st._pendingCount = 0
            keep = IdentitySolution(
                status=STATUS_RESOLVED,
                polarityByCamera=dict(st.polarityByCamera),
                score=solution.score, runnerUpScore=solution.runnerUpScore,
                margin=solution.margin, solution3d=dict(st.solution3d),
                diagnostics={**solution.diagnostics,
                             "temporal": "weak-challenger-rejected"})
            return keep
        key = str(sorted(solution.polarityByCamera.items()))
        if st._pendingChallenger == key:
            st._pendingCount += 1
        else:
            st._pendingChallenger = key
            st._pendingCount = 1
        if st._pendingCount >= CONFIRM_FRAMES:
            st.polarityByCamera = dict(solution.polarityByCamera)
            st.solution3d = dict(solution.solution3d)
            st.polaritySwitchCount += 1
            st.lastResolvedTimestamp = timestamp
            st._pendingChallenger = None
            st._pendingCount = 0
            return solution
        return IdentitySolution(
            status=STATUS_RESOLVED,
            polarityByCamera=dict(st.polarityByCamera),
            score=solution.score, runnerUpScore=solution.runnerUpScore,
            margin=solution.margin, solution3d=dict(st.solution3d),
            diagnostics={**solution.diagnostics, "temporal":
                         f"challenger-pending-{st._pendingCount}/{CONFIRM_FRAMES}"})


__all__ = ["AnatomicalIdentityState", "TemporalPolarityFilter",
           "STATUS_RESOLVED", "STATUS_AMBIGUOUS", "STATUS_INSUFFICIENT",
           "EVIDENCE_STRONG_MARGIN", "CONFIRM_FRAMES"]
