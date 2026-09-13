"""V4 bias-study harness (Phases 11-14, 18).

Generates TRC marker trajectories directly from the OpenSim model at known
coordinates (model-neutral ground truth), runs real IK, scores the error
curve. Experiments:
  roundtrip   - markers attached at generation stations (solver intrinsic)
  origin      - V3 behavior: markers attached at body origins (documents bias)
  scale       - data stations scaled by --scale (segment-length mismatch)
  noise       - Gaussian noise sigma_mm added to TRC (vision-chain prediction)
Writes JSON report to --out.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "services", "biomechanics", "runtime"))

ANGLES_DEFAULT = [0, 5, 10, 15, 30, 45, 60, 90, 120, 150]

STATIONS = {
    "R.ASIS": ("pelvis", (0.08, 0.08, 0.10)),
    "L.ASIS": ("pelvis", (0.08, 0.08, -0.10)),
    "V.Sacral": ("pelvis", (-0.08, 0.10, 0.0)),
    "R.Thigh.Front": ("femur_r", (0.10, -0.20, 0.0)),
    "R.Knee.Lat": ("tibia_r", (0.0, 0.02, 0.09)),
    "R.Shank.Front": ("tibia_r", (0.08, -0.20, 0.0)),
    "R.Ankle.Lat": ("talus_r", (0.0, -0.02, 0.06)),
    "R.Heel": ("calcn_r", (-0.06, -0.05, 0.0)),
    "R.Toe.Tip": ("toes_r", (0.12, -0.03, 0.0)),
}

SPARSE = ["R.ASIS", "L.ASIS", "V.Sacral", "R.Knee.Lat", "R.Ankle.Lat", "R.Heel"]


def gen_traj(model_path: str, angles: list[float], names: list[str],
             scale: float, noise_mm: float, seed: int) -> dict:
    import opensim
    import numpy as np

    model = opensim.Model(model_path)
    model.initSystem()
    st = model.getWorkingState()
    bodies = {b: model.getBodySet().get(b) for b in
              ["pelvis", "femur_r", "tibia_r", "talus_r", "calcn_r", "toes_r"]}
    rng = np.random.default_rng(seed)
    frames = []
    for i, ka in enumerate(angles):
        model.getCoordinateSet().get("hip_flexion_r").setValue(st, math.radians(-ka * 0.35))
        model.getCoordinateSet().get("knee_angle_r").setValue(st, math.radians(ka))
        model.getCoordinateSet().get("ankle_angle_r").setValue(st, math.radians(ka * 0.15))
        model.realizePosition(st)
        mk = {}
        for name in names:
            bname, off = STATIONS[name]
            p = bodies[bname].findStationLocationInGround(st, opensim.Vec3(*off))
            xyz = [p.get(0) * scale, p.get(1) * scale, p.get(2) * scale]
            if noise_mm:
                xyz = [v + n / 1000.0 for v, n in zip(xyz, rng.normal(0, noise_mm, 3))]
            mk[name] = xyz
        frames.append({"t": round(i / 60.0, 4), "markers": mk})
    return {"rateHz": 60, "frames": frames}


def run_ik(model_path: str, traj: dict, outdir: str, attach: str) -> dict:
    os.makedirs(outdir, exist_ok=True)
    tj = os.path.join(outdir, "traj.json")
    json.dump(traj, open(tj, "w"))
    env = dict(os.environ)
    if attach != "station":
        env["KINELAB_IK_ATTACH"] = attach  # origin -> attach at (0,0,0)
    else:
        env["KINELAB_IK_ATTACH_JSON"] = json.dumps(
            {n: STATIONS[n][1] for n in traj["frames"][0]["markers"]})
    r = subprocess.run([sys.executable, os.path.join(REPO, "services", "biomechanics",
                                                     "runtime", "opensim_ik.py"),
                        "--model", model_path, "--markers", tj, "--out", outdir],
                       capture_output=True, text=True, env=env)
    for line in r.stdout.splitlines():
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"IK produced no report: {r.stdout[-500:]} {r.stderr[-500:]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--angles", default=",".join(map(str, ANGLES_DEFAULT)))
    ap.add_argument("--sparse", action="store_true")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--noise-mm", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--attach", choices=["station", "origin"], default="station")
    args = ap.parse_args()

    angles = [float(a) for a in args.angles.split(",")]
    names = SPARSE if args.sparse else sorted(STATIONS)
    traj = gen_traj(args.model, angles, names, args.scale, args.noise_mm, args.seed)
    rep = run_ik(args.model, traj, args.out, args.attach)
    got = rep["coordinatesDeg"]["knee_angle_r"]
    errs = [g - t for g, t in zip(got, angles)]
    report = {
        "experiment": {"sparse": args.sparse, "scale": args.scale,
                       "noiseMm": args.noise_mm, "attach": args.attach, "seed": args.seed},
        "truthDeg": angles,
        "recoveredDeg": [round(v, 3) for v in got],
        "errorDeg": [round(e, 3) for e in errs],
        "maxAbsErrDeg": round(max(abs(e) for e in errs), 3),
        "frames": rep["frames"],
    }
    print(json.dumps(report, indent=1))
    json.dump(report, open(os.path.join(args.out, "bias_report.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
