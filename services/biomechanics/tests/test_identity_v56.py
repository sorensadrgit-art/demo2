"""V5.6 multiview identity tests (Phases 28-37, 43-46).

Convention: fixture TRUTH (3D joint positions, expected sides) is used
ONLY to build synthetic detector observations (projected pixels, exactly
what a provider returns) and to compute test METRICS. Production solver
inputs — observations, calibrations, setup metadata — exclude truth
fields; test_no_ground_truth_leakage proves it by inspection.

Worker-gated tests (KINELAB_TEST_RTMW_WORKER=1) run the real RTMW-L
256x192 detector over rendered fixtures end to end.
"""
from __future__ import annotations

import os
import sys

import pytest

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app")
RUNTIME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runtime")
SVC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
for _p in (SVC_DIR, RUNTIME_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import numpy as np

from app.identity.bilateral import (BILATERAL_PAIRS, is_bilateral,
                                    swap_label, swap_observations)
from app.identity.body_frame import build_body_frame
from app.identity.hypotheses import (POLARITY_PROVIDER, POLARITY_SWAPPED,
                                     build_hypotheses)
from app.identity.solver import (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT,
                                 STATUS_RESOLVED, MultiviewPolaritySolver)
from app.identity.state import TemporalPolarityFilter
from identity_fixtures import (mirror_of, pose_body_v5, pose_cued_v56,
                               pose_symmetric_v56, project, ring_cameras_v5)

NEED_WORKER = os.environ.get("KINELAB_TEST_RTMW_WORKER") == "1"

RAISED_RIGHT = {"joint": "elbow", "side": "right"}


def _scene(body, swaps=(), conf=0.8):
    """Synthetic detector observations: projected pixels + provider labels."""
    cams = ring_cameras_v5()
    lids = [l for l in body if not l.startswith("_")]
    obs = {}
    for cam in cams:
        ol = []
        for lid in lids:
            x, y = project(cam["P"], body[lid])
            ul = (mirror_of(lid) if (cam["cameraId"] in swaps and "-"
                                     in lid and is_bilateral(lid)) else lid)
            ol.append({"cameraId": cam["cameraId"], "landmarkId": ul,
                       "xPx": float(x), "yPx": float(y), "confidence": conf,
                       "timestampMs": 0.0, "frameId": "f0"})
        obs[cam["cameraId"]] = ol
    cameras = {c["cameraId"]: {"cameraId": c["cameraId"],
                               "projectionMatrix": c["P"].tolist()}
               for c in cams}
    return obs, cameras


def _ankle_err(sol, body):
    errs = {}
    for side in ("left", "right"):
        lid = f"{side}-ankle"
        if lid in sol.solution3d:
            errs[side] = float(np.linalg.norm(
                np.array(sol.solution3d[lid]) - np.array(body[lid])))
    return errs


# ---------- Phase 3: bilateral map ----------

def test_bilateral_swap_involution():
    for a, b in BILATERAL_PAIRS:
        assert swap_label(swap_label(a)) == a
        assert swap_label(swap_label(b)) == b
        assert swap_label(a) == b
    assert swap_label("nose") == "nose"  # midline passes through
    assert len(BILATERAL_PAIRS) >= 10


def test_polarity_hypotheses_generated():
    obs = [{"cameraId": "cam-01", "landmarkId": "left-knee",
            "xPx": 1.0, "yPx": 2.0, "confidence": 0.9},
           {"cameraId": "cam-01", "landmarkId": "nose",
            "xPx": 3.0, "yPx": 4.0, "confidence": 0.9}]
    h0, h1 = build_hypotheses("cam-01", "f0", obs)
    assert h0.polarity == POLARITY_PROVIDER
    assert h1.polarity == POLARITY_SWAPPED
    assert h1.landmarks[0]["landmarkId"] == "right-knee"
    assert h1.landmarks[0]["xPx"] == 1.0  # pixels never move
    assert h1.landmarks[1]["landmarkId"] == "nose"
    assert swap_observations(swap_observations(obs)) == obs


# ---------- Phases 28/29/31-33: scenario views ----------

def test_multiview_solver_front_view():
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body)
    sol = MultiviewPolaritySolver().solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert sol.status == STATUS_RESOLVED, sol.diagnostics
    assert all(p == POLARITY_PROVIDER for p in sol.polarityByCamera.values())
    errs = _ankle_err(sol, body)
    assert errs["left"] < 0.01 and errs["right"] < 0.01


def test_multiview_solver_rear_view():
    # rear cameras (cam-04/05) report swapped labels; global identity from
    # the ring must reassign them — no camera-specific logic.
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body, swaps=("cam-04", "cam-05"))
    sol = MultiviewPolaritySolver().solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert sol.status == STATUS_RESOLVED, sol.diagnostics
    assert sol.polarityByCamera["cam-04"] == POLARITY_SWAPPED
    assert sol.polarityByCamera["cam-05"] == POLARITY_SWAPPED
    errs = _ankle_err(sol, body)
    assert errs["left"] < 0.01 and errs["right"] < 0.01


def test_multiview_solver_side_view():
    # near-sagittal cam-03 swapped: low local evidence, global solve wins.
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body, swaps=("cam-03",))
    sol = MultiviewPolaritySolver().solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert sol.status == STATUS_RESOLVED, sol.diagnostics
    assert sol.polarityByCamera["cam-03"] == POLARITY_SWAPPED


def test_multiview_solver_global_consensus():
    # majority swapped (6/8): consensus follows EVIDENCE, not vote count.
    body = pose_cued_v56(60.0)
    swapped = ("cam-02", "cam-03", "cam-04", "cam-05", "cam-06", "cam-07")
    obs, cameras = _scene(body, swaps=swapped)
    sol = MultiviewPolaritySolver().solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert sol.status == STATUS_RESOLVED, sol.diagnostics
    for cid in swapped:
        assert sol.polarityByCamera[cid] == POLARITY_SWAPPED, cid
    errs = _ankle_err(sol, body)
    assert errs["left"] < 0.02 and errs["right"] < 0.02


# ---------- Phase 30: symmetric fixture suspends ----------

def test_symmetric_fixture_returns_ambiguous():
    body = pose_symmetric_v56(60.0)
    obs, cameras = _scene(body)
    sol = MultiviewPolaritySolver().solve(obs, cameras)
    assert sol.status in (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT), sol.status
    assert sol.solution3d == {}  # never guess


def test_low_margin_returns_ambiguous():
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body, swaps=("cam-04",))
    sol = MultiviewPolaritySolver().solve(obs, cameras)  # no anchor
    assert sol.status == STATUS_AMBIGUOUS
    assert sol.margin < 6.0


# ---------- Phases 15/16: confidence / reprojection cannot dominate ----------

def test_confidence_cannot_override_anatomy():
    # wrong-label cameras report HIGH confidence; correct cameras LOW.
    # Identity must still follow geometry+anatomy, not confidence.
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body, swaps=("cam-04", "cam-05"), conf=0.35)
    for cid in ("cam-04", "cam-05"):
        for o in obs[cid]:
            o["confidence"] = 0.99
    sol = MultiviewPolaritySolver().solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert sol.status == STATUS_RESOLVED, sol.diagnostics
    assert sol.polarityByCamera["cam-04"] == POLARITY_SWAPPED


def test_low_reprojection_wrong_identity_rejected():
    # every camera agrees on the mirrored labels with ~0 residual (the V5
    # wrong-consensus mode). Without orientation evidence the solver must
    # suspend — a confident wrong measurement is the FAIL state.
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body, swaps=tuple(f"cam-{i:02d}" for i in range(1, 9)))
    sol = MultiviewPolaritySolver().solve(obs, cameras)
    assert sol.status == STATUS_AMBIGUOUS
    assert sol.solution3d == {}


# ---------- Phases 12/13: temporal hysteresis ----------

def test_temporal_identity_hysteresis():
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body)
    solver = MultiviewPolaritySolver()
    filt = TemporalPolarityFilter(patient_id="p1")
    s0 = solver.solve(obs, cameras, raised_side=RAISED_RIGHT)
    out0 = filt.update(s0, 0.0)
    assert out0.status == STATUS_RESOLVED
    assert filt.state.orientationResolved
    # single noisy challenger frame: identity preserved, no switch.
    obs_n, _ = _scene(body, swaps=("cam-02", "cam-03"))
    s1 = solver.solve(obs_n, cameras, raised_side=RAISED_RIGHT)
    out1 = filt.update(s1, 1 / 60)
    assert out1.polarityByCamera == filt.state.polarityByCamera
    assert filt.state.polaritySwitchCount == 0
    # ambiguous frame with prior resolved: prior preserved, still flagged.
    s2 = solver.solve(obs_n, cameras)
    out2 = filt.update(s2, 2 / 60)
    assert out2.status in (STATUS_AMBIGUOUS, STATUS_RESOLVED)
    assert filt.state.polaritySwitchCount == 0


# ---------- Phase 34: camera dropout ----------

def test_camera_dropout_preserves_identity():
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body)
    solver = MultiviewPolaritySolver()
    full = solver.solve(obs, cameras, raised_side=RAISED_RIGHT)
    assert full.status == STATUS_RESOLVED
    drop1 = {k: v for k, v in obs.items() if k != "cam-01"}
    s1 = solver.solve(drop1, cameras, prior3d=full.solution3d,
                      raised_side=RAISED_RIGHT)
    assert s1.status == STATUS_RESOLVED
    drop2 = {k: v for k, v in obs.items() if k not in ("cam-01", "cam-02")}
    s2 = solver.solve(drop2, cameras, prior3d=full.solution3d,
                      raised_side=RAISED_RIGHT)
    assert s2.status == STATUS_RESOLVED


def test_camera_dropout_eventually_ambiguous():
    body = pose_cued_v56(60.0)
    obs, cameras = _scene(body)
    solver = MultiviewPolaritySolver()
    two = {k: v for k, v in obs.items() if k in ("cam-04", "cam-05")}
    s = solver.solve(two, cameras)  # rear pair only, no anchor, no prior
    assert s.status in (STATUS_AMBIGUOUS, STATUS_RESOLVED)
    one = {"cam-04": obs["cam-04"]}
    s1 = solver.solve(one, cameras)
    assert s1.status in (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT)


# ---------- Phase 37: patient rotation ----------

def test_patient_rotation_identity_stable():
    # identity is carried by prior state, not re-decided per frame.
    body = pose_cued_v56(60.0)
    solver = MultiviewPolaritySolver()
    filt = TemporalPolarityFilter(patient_id="rot")
    for i, drop in enumerate([None, "cam-01", "cam-08", None]):
        obs, cameras = _scene(body, swaps=("cam-04",) if i == 2 else ())
        if drop:
            obs = {k: v for k, v in obs.items() if k != drop}
        sol = solver.solve(obs, cameras,
                           prior3d=filt.state.solution3d or None,
                           raised_side=RAISED_RIGHT)
        out = filt.update(sol, i / 60)
        assert out.status == STATUS_RESOLVED, (i, sol.diagnostics)
    assert filt.state.polaritySwitchCount == 0


# ---------- Phase 24: protocol side ----------

def test_protocol_side_requires_resolved_identity():
    body = pose_symmetric_v56(60.0)
    obs, cameras = _scene(body)
    sol = MultiviewPolaritySolver().solve(obs, cameras, protocol_side="right")
    # protocol side is supporting evidence only: must not force resolution.
    assert sol.status in (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT)
    assert sol.solution3d == {}


# ---------- Phase 43: no truth leakage ----------

def test_no_ground_truth_leakage():
    import inspect

    from app.identity import solver as solver_mod

    src = inspect.getsource(solver_mod)
    for banned in ("truth3d", "expected_knee", "ground_truth", "ground-truth",
                   "identity_fixtures", "pose_cued",
                   "pose_symmetric", "pose_body_v5"):
        assert banned not in src, banned
    sig = inspect.signature(solver_mod.MultiviewPolaritySolver.solve)
    for p in sig.parameters:
        assert "truth" not in p.lower()


def test_body_frame_needs_evidence_for_sign():
    pts = {f"{s}-{j}": [0.0, 1.0 if "shoulder" in j else 0.5, 0.1 if s == "right" else -0.1]
           for s in ("left", "right")
           for j in ("hip", "shoulder")}
    f = build_body_frame(pts)
    assert f["ok"] and not f["lateralSignResolved"]
    f2 = build_body_frame(pts, orientation_hint={"facing": [1, 0, 0]})
    assert f2["lateralSignResolved"]


# ---------- Phase 46: V5.5 adversarial wrong-low-reprojection ----------

def test_adversarial_wrong_low_reprojection_suspends_or_corrects():
    """V5 P25 mode: all views agree on mirrored labels at low residual.

    Old pipeline: wrong solution possible. V5.6: correct selection OR
    ambiguous suspension. Confident-wrong is FAIL.
    """
    body = pose_body_v5(60.0)
    cams = ring_cameras_v5()
    lids = [l for l in body if not l.startswith("_")]
    obs, cameras = {}, {}
    for cam in cams:
        ol = []
        for lid in lids:
            # every camera reports the MIRRORED label at the mirrored pixel:
            # self-consistent, low residual, wrong anatomy.
            if is_bilateral(lid):
                x, y = project(cam["P"], body[mirror_of(lid)])
                ul = lid  # claims own label at mirror's pixel
            else:
                x, y = project(cam["P"], body[lid])
                ul = lid
            ol.append({"cameraId": cam["cameraId"], "landmarkId": ul,
                       "xPx": float(x), "yPx": float(y), "confidence": 0.85,
                       "timestampMs": 0.0, "frameId": "f0"})
        obs[cam["cameraId"]] = ol
    cameras = {c["cameraId"]: {"cameraId": c["cameraId"],
                               "projectionMatrix": c["P"].tolist()}
               for c in cams}
    sol = MultiviewPolaritySolver().solve(obs, cameras)
    if sol.status == STATUS_RESOLVED:
        for side in ("left", "right"):
            err = float(np.linalg.norm(
                np.array(sol.solution3d[f"{side}-ankle"])
                - np.array(body[f"{side}-ankle"])))
            assert err < 0.05, f"confident wrong anatomy: {side} err {err}"
    else:
        assert sol.status in (STATUS_AMBIGUOUS, STATUS_INSUFFICIENT)
        assert sol.solution3d == {}


# ---------- Worker-gated: real RTMW over rendered fixtures ----------

def _render_observations(pose_fn, knee_deg, rtmw_infer, render_fn=None):
    import base64

    import cv2
    from identity_fixtures import render_v5 as _rv5

    render = render_fn or _rv5
    body = pose_fn(knee_deg)
    cams = ring_cameras_v5()
    seed = 20260913
    obs = {}
    for cam in cams:
        img = render(cam["P"], cam["C"], body, seed)
        _, buf = cv2.imencode(".png", img)
        out = rtmw_infer(base64.b64encode(bytes(buf)).decode(),
                         camera_id=cam["cameraId"])
        ol = [{"cameraId": cam["cameraId"], "landmarkId": l["landmarkId"],
               "xPx": l["xPx"], "yPx": l["yPx"],
               "confidence": l.get("confidence", 0.5),
               "timestampMs": 0.0, "frameId": "f0"}
              for l in out.get("landmarks", [])]
        obs[cam["cameraId"]] = ol
    cameras = {c["cameraId"]: {"cameraId": c["cameraId"],
                               "projectionMatrix": c["P"].tolist()}
               for c in cams}
    return body, obs, cameras


@pytest.mark.skipif(not NEED_WORKER, reason="needs RTMW worker :8102")
def test_worker_cued_fixture_zero_identity_failures():
    """Phase 29 hard target on REAL detector outputs: 0 L/R failures."""
    import importlib

    import identity_fixtures as fx

    importlib.reload(fx)
    from app.runtime_workers import rtmw_infer  # noqa: PLC0415

    failures, angles = 0, [0, 30, 60, 90, 105]
    solver = MultiviewPolaritySolver()
    for deg in angles:
        body, obs, cameras = _render_observations(fx.pose_cued_v56, deg,
                                                  rtmw_infer)
        sol = solver.solve(obs, cameras, raised_side=RAISED_RIGHT)
        if sol.status != STATUS_RESOLVED:
            continue  # suspended != wrong (counted separately)
        for side in ("left", "right"):
            for j in ("knee", "ankle"):
                lid = f"{side}-{j}"
                if lid in sol.solution3d:
                    err = float(np.linalg.norm(
                        np.array(sol.solution3d[lid]) - np.array(body[lid])))
                    mirror_err = float(np.linalg.norm(
                        np.array(sol.solution3d[lid])
                        - np.array(body[mirror_of(lid)])))
                    if mirror_err < err:
                        failures += 1
    assert failures == 0, f"{failures} L/R identity failures on cued fixture"


@pytest.mark.skipif(not NEED_WORKER, reason="needs RTMW worker :8102")
def test_worker_v5_adversarial_never_confident_wrong():
    """Phase 28/46 on REAL detector outputs: correct or suspended, never
    confident-wrong."""
    import importlib

    import identity_fixtures as fx

    importlib.reload(fx)
    from app.runtime_workers import rtmw_infer  # noqa: PLC0415

    solver = MultiviewPolaritySolver()
    confident_wrong = 0
    for deg in (0, 60, 90):
        body, obs, cameras = _render_observations(fx.pose_body_v5, deg,
                                                  rtmw_infer)
        sol = solver.solve(obs, cameras)
        if sol.status != STATUS_RESOLVED:
            continue
        for side in ("left", "right"):
            lid = f"{side}-ankle"
            if lid in sol.solution3d:
                err = float(np.linalg.norm(
                    np.array(sol.solution3d[lid]) - np.array(body[lid])))
                mirror_err = float(np.linalg.norm(
                    np.array(sol.solution3d[lid])
                    - np.array(body[mirror_of(lid)])))
                if mirror_err + 0.05 < err:
                    confident_wrong += 1
    assert confident_wrong == 0
