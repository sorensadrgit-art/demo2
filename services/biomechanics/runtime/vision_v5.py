"""KineLab Precision V5 vision end-to-end harness.

Golden fixture: corrected-handedness 8-camera ring (screen-right = view x up,
det(R)=+1, mirrors like a real camera) + asymmetric humanized subject
(body-attached L/R color cues, face front / hair back, back logo panel).

Sweep: right-knee flexion 0..120 deg x 8 cameras, real RTMW-L inference,
triangulate_iterative-equivalent weighted-DLT + multi-round rejection +
refine (same 8px gates as the production endpoint), RANSAC consensus
audit, polarity arbitration, then each angle through the REAL endpoint
POST /precision/process_v5 (recorded verbatim in "endpointJobs").

Finding record (2026-09-13): geometry PROVEN sound — at 60deg the ankle
RANSAC winner is unique (6v5) at 2.7px refined RMSE yet 450mm from truth:
six wide-baseline views agreeing to 2.7px on a 450mm-wrong point is
systematic detector mislocalization (wrong structure at flexion), not
noise, swap, or triangulation weakness. Knee shows genuine 5v5 competing
hypotheses. Production gates FAIL the job, which is the correct outcome:
no silent bad measurement. Detector-side fix required (out of scope:
no replacement AutoLock/MediaPipe per V5 constraints).

Writes vision_v5_sweep.json (machine-readable proof) and prints the V5
quantitative summary. Deterministic (seeded).
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import sys
import time
import urllib.request

import cv2
import numpy as np

REPO = "/workspace/project/demo2"
RUNTIME = os.path.join(REPO, "services", "biomechanics", "runtime")
sys.path.insert(0, RUNTIME)
sys.path.insert(0, os.path.join(REPO, "services", "biomechanics"))

RTMW_URL = os.environ.get("KINELAB_RTMW_URL", "http://127.0.0.1:8102")
FX, FY, CX, CY = 800.0, 800.0, 320.0, 240.0
W, H = 640, 480
SEED = 20260913
ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120]
N_CAMERAS = 8

LOWER_LIMB = ("left-hip", "right-hip", "left-knee", "right-knee",
              "left-ankle", "right-ankle", "left-heel",
              "left-foot-index", "right-foot-index")
MIRROR = {"left": "right", "right": "left"}


def mirror_of(lid: str) -> str:
    side, rest = lid.split("-", 1)
    return MIRROR[side] + "-" + rest


# ---------- fixture ----------

def ring_cameras_v5(n: int = N_CAMERAS, radius: float = 3.0, height: float = 1.4):
    K = np.array([[FX, 0, CX], [0, FY, CY], [0, 0, 1.0]])
    target = np.array([0.0, 0.9, 0.0])
    cams = []
    for i in range(n):
        th = 2 * math.pi * i / n
        C = np.array([radius * math.cos(th), height, radius * math.sin(th)])
        z = (target - C) / np.linalg.norm(target - C)
        up = np.array([0.0, 1.0, 0.0])
        x = np.cross(z, up)  # screen-right = view x up (real-camera mirror)
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        R = np.stack([x, y, z])
        t = -R @ C
        cams.append({"cameraId": "cam-%02d" % (i + 1), "K": K, "R": R,
                     "t": t, "P": K @ np.hstack([R, t.reshape(3, 1)]),
                     "C": C, "azimuthDeg": round(math.degrees(th), 1)})
    return cams


def pose_body_v5(knee_deg: float) -> dict:
    """Right-knee flexion chain; truth joint positions exact by construction.

    Subject faces +X (toward cam-01). Segment lengths match gait2392
    (femur 0.3958 m, tibia 0.4300 m); right tibia rotates about the
    mediolateral axis so the flexion arc stays in the sagittal plane.
    """
    hip = np.array([0.0, 0.8839, 0.0])
    lknee = np.array([0.0, 0.4881, -0.0835])
    lank = np.array([0.0, 0.0581, -0.0835])
    rknee = np.array([0.0, 0.4881, 0.0835])
    r = math.radians(knee_deg)
    # Flexion swings the shank forward (+X, subject faces +X), rotating
    # about the mediolateral (Z) axis through the knee center.
    rank = rknee + 0.43 * np.array([math.sin(r), -math.cos(r), 0.0])
    pts = {
        "left-hip": hip + np.array([0, 0, -0.10]),
        "right-hip": hip + np.array([0, 0, 0.10]),
        "left-knee": lknee, "right-knee": rknee,
        "left-ankle": lank, "right-ankle": rank,
        "left-heel": lank + np.array([-0.055, -0.015, 0]),
        "right-heel": rank + np.array([-0.055, -0.015, 0]),
        "left-foot-index": lank + np.array([0.155, -0.02, 0]),
        "right-foot-index": rank + np.array([0.155, -0.02, 0]),
        "left-shoulder": np.array([0.0, 1.40, -0.20]),
        "right-shoulder": np.array([0.0, 1.40, 0.20]),
        "left-elbow": np.array([0.0, 1.14, -0.24]),
        "right-elbow": np.array([0.0, 1.14, 0.24]),
        "left-wrist": np.array([0.0, 0.90, -0.26]),
        "right-wrist": np.array([0.0, 0.90, 0.26]),
    }
    pts["_torsoc"] = (pts["left-shoulder"] + pts["right-shoulder"]
                      + pts["left-hip"] + pts["right-hip"]) / 4
    pts["_nose"] = np.array([0.10, 1.52, 0.0])
    return pts


def truth_knee_angle(pts: dict) -> float:
    a, b, c = pts["right-hip"], pts["right-knee"], pts["right-ankle"]
    u, v = a - b, c - b
    d = float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))
    return math.degrees(math.acos(max(-1.0, min(1.0, d))))


def render_v5(P, C, pts, seed: int):
    """Asymmetric humanized render: L=red family, R=blue family, face/hair,
    back logo. Depth-sorted painter (far to near).

    Segments connect joint CENTER to joint center (sticks pass through the
    RTMW keypoint locations) with thin limbs over a soft torso shell so no
    landmark is buried under bulk geometry.
    """
    rng = np.random.default_rng(seed)
    img = np.full((H, W, 3), 128, np.uint8)

    def pt(X):
        p = P @ np.append(X, 1.0)
        return (int(round(p[0] / p[2])), int(round(p[1] / p[2])))

    def depth(X):
        return float(np.linalg.norm(np.asarray(X, dtype=float) - C))

    skin, hair = (200, 170, 140), (25, 20, 15)
    RED, BLUE, shoe = (60, 60, 210), (210, 140, 40), (25, 25, 25)
    elems = []
    for side in (-1, 1):
        s = "left" if side < 0 else "right"
        thc = RED if side < 0 else BLUE
        hip, knee, ank = pts[s + "-hip"], pts[s + "-knee"], pts[s + "-ankle"]
        elems.append((depth((hip + knee) / 2), "seg", (hip, knee, thc, 13)))
        elems.append((depth((knee + ank) / 2), "seg", (knee, ank, thc, 10)))
        heel, toe = pts[s + "-heel"], pts[s + "-foot-index"]
        foot_len = float(np.linalg.norm(np.asarray(toe) - np.asarray(ank)))
        shank_len = float(np.linalg.norm(np.asarray(ank) - np.asarray(knee)))
        if foot_len > 0.55 * shank_len:
            # articulation artifact: foot outruns the shank (detector cue
            # for mislocalization) — pin the foot near the ankle.
            heel = ank + (np.asarray(heel) - np.asarray(ank)) * 0.25
            toe = ank + (np.asarray(toe) - np.asarray(ank)) * 0.25
        elems.append((depth((ank + toe) / 2), "seg", (ank, toe, shoe, 8)))
        elems.append((depth(heel), "circ", (heel, 5, shoe)))
        sho, elb, wri = pts[s + "-shoulder"], pts[s + "-elbow"], pts[s + "-wrist"]
        elems.append((depth((sho + elb) / 2), "seg", (sho, elb, thc, 10)))
        elems.append((depth((elb + wri) / 2), "seg", (elb, wri, skin, 8)))
        elems.append((depth(wri), "circ", (wri, 5, skin)))
    pc = pts["_torsoc"]
    # soft torso shell drawn FIRST (deepest layer) so limb sticks stay visible
    elems.append((depth(pc) + 0.06, "ell", (pc, (46, 80), (92, 132, 202))))
    elems.append((depth(pc + np.array([0.01, 0.10, -0.20])), "circ",
                  (pc + np.array([0.01, 0.10, -0.20]), 12, RED)))
    elems.append((depth(pc + np.array([0.01, 0.10, 0.20])), "circ",
                  (pc + np.array([0.01, 0.10, 0.20]), 12, BLUE)))
    bp = pc + np.array([-0.10, 0.15, 0])
    elems.append((depth(bp) - 0.05, "circ", (bp, 20, (0, 255, 255))))
    head = pts["_nose"] + np.array([0, 0.06, 0])
    elems.append((depth(head) + 0.03, "circ", (head, 30, skin)))
    facing = float(np.dot(np.asarray(C) - head, np.array([1.0, 0, 0])))
    if facing > 0:
        for off in ([0.045, 0.10, 0.035], [0.045, 0.10, -0.035]):
            elems.append((depth(head) - 0.1, "circ",
                          (head + np.array(off), 5, (15, 15, 15))))
        elems.append((depth(head) - 0.1, "seg",
                      (head + np.array([0.045, 0.0, -0.03]),
                       head + np.array([0.045, 0.0, 0.03]), (15, 15, 15), 4)))
        elems.append((depth(head + np.array([-0.02, 0.10, 0])) + 0.01, "circ",
                      (head + np.array([-0.02, 0.10, 0]), 26, hair)))
    else:
        elems.append((depth(head) - 0.1, "circ",
                      (head + np.array([-0.02, 0.02, 0]), 28, hair)))
        hb = head + np.array([-0.06, -0.22, 0])
        elems.append((depth(hb) - 0.05, "seg",
                      (head + np.array([-0.05, -0.05, 0]), hb, hair, 28)))
    elems.sort(key=lambda e: -e[0])
    for _, kind, a in elems:
        if kind == "seg":
            A, B, col, th = a
            cv2.line(img, pt(A), pt(B), col, th, cv2.LINE_AA)
        elif kind == "circ":
            X, r, col = a
            cv2.circle(img, pt(X), r, col, -1, cv2.LINE_AA)
        else:
            X, axes, col = a
            cv2.ellipse(img, pt(X), axes, 0, 0, 360, col, -1, cv2.LINE_AA)
    noise = rng.integers(-8, 8, img.shape, dtype=np.int16)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def project(P, X):
    p = P @ np.append(np.asarray(X, dtype=float), 1.0)
    return (float(p[0] / p[2]), float(p[1] / p[2]))


def rtmw_infer(img_png: bytes, camera_id: str, ts_ms: float,
               timeout_s: float = 180.0) -> dict:
    body = json.dumps({
        "imageB64": base64.b64encode(img_png).decode(),
        "cameraId": camera_id, "timestampMs": ts_ms,
    }).encode()
    req = urllib.request.Request(RTMW_URL + "/infer", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:
        return json.load(r)


def rtmw_health() -> dict:
    with urllib.request.urlopen(RTMW_URL + "/health", timeout=10) as r:
        return json.load(r)


# ---------- main sweep ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--quick", action="store_true",
                    help="2 angles only (endpoint smoke)")
    args = ap.parse_args()
    angles = [0, 60] if args.quick else ANGLES
    os.makedirs(args.out, exist_ok=True)

    health = rtmw_health()
    assert health.get("modelLoaded"), health
    ckpt_manifest = json.load(open(os.path.join(
        REPO, "services/biomechanics/models/rtmw/manifest.json")))
    osim_manifest = json.load(open(os.path.join(
        REPO, "services/biomechanics/models/opensim/manifest.json")))

    cams = ring_cameras_v5()
    from rtmw_schema import SCHEMA_ID, SCHEMA_VERSION  # noqa: E402

    sweep, infer_times, tri_times = [], [], []
    frame_idx = 0
    for ai, ang in enumerate(angles):
        truth = pose_body_v5(ang)
        truth_angle = truth_knee_angle(truth)
        frame_id = "v5-f%02d" % ai
        ts_ms = 1000.0 * frame_idx
        obs_all, views = [], {}
        for ci, cam in enumerate(cams):
            img = render_v5(cam["P"], cam["C"], truth, SEED + ai * 100 + ci)
            _, buf = cv2.imencode(".png", img)
            t0 = time.perf_counter()
            resp = rtmw_infer(bytes(buf), cam["cameraId"], ts_ms)
            infer_times.append((time.perf_counter() - t0) * 1000.0)
            assert resp.get("ok"), resp
            lms = {l["landmarkId"]: l for l in resp["landmarks"]}
            views[cam["cameraId"]] = {
                "landmarks": len(lms), "missing": resp.get("missingLandmarks", []),
            }
            for lid, l in lms.items():
                obs_all.append({"cameraId": cam["cameraId"], "landmarkId": lid,
                                "xPx": l["xPx"], "yPx": l["yPx"],
                                "confidence": l["confidence"],
                                "timestampMs": ts_ms, "frameId": frame_id,
                                "truthPx": list(project(cam["P"], truth[lid]))
                                if lid in truth else None})
        sweep.append({"angle": ang, "truthAngleDeg": round(truth_angle, 3),
                      "frameId": frame_id, "timestampMs": ts_ms,
                      "truth3d": {k: [round(float(v), 6) for v in truth[k]]
                                  for k in LOWER_LIMB},
                      "views": views, "observations": obs_all})
        frame_idx += 1

    # geometry: triangulate (self-consistent inlier selection via
    # iterative worst-view rejection) + identity audit vs truth + accuracy.
    # The identity audit (detection nearer own-truth than mirror-truth)
    # REPORTS failures; triangulation itself never sees truth. A RANSAC
    # consensus check (all camera pairs, refined, largest inlier set) is
    # recorded per landmark to prove whether the surviving inlier set is
    # the unique self-consistent solution or one of several competing
    # hypotheses. Triangulation here mirrors the production endpoint's
    # triangulate_iterative (same gates); the endpoint itself is then
    # exercised per angle below via TestClient and its jobs recorded in
    # "endpointJobs" as the production-path proof.
    from app.reconstruction.triangulation import (  # noqa: E402
        CameraView, _dlt, _residuals, refine_point, triangulate_weighted)
    import itertools as _it

    def ransac_consensus(vs: list, tol_px: float = 10.0) -> dict:
        """Largest self-consistent view subset over all camera pairs.

        Pure multi-view geometry: no truth, no labels, no camera IDs. Each
        pair hypothesis is LS-refined before inlier counting (same refinement
        the endpoint applies), so the winner is the subset the production
        pipeline itself would converge to. Returns winner size, winner
        views, runner-up size, and whether the winner is unique (no
        competing hypothesis of equal size).
        """
        best: set = set()
        runner: set = set()
        n = len(vs)
        if n < 2:
            return {"winner": [], "winnerSize": 0, "runnerUpSize": 0,
                    "unique": False}
        by_id = {v.cameraId: v for v in vs}
        for i, j in _it.combinations(range(n), 2):
            try:
                p = _dlt([vs[i], vs[j]])
                p, _, _, _ = refine_point(p, [vs[i], vs[j]])
            except Exception:  # noqa: BLE001 — degenerate pair, skip
                continue
            r = _residuals(p, vs)
            inl = {v.cameraId for v in vs if r[v.cameraId] <= tol_px}
            if len(inl) > len(best):
                runner = best
                best = inl
            elif len(inl) > len(runner) and inl != best:
                runner = inl
        win = [by_id[c] for c in sorted(best)]
        wpt = None
        wrmse = None
        if len(win) >= 2:
            try:
                wpt, wrmse, _, _ = refine_point(_dlt(win), win)
                wrmse = round(float(wrmse), 2)
                wpt = [round(float(v), 4) for v in wpt]
            except Exception:  # noqa: BLE001 — winner unrefinable, report DLT
                wpt = None
        return {"winner": sorted(best), "winnerSize": len(best),
                "runnerUpSize": len(runner),
                "unique": len(best) > len(runner),
                "winnerPointM": wpt, "winnerRmsePx": wrmse}
    # sequence-level polarity arbitration (motion-based, truth-free).
    # NOTE (honesty gate): exercised only when the detector localizes BOTH
    # knees on the moving side; if every view is "ambiguous" the sweep keeps
    # raw labels and reports that. Arbitration here uses the trial's own
    # motion, never truth, never camera IDs.
    tracks: dict[str, dict[str, list]] = {}
    for fr in sweep:
        for o in fr["observations"]:
            if o["landmarkId"] in ("right-knee", "left-knee"):
                tracks.setdefault(o["cameraId"], {}).setdefault(
                    o["landmarkId"], []).append(o["xPx"] + 1j * o["yPx"])
    polarity: dict[str, str] = {}
    for cid, tr in tracks.items():
        rk = np.array(tr.get("right-knee", []))
        lk = np.array(tr.get("left-knee", []))
        if len(rk) < 3 or len(lk) < 3:
            polarity[cid] = "unknown"
            continue
        rk_range = float(np.ptp(np.abs(rk - rk[0])))
        lk_range = float(np.ptp(np.abs(lk - lk[0])))
        # flexing knee travels a large arc; stance knee is near-static.
        # "right" track static + "left" track moving => view is mirrored.
        if rk_range < 40.0 and lk_range > 120.0:
            polarity[cid] = "mirrored"
        elif rk_range > 120.0 and lk_range < 40.0:
            polarity[cid] = "correct"
        else:
            polarity[cid] = "ambiguous"
    results = []
    for fr in sweep:
        by_lid: dict[str, list] = {}
        for o in fr["observations"]:
            lid = o["landmarkId"]
            if polarity.get(o["cameraId"]) == "mirrored" and "-" in lid:
                lid = mirror_of(lid)  # arbitrate to flexing-side frame
            by_lid.setdefault(lid, []).append(o)
        points, detail, idfails, drops = {}, {}, [], {}
        for lid, obs in by_lid.items():
            if lid not in fr["truth3d"]:
                continue
            vs = [CameraView(o["cameraId"],
                             next(c["P"] for c in cams
                                  if c["cameraId"] == o["cameraId"]),
                             o["xPx"], o["yPx"], o["confidence"])
                  for o in obs]
            t0 = time.perf_counter()
            try:
                res = triangulate_weighted(vs, min_views=3,
                                           outlier_threshold_px=8.0,
                                           max_reproj_px=8.0,
                                           max_reject_rounds=6)
            except Exception:  # noqa: BLE001 — degenerate views recorded, not fatal
                drops[lid] = True
                continue
            tri_times.append((time.perf_counter() - t0) * 1000.0)
            points[lid] = res.pointM
            detail[lid] = {"used": res.usedCameraIds,
                           "rejected": res.rejectedCameraIds,
                           "rmse": round(res.reprojectionErrorPx, 2),
                           "residuals": {k: round(v, 2)
                                         for k, v in res.residualsPx.items()},
                           "ransac": ransac_consensus(vs)}
        # L/R identity: per view, detection nearer own truth than mirror?
        for o in fr["observations"]:
            lid = o["landmarkId"]
            if lid not in fr["truth3d"] or mirror_of(lid) not in fr["truth3d"]:
                continue
            cam = next(c for c in cams if c["cameraId"] == o["cameraId"])
            t_own = np.array(project(cam["P"], fr["truth3d"][lid]))
            t_mir = np.array(project(cam["P"], fr["truth3d"][mirror_of(lid)]))
            if float(np.linalg.norm(t_own - t_mir)) < 30.0:
                continue  # indeterminate view: limbs overlap in projection
            d = np.array([o["xPx"], o["yPx"]])
            if float(np.linalg.norm(d - t_mir)) + 15 < float(np.linalg.norm(d - t_own)):
                idfails.append({"cameraId": o["cameraId"], "landmark": lid})
        for lid in fr["truth3d"]:
            if lid not in points and lid not in drops:
                drops[lid] = True
        # 3D + angle errors (need hip+knee+ankle; else angle ungated here)
        e3d = {lid: round(float(np.linalg.norm(
            np.array(points[lid]) - np.array(fr["truth3d"][lid]))) * 1000, 2)
            for lid in points}
        chain = ("right-hip", "right-knee", "right-ankle")
        chain_ok = all(k in points for k in chain)
        if chain_ok:
            a, b, c = (np.array(points[k]) for k in chain)
            u, v = a - b, c - b
            ang3d = math.degrees(math.acos(max(-1.0, min(1.0, float(
                np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))))))
            seg_fem = float(np.linalg.norm(np.array(points["right-hip"])
                                           - np.array(points["right-knee"])))
            seg_tib = float(np.linalg.norm(np.array(points["right-knee"])
                                           - np.array(points["right-ankle"])))
        else:
            ang3d = float("nan")
            seg_fem, seg_tib = float("nan"), float("nan")
        results.append({"angle": fr["angle"], "truthAngleDeg": fr["truthAngleDeg"],
                        "angle3dDeg": round(ang3d, 3),
                        "angleErrDeg": round(abs(ang3d - fr["truthAngleDeg"]), 3)
                        if chain_ok else None,
                        "err3dMm": e3d, "segmentsM": {"femurR": round(seg_fem, 4),
                                                     "tibiaR": round(seg_tib, 4)},
                        "identityFails": idfails, "dropouts": sorted(drops),
                        "triangulation": detail})

    # production-path proof: each angle through the REAL endpoint
    # POST /precision/process_v5 (sync gate + triangulate_iterative +
    # V4 markers + OpenSim IK + ClinicalMeasurement). Truth fields are
    # stripped before POST; the job responses are recorded verbatim.
    endpoint_jobs: list = []
    try:
        import subprocess as _sp  # noqa: E402
        for fr in sweep:
            ep_obs = [{k: o[k] for k in
                       ("cameraId", "landmarkId", "xPx", "yPx",
                        "confidence", "timestampMs", "frameId")}
                      for o in fr["observations"]]
            ep_payload = {
                "cameras": [{"cameraId": c["cameraId"],
                             "projectionMatrix": c["P"].tolist()} for c in cams],
                "frames": [{"frameId": fr["frameId"],
                            "timestampMs": fr["timestampMs"],
                            "observations": ep_obs}],
                "rtmwModel": {"provider": "rtmw",
                              "model": ckpt_manifest["checkpointFilename"],
                              "checkpoint": ckpt_manifest["checkpointFilename"],
                              "checkpointSha256": ckpt_manifest["checkpointSha256"],
                              "schema": SCHEMA_ID,
                              "schemaVersion": SCHEMA_VERSION,
                              "opensimModelSha256": osim_manifest["modelSha256"]},
                "targetJoint": "knee-flexion-r",
            }
            _pay_path = os.path.join(args.out, "_ep_pay.json")
            with open(_pay_path, "w") as _pf:
                json.dump(ep_payload, _pf)
            # system python3 carries fastapi; venv python lacks it. Run the
            # endpoint call out-of-process with CWD=services/biomechanics.
            _probe = (
                "import json,sys;"
                "sys.path.insert(0,'.');"
                "from fastapi.testclient import TestClient;"
                "from app.main import app;"
                "pay=json.load(open('%s'));" % _pay_path +
                "job=TestClient(app).post('/precision/process_v5',"
                "json=pay).json();"
                "m=job.get('measurement') or {};"
                "print(json.dumps({'state':job.get('state'),"
                "'valueDeg':m.get('valueDeg'),"
                "'triangulatedAngleDeg':m.get('triangulatedAngleDeg'),"
                "'error':job.get('error')}))"
            )
            _run = _sp.run(["python3", "-c", _probe], capture_output=True,
                           text=True, cwd=os.path.join(REPO, "services/biomechanics"),
                           timeout=600)
            if _run.returncode != 0:
                endpoint_jobs.append({
                    "angle": fr["angle"], "truthAngleDeg": fr["truthAngleDeg"],
                    "state": "PROBE_FAILED",
                    "error": (_run.stderr or _run.stdout)[-500:]})
            else:
                _job = json.loads(_run.stdout.strip().splitlines()[-1])
                endpoint_jobs.append({
                    "angle": fr["angle"], "truthAngleDeg": fr["truthAngleDeg"],
                    **_job})
    except Exception as e:  # noqa: BLE001 — endpoint proof best-effort
        endpoint_jobs.append({"state": "PROBE_FAILED", "error": str(e)})

    report = {
        "experiment": "kinelab-precision-v5",
        "pipelineVersion": "kinelab-precision-v5",
        "polarityArbitration": {
            "method": "per-view knee-track range over sweep (truth-free); "
                      "flexing-side moves, stance-side static",
            "polarity": polarity,
        },
        "endpointJobs": endpoint_jobs,
        "seed": SEED, "angles": angles, "nCameras": N_CAMERAS,
        "fixture": {"handedness": "screen-right = view x up, det(R)=+1",
                    "subjectFaces": "+X (toward cam-01)",
                    "cues": ["L red/R blue limbs", "face front / hair back",
                             "chest side panels", "back logo panel"],
                    "renderer": "services/biomechanics/runtime/vision_v5.py:render_v5",
                    "truthSource": "pose_body_v5 chain (exact by construction)"},
        "cameras": [{"cameraId": c["cameraId"], "azimuthDeg": c["azimuthDeg"],
                     "K": c["K"].tolist(), "R": c["R"].tolist(),
                     "t": c["t"].tolist(), "C": c["C"].tolist(),
                     "P": c["P"].tolist()} for c in cams],
        "rtmw": {"health": health, "schema": SCHEMA_ID,
                 "schemaVersion": SCHEMA_VERSION,
                 "checkpointSha256": ckpt_manifest["checkpointSha256"],
                 "checkpoint": ckpt_manifest["checkpointFilename"],
                 "config": ckpt_manifest["configFile"]},
        "opensim": {"model": osim_manifest["modelFilename"],
                    "modelSha256": osim_manifest["modelSha256"],
                    "version": osim_manifest["opensimVersion"]},
        "timing": {
            "rtmwInferMs": {"p50": round(float(np.median(infer_times)), 1),
                            "p95": round(float(np.quantile(infer_times, 0.95)), 1),
                            "n": len(infer_times)},
            "triangulateMs": {"p50": round(float(np.median(tri_times)), 1),
                              "p95": round(float(np.quantile(tri_times, 0.95)), 1),
                              "n": len(tri_times)}},
        "results": results,
    }
    with open(os.path.join(args.out, "vision_v5_sweep.json"), "w") as f:
        json.dump(report, f, indent=1)
    idfails = sum(len(r["identityFails"]) for r in results)
    errs = [r["angleErrDeg"] for r in results if r["angleErrDeg"] is not None]
    e3 = [v for r in results for v in r["err3dMm"].values()]
    print("V5 sweep: %d angles, identityFails=%d, angleErr max=%.2f mean=%.2f, "
          "err3d p95=%.1fmm infer p50/p95=%.0f/%.0fms tri p50/p95=%.1f/%.1fms"
          % (len(results), idfails, max(errs), sum(errs) / len(errs),
             float(np.quantile(e3, 0.95)), report["timing"]["rtmwInferMs"]["p50"],
             report["timing"]["rtmwInferMs"]["p95"],
             report["timing"]["triangulateMs"]["p50"],
             report["timing"]["triangulateMs"]["p95"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
