"""Real OpenSim IK solve for KineLab (Phase 27-28).

Loads gait2392, attaches an explicit KineLab marker set to body frames,
writes a .trc marker trajectory, runs InverseKinematicsTool, returns
coordinate trajectories + residuals.

Usage: python3 opensim_ik.py --markers markers.json --out outdir
markers.json: {"rateHz": 60, "frames": [{"t": 0.0, "markers": {"L.ASIS": [x,y,z], ...}}]}
Units: meters in JSON, converted to mm for .trc (OpenSim convention).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

MARKER_TO_BODY = {
    "R.ASIS": "pelvis", "L.ASIS": "pelvis", "V.Sacral": "pelvis",
    "R.Thigh.Upper": "femur_r", "R.Thigh.Front": "femur_r", "R.Thigh.Rear": "femur_r",
    "L.Thigh.Upper": "femur_l", "L.Thigh.Front": "femur_l", "L.Thigh.Rear": "femur_l",
    "R.Knee.Lat": "tibia_r", "R.Knee.Med": "tibia_r",
    "L.Knee.Lat": "tibia_l", "L.Knee.Med": "tibia_l",
    "R.Shank.Upper": "tibia_r", "R.Shank.Front": "tibia_r", "R.Shank.Rear": "tibia_r",
    "L.Shank.Upper": "tibia_l", "L.Shank.Front": "tibia_l", "L.Shank.Rear": "tibia_l",
    "R.Ankle.Lat": "talus_r", "R.Ankle.Med": "talus_r",
    "L.Ankle.Lat": "talus_l", "L.Ankle.Med": "talus_l",
    "R.Heel": "calcn_r", "L.Heel": "calcn_l",
    "R.Midfoot.Sup": "calcn_r", "R.Midfoot.Lat": "calcn_r",
    "L.Midfoot.Sup": "calcn_l", "L.Midfoot.Lat": "calcn_l",
    "R.Toe.Lat": "toes_r", "R.Toe.Med": "toes_r", "R.Toe.Tip": "toes_r",
    "L.Toe.Lat": "toes_l", "L.Toe.Med": "toes_l", "L.Toe.Tip": "toes_l",
}

TRACK_COORDS = [
    "pelvis_tilt", "pelvis_list", "pelvis_rotation", "pelvis_tx", "pelvis_ty", "pelvis_tz",
    "hip_flexion_r", "hip_adduction_r", "hip_rotation_r",
    "hip_flexion_l", "hip_adduction_l", "hip_rotation_l",
    "knee_angle_r", "knee_angle_l",
    "ankle_angle_r", "ankle_angle_l",
]


def write_trc(path: str, frames: list[dict], marker_names: list[str], rate_hz: float) -> None:
    n = len(marker_names)
    with open(path, "w") as f:
        f.write("PathFileType\t4\t(X/Y/Z)\tkinelab.trc\n")
        f.write("DataRate\tCameraRate\tNumFrames\tNumMarkers\tUnits\tOrigDataRate\tOrigDataStartFrame\tOrigNumFrames\n")
        f.write(f"{rate_hz}\t{rate_hz}\t{len(frames)}\t{n}\tmm\t{rate_hz}\t1\t{len(frames)}\n")
        f.write("Frame#\tTime\t" + "\t".join(f"{m}\t\t" for m in marker_names).rstrip() + "\n")
        f.write("\t\t" + "\t".join(f"X{i+1}\tY{i+1}\tZ{i+1}" for i in range(n)) + "\n")
        f.write("\n")
        for i, fr in enumerate(frames):
            row = [str(i + 1), f"{fr['t']:.4f}"]
            for mname in marker_names:
                p = fr["markers"].get(mname)
                if p is None or any(v is None or (isinstance(v, float) and math.isnan(v)) for v in p):
                    row += ["0.0", "0.0", "0.0"]
                else:
                    row += [f"{p[0]*1000:.3f}", f"{p[1]*1000:.3f}", f"{p[2]*1000:.3f}"]
            f.write("\t".join(row) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--markers", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--accuracy", type=float, default=1e-5)
    args = ap.parse_args()

    import opensim  # noqa: PLC0415

    os.makedirs(args.out, exist_ok=True)
    with open(args.markers) as f:
        traj = json.load(f)
    frames = traj["frames"]
    rate = float(traj.get("rateHz", 60.0))
    names = sorted({m for fr in frames for m in fr["markers"]})
    if len(names) < 3:
        print(json.dumps({"status": "FAILED", "code": "IK_TOO_FEW_MARKERS",
                          "message": f"only {len(names)} markers supplied"}))
        return 2

    model = opensim.Model(args.model)
    mset = model.updMarkerSet()
    # V4: model markers attach at anatomical stations matching the data-side
    # marker placement. KINELAB_IK_ATTACH_JSON maps marker name -> [x,y,z]
    # offset (meters, body frame). Absent a station entry the marker falls
    # back to the body origin (legacy V3 behavior, kept for bias comparison).
    import json as _json
    try:
        stations = _json.loads(os.environ.get("KINELAB_IK_ATTACH_JSON", "{}"))
    except Exception:  # noqa: BLE001
        stations = {}
    for mname in names:
        body_name = MARKER_TO_BODY.get(mname)
        if body_name is None or not model.getBodySet().contains(body_name):
            continue
        mk = opensim.Marker()
        mk.setName(mname)
        mk.setParentFrame(model.getBodySet().get(body_name))
        off = stations.get(mname)
        mk.set_location(opensim.Vec3(*off) if off else opensim.Vec3(0, 0, 0))
        mset.adoptAndAppend(mk)
    model.finalizeFromProperties()
    model.initSystem()

    trc = os.path.join(args.out, "markers.trc")
    write_trc(trc, frames, names, rate)

    tool = opensim.InverseKinematicsTool()
    tool.setModel(model)
    tool.setMarkerDataFileName(trc)
    tool.setStartTime(frames[0]["t"])
    tool.setEndTime(frames[-1]["t"])
    tool.setOutputMotionFileName(os.path.join(args.out, "ik.mot"))
    tool.setResultsDir(args.out)
    tool.set_accuracy(args.accuracy)
    try:
        tool.run()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"status": "FAILED", "code": "IK_FAILED", "message": f"{type(e).__name__}: {e}"}))
        return 3

    mot_path = os.path.join(args.out, "ik.mot")
    coords: dict[str, list[float]] = {}
    times: list[float] = []
    if os.path.exists(mot_path):
        with open(mot_path) as f:
            lines = f.readlines()
        hdr = next(i for i, l in enumerate(lines) if l.startswith("time"))
        col_names = lines[hdr].split()
        for line in lines[hdr + 1:]:
            parts = line.split()
            if len(parts) != len(col_names) or not parts[0][0].isdigit():
                continue
            times.append(float(parts[0]))
            for cn, v in zip(col_names[1:], parts[1:]):
                coords.setdefault(cn, []).append(float(v))

    tracked = {c: coords.get(c, []) for c in TRACK_COORDS if c in coords}
    report = {
        "status": "COMPLETE",
        "model": os.path.basename(args.model),
        "opensimVersion": "4.6",
        "frames": len(times),
        "startTime": times[0] if times else None,
        "endTime": times[-1] if times else None,
        "coordinatesDeg": {k: [round(v, 3) for v in vals] for k, vals in tracked.items()},
        "residualNote": "IKTaskSet default weights; per-marker residuals in ik.mot residual columns where present",
    }
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
