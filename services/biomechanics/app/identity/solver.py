"""Exhaustive global multiview polarity solver (Phases 4-6).

With C active cameras and 2 polarity states each, the assignment space is
2^C (256 for the 8-camera Precision ring) — small enough for exact
exhaustive evaluation in post-processing. No optimizer, no heuristics,
no camera-ID-specific logic (Phase 23).

Candidate score (lower = better) combines INDEPENDENT evidence; weights
are documented below and every component is reported in diagnostics:

  anatomy      (HIGH)  anatomical_consistency() rejections on the
                       candidate 3D solution — catches wrong-structure
                       consensus that reprojection RMSE passes (V5.5 P25).
  geometry     (LOW)   triangulation residual RMSE — V5/V5.5 proved wrong
                       anatomy can score 1-7px, so this guides but never
                       decides alone (Phase 16).
  separation   (MED)   bilateral limb separation / collapse penalty.
  orientation  (MED)   agreement of candidate 3D with trusted orientation
                       evidence (face/torso/anchor views) when present.
  continuity   (MED)   distance of candidate 3D to prior resolved anatomy
                       (temporal identity continuity, Phase 12).
  confidence   (EPS)   weak detector-confidence input only (Phase 15).

Landmark reliability from V5.5 measurements (Phase 21):
  pelvis/hip 1.0 > knee 0.8 > ankle/foot 0.5 > upper limb 0.6.
Hips localize (p50 ~22-40px real) while ankles swap systematically
(right-ankle p50 81px synthetic); identity evidence is therefore
dominated by proximal joints. A single bad ankle cannot flip anatomy.

Status:
  RESOLVED               winner margin >= threshold, anatomy passes
  AMBIGUOUS              margin below threshold (incl. global mirror tie)
  INSUFFICIENT_EVIDENCE  too few paired observations / degenerate views

Ground truth NEVER enters this module (Phase 43): inputs are detector
observations, calibrations, prior state, and protocol side as supporting
evidence only.
"""
from __future__ import annotations

import itertools
import math
import time
from dataclasses import dataclass, field

import numpy as np

from ..anatomy.consistency import anatomical_consistency
from ..reconstruction.triangulation import CameraView, triangulate_weighted
from .bilateral import BILATERAL_PAIRS, is_bilateral
from .hypotheses import POLARITY_SWAPPED, build_hypotheses

SOLVER_VERSION = "kinelab-polarity-v56-1"

STATUS_RESOLVED = "RESOLVED"
STATUS_AMBIGUOUS = "AMBIGUOUS"
STATUS_INSUFFICIENT = "INSUFFICIENT_EVIDENCE"

# V5.5-evidence landmark reliability (Phase 21): proximal dominates.
RELIABILITY: dict[str, float] = {
    "hip": 1.0, "shoulder": 0.9, "knee": 0.8, "elbow": 0.6,
    "ankle": 0.5, "heel": 0.5, "foot-index": 0.5, "wrist": 0.5,
    "eye": 0.7, "ear": 0.7, "nose": 0.7,
}

# Component weights (documented, not tuned to force passes — Phase 1).
W_ANATOMY = 40.0       # per anatomical_consistency rejection
W_REPROJ = 1.0         # per RMSE px (low: wrong consensus scores low too)
W_SEPARATION = 12.0    # per collapsed bilateral pair
W_REJECT = 30.0        # per unit of rejection ratio: a mask that forces the
                       # robust estimator to discard views is splitting
                       # observations across limbs. Scaled x3 vs the first
                       # draft so consensus differences survive real-detector
                       # noise floors (V5.6 audit: baseline ratio ~0.5/lid).
W_COINCIDE = 25.0      # per coinciding bilateral pair (relabeled same limb):
                       # the smoking gun of a mixed-limb mask. Two distinct
                       # anatomical landmarks triangulating to the SAME 3D
                       # point means views were split across physical limbs.
W_ORIENTATION = 16.0   # per contradicted orientation anchor: orientation is
                       # the ONLY tie-break of a global mirror image, so it
                       # must overcome DEFAULT_MARGIN on its own
W_CONTINUITY = 0.6     # per mm drift from prior resolved anatomy
W_CONFIDENCE = 0.05    # epsilon: confidence may whisper, never decide

MIN_PAIRED_OBS = 4     # need >= this many bilateral observations globally
MIN_VIEWS_TRI = 2      # triangulation floor inside the solver
REPROJ_CAP_PX = 8.0    # per-landmark RMSE cap: matches the V5 production
                       # outlier/reprojection tolerance (OUTLIER_PX_V5 /
                       # MAX_REPROJ_PX_V5). Residuals beyond the production
                       # gate carry no additional identity information.
DEFAULT_MARGIN = 6.0   # engineering threshold (NOT clinically validated)


def _reliability(lid: str) -> float:
    for key, w in RELIABILITY.items():
        if key in lid:
            return w
    return 0.4


@dataclass
class IdentitySolution:
    status: str
    polarityByCamera: dict[str, str] = field(default_factory=dict)
    score: float = math.inf
    runnerUpScore: float = math.inf
    margin: float = 0.0
    solution3d: dict[str, list[float]] = field(default_factory=dict)
    diagnostics: dict = field(default_factory=dict)


def _triangulate_lid(lid: str, obs: list[dict],
                     cams: dict[str, dict]) -> dict | None:
    views = []
    for o in obs:
        c = cams.get(o["cameraId"])
        if c is None or "projectionMatrix" not in c:
            continue
        views.append(CameraView(o["cameraId"], np.array(c["projectionMatrix"]),
                                o["xPx"], o["yPx"], o.get("confidence", 1.0)))
    if len(views) < MIN_VIEWS_TRI:
        return None
    try:
        res = triangulate_weighted(views, min_views=MIN_VIEWS_TRI,
                                   outlier_threshold_px=8.0,
                                   max_reproj_px=1e9, max_reject_rounds=6)
    except Exception:  # noqa: BLE001 — degenerate views score as failure
        return None
    n_views = len(views)
    return {"point": [float(v) for v in res.pointM],
            "rmse": float(res.reprojectionErrorPx),
            "used": list(res.usedCameraIds),
            "rejectRatio": (len(res.rejectedCameraIds) / n_views
                            if n_views else 0.0)}


def _score_mask(mask: int, cam_ids: list[str], hypo: dict[str, list],
                cams: dict[str, dict], prior3d: dict[str, list] | None,
                orientation: dict[str, list] | None,
                protocol_side: str | None,
                facing: list | tuple | None = None,
                raised_side: dict | None = None) -> dict:
    """Score one global polarity assignment; lower is better.

    ``facing``: world unit vector of the subject's facing direction from
    SETUP metadata (protocolled patient placement — never fixture truth).
    Triangulated nose anterior to the torso center agrees with it.
    ``raised_side``: {"joint": "wrist", "side": "right"} from PROTOCOL
    metadata (e.g. "patient raises right arm during acquisition").
    The more-raised candidate 3D joint must carry that anatomical label.
    """
    # gather relabeled observations: H1 where the mask bit is set
    pool: dict[str, list[dict]] = {}
    for i, cid in enumerate(cam_ids):
        h = hypo[cid][1 if (mask >> i) & 1 else 0]
        for o in h.landmarks:
            pool.setdefault(o["landmarkId"], []).append(o)
    tri: dict[str, dict] = {}
    for lid, obs in pool.items():
        r = _triangulate_lid(lid, obs, cams)
        if r is not None:
            tri[lid] = r
    comp = {"reproj": 0.0, "anatomy": 0.0, "separation": 0.0,
            "coincide": 0.0, "rejected": 0.0, "orientation": 0.0,
            "continuity": 0.0, "confidence": 0.0}
    pts = {lid: tuple(r["point"]) for lid, r in tri.items()}
    for lid, r in tri.items():
        # capped RMSE: robust estimation already removed outliers, but a
        # post-rejection residual still carries heavy-tailed detector noise
        # (V5.6 audit: 40px+ glitches on single views). The cap keeps one
        # noisy landmark from deciding identity; the rejection ratio below
        # carries the consensus signal instead.
        comp["reproj"] += _reliability(lid) * min(r["rmse"], REPROJ_CAP_PX)
        # normalized consensus: fraction of views the robust estimator had
        # to discard. A mask splitting limbs discards MORE views per
        # landmark than the consensus mask; normalization keeps noisy
        # real-detector frames (high baseline rejection everywhere) from
        # drowning the margin in an absolute count.
        comp["rejected"] += W_REJECT * _reliability(lid) * r["rejectRatio"]
    if pts:
        ac = anatomical_consistency(pts)
        comp["anatomy"] = W_ANATOMY * len(ac["rejections"])
        # bilateral collapse is ALSO scored continuously (not just gated):
        # limit the continuous term to pairs whose gating band did NOT
        # already reject (a collapsed pair inside the gate gets the full
        # W_ANATOMY, not W_ANATOMY + separation on top).
        rejected_pairs = {r.split(":")[1] for r in ac["rejections"]
                          if r.startswith("collapse:")}
        for a, b in BILATERAL_PAIRS:
            if a in pts and b in pts:
                pair_key = f"{a}/{b}"
                d = float(np.linalg.norm(np.array(pts[a]) - np.array(pts[b])))
                if d < 0.01:
                    # full coincidence: both labels solved to the same limb.
                    comp["coincide"] += W_COINCIDE * _reliability(a)
                elif d < 0.05 and pair_key not in rejected_pairs:
                    comp["separation"] += W_SEPARATION * (0.05 - d) / 0.05
    if orientation and pts:
        for lid, expected in orientation.items():
            if lid in pts:
                d = float(np.linalg.norm(
                    np.array(pts[lid]) - np.array(expected, dtype=float)))
                if d > 0.10:  # 10cm tolerance: anchor must AGREE, not dictate
                    comp["orientation"] += W_ORIENTATION * _reliability(lid)
    if facing is not None and "nose" in tri:
        # anterior check: nose must lie along facing from the torso center.
        torso = [pts[k] for k in ("left-shoulder", "right-shoulder",
                                  "left-hip", "right-hip") if k in pts]
        if torso:
            center = np.mean([np.array(t) for t in torso], axis=0)
            fwd = np.array(facing, dtype=float)
            if float(np.dot(np.array(tri["nose"]["point"]) - center, fwd)) < 0:
                comp["orientation"] += W_ORIENTATION * _reliability("nose")
    if raised_side and isinstance(raised_side, dict):
        joint, side = raised_side.get("joint", "wrist"), raised_side.get("side")
        if joint and side in ("left", "right"):
            cand = {s: pts.get(f"{s}-{joint}") for s in ("left", "right")}
            if all(v is not None for v in cand.values()):
                # raised = most LATERAL from the body midline (torso axis
                # through pelvis and shoulder centers). Abduction moves the
                # limb away from the midline in world space; detectors
                # mislocalize extremities along the image plane but rarely
                # across the midline, so lateral offset survives detection
                # noise better than height (V5.6 finding).
                axis_pts = [pts[k] for k in ("left-shoulder",
                                             "right-shoulder", "left-hip",
                                             "right-hip") if k in pts]
                if len(axis_pts) >= 2:
                    A = np.array(axis_pts, dtype=float)
                    c0, axis = A.mean(axis=0), None
                    _, _, vh = np.linalg.svd(A - c0, full_matrices=False)
                    axis = vh[0] / np.linalg.norm(vh[0])
                    lat = {s: float(np.linalg.norm(
                        (np.array(cand[s]) - c0)
                        - np.dot(np.array(cand[s]) - c0, axis) * axis))
                        for s in ("left", "right")}
                    # require a decisive cue: lateral gap must exceed 15cm
                    if abs(lat["left"] - lat["right"]) > 0.15:
                        raised = max(lat, key=lambda s: lat[s])
                        if raised != side:
                            comp["orientation"] += (
                                W_ORIENTATION
                                * _reliability(f"{side}-{joint}"))
    if prior3d and pts:
        for lid, p in tri.items():
            if lid in prior3d:
                d_mm = 1000.0 * float(np.linalg.norm(
                    np.array(p["point"]) - np.array(prior3d[lid], dtype=float)))
                comp["continuity"] += W_CONTINUITY * _reliability(lid) * d_mm / 100.0
    # confidence: epsilon-tiebreak toward higher mean confidence only.
    confs = [float(o.get("confidence", 0.0)) for obs in pool.values()
             for o in obs if is_bilateral(o.get("landmarkId", ""))]
    if confs:
        comp["confidence"] = W_CONFIDENCE * (1.0 - sum(confs) / len(confs))
    if protocol_side and pts:
        # supporting evidence only: prefer the assignment whose target-side
        # chain has the more extended (less collapsed) structure.
        pass  # recorded in diagnostics; never rewrites labels (Phase 24)
    total = (comp["reproj"] * W_REPROJ + comp["anatomy"] + comp["separation"]
             + comp["coincide"] + comp["rejected"]
             + comp["orientation"] + comp["continuity"] + comp["confidence"])
    return {"total": total, "components": comp, "tri": tri, "points": pts,
            "nTriangulated": len(tri)}


class MultiviewPolaritySolver:
    """Exhaustive global identity solver (Phase 4/5)."""

    def __init__(self, margin_threshold: float = DEFAULT_MARGIN):
        self.margin_threshold = margin_threshold

    def solve(self, observations_by_camera: dict[str, list[dict]],
              cameras: dict[str, dict], frame_id: str = "",
              prior3d: dict[str, list] | None = None,
              orientation: dict[str, list] | None = None,
              protocol_side: str | None = None,
              facing: list | tuple | None = None,
              raised_side: dict | None = None) -> IdentitySolution:
        t0 = time.perf_counter()
        cam_ids = sorted(observations_by_camera)
        n_paired = sum(1 for obs in observations_by_camera.values()
                       for o in obs if is_bilateral(o.get("landmarkId", "")))
        if n_paired < MIN_PAIRED_OBS:
            return IdentitySolution(status=STATUS_INSUFFICIENT,
                                    diagnostics={"reason": "too few paired "
                                                 f"observations ({n_paired})"})
        hypo = {cid: build_hypotheses(cid, frame_id, observations_by_camera[cid])
                for cid in cam_ids}
        scored = []
        for mask in range(1 << len(cam_ids)):
            s = _score_mask(mask, cam_ids, hypo, cameras, prior3d,
                            orientation, protocol_side, facing, raised_side)
            scored.append((s["total"], mask, s))
        scored.sort(key=lambda t: t[0])
        (best_total, best_mask, best), (_, _, second) = scored[0], scored[1]
        margin = scored[1][0] - scored[0][0]
        polarity = {cid: (POLARITY_SWAPPED if (best_mask >> i) & 1
                          else hypo[cid][0].polarity)
                    for i, cid in enumerate(cam_ids)}
        diag = {
            "solverVersion": SOLVER_VERSION,
            "combinations": len(scored),
            "activeCameras": cam_ids,
            "best": best["components"], "runnerUp": second["components"],
            "nTriangulated": best["nTriangulated"],
            "latencyMs": round((time.perf_counter() - t0) * 1000.0, 2),
            "protocolSide": protocol_side,
        }
        if margin < self.margin_threshold:
            return IdentitySolution(status=STATUS_AMBIGUOUS,
                                    polarityByCamera=polarity, score=best_total,
                                    runnerUpScore=scored[1][0], margin=margin,
                                    solution3d={}, diagnostics=diag)
        if best["components"]["anatomy"] > 0:
            # winner still anatomically rejected: suspend, never force.
            return IdentitySolution(status=STATUS_AMBIGUOUS,
                                    polarityByCamera=polarity, score=best_total,
                                    runnerUpScore=scored[1][0], margin=margin,
                                    solution3d={}, diagnostics=diag)
        return IdentitySolution(status=STATUS_RESOLVED,
                                polarityByCamera=polarity, score=best_total,
                                runnerUpScore=scored[1][0], margin=margin,
                                solution3d={k: list(v)
                                            for k, v in best["points"].items()},
                                diagnostics=diag)

    def score_all_masks(self, observations_by_camera: dict[str, list[dict]],
                        cameras: dict[str, dict], frame_id: str = "",
                        **solve_kwargs) -> tuple[list[str], dict[int, float],
                                                 dict[int, dict]]:
        """Score every global polarity mask; return (cam_ids, totals, full)."""
        from .hypotheses import build_hypotheses as _bh
        cam_ids = sorted(observations_by_camera)
        hypo = {cid: _bh(cid, frame_id, observations_by_camera[cid])
                for cid in cam_ids}
        totals, full = {}, {}
        for mask in range(1 << len(cam_ids)):
            s = _score_mask(mask, cam_ids, hypo, cameras,
                            solve_kwargs.get("prior3d"),
                            solve_kwargs.get("orientation"),
                            solve_kwargs.get("protocol_side"),
                            solve_kwargs.get("facing"),
                            solve_kwargs.get("raised_side"))
            totals[mask] = s["total"]
            full[mask] = s
        return cam_ids, totals, full


def accumulate_identity_scores(
        solver: MultiviewPolaritySolver,
        frames_obs: list[tuple[str, dict[str, list[dict]]]],
        cameras: dict[str, dict], **solve_kwargs) -> dict:
    """Joint identity over a trial: sum per-frame mask scores, pick argmin.

    Score-sum = joint negative log-likelihood under per-frame independence.
    A single frame at detector noise floors cannot separate adjacent
    hypotheses (V5.6 audit: margin ~2.0 < 6.0); the trial sum separates
    them (walk-cycle audit: margin 34.9). Returns {"masks", "winner",
    "margin", "jointSolution", "perFrame", "nFrames",
    "disagreeingFrames"}.
    """
    from .hypotheses import POLARITY_SWAPPED as _SW
    from .hypotheses import build_hypotheses as _bh
    joint_totals: dict[int, float] = {}
    cam_ids: list[str] = []
    per_frame = []
    for fid, by_cam in frames_obs:
        cids, totals, _ = solver.score_all_masks(by_cam, cameras,
                                                 frame_id=fid, **solve_kwargs)
        cam_ids = cids
        for m, t in totals.items():
            joint_totals[m] = joint_totals.get(m, 0.0) + t
        per_frame.append((fid, solver.solve(by_cam, cameras, frame_id=fid,
                                            **solve_kwargs)))
    ranked = sorted(joint_totals.items(), key=lambda kv: kv[1])
    winner, best_total = ranked[0]
    runner_total = ranked[1][1] if len(ranked) > 1 else best_total
    margin = runner_total - best_total
    # disagreement: frames whose own winner differs from the joint winner
    # (signals mid-trial polarity change: patient re-enters, camera bumped).
    disagree = 0
    for fid, by_cam in frames_obs:
        _c, totals, _f = solver.score_all_masks(by_cam, cameras,
                                                frame_id=fid, **solve_kwargs)
        fw = min(totals.items(), key=lambda kv: kv[1])[0]
        if fw != winner:
            disagree += 1
    n = len(cam_ids)
    hypo0 = {cid: _bh(cid, "", frames_obs[0][1][cid])
             for cid in cam_ids if cid in frames_obs[0][1]}
    polarity = {cid: (_SW if (winner >> i) & 1 else hypo0[cid][0].polarity)
                for i, cid in enumerate(cam_ids)}
    joint = IdentitySolution(
        status=(STATUS_RESOLVED if margin >= solver.margin_threshold
                else STATUS_AMBIGUOUS),
        polarityByCamera=polarity, score=best_total,
        runnerUpScore=runner_total, margin=margin, solution3d={},
        diagnostics={"solverVersion": SOLVER_VERSION, "winnerMask": winner,
                     "frames": len(frames_obs), "nCameras": n,
                     "disagreeingFrames": disagree,
                     "accumulated": True})
    return {"masks": joint_totals, "winner": winner, "margin": margin,
            "jointSolution": joint, "perFrame": per_frame,
            "nFrames": len(frames_obs), "disagreeingFrames": disagree}


__all__ = ["MultiviewPolaritySolver", "IdentitySolution", "SOLVER_VERSION",
           "STATUS_RESOLVED", "STATUS_AMBIGUOUS", "STATUS_INSUFFICIENT",
           "DEFAULT_MARGIN", "RELIABILITY", "BILATERAL_PAIRS",
           "itertools"]
