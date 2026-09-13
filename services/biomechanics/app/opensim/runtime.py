"""OpenSim runtime boundary: real import/model/IK when available, else honest BLOCKED."""
from __future__ import annotations


def opensim_status() -> dict:
    try:
        import opensim  # noqa: F401

        import opensim as m

        ver = getattr(m, "__version__", "present")
        return {"opensim": True, "version": str(ver), "reason": None,
                "model": "gait2392_thelen2003muscle.osim"}
    except Exception as e:  # noqa: BLE001
        return {
            "opensim": False,
            "version": None,
            "reason": f"OPENSIM: BLOCKED — {type(e).__name__}: {e}",
        }


RECOMMENDED_MODEL = {
    "name": "gait2392",
    "source": "OpenSim example models (simtk.org)",
    "version": "unversioned distribution model",
    "license": "Apache 2.0 (OpenSim models distribution)",
    "dofs": ["hip_flexion_l/r", "knee_angle_l/r", "ankle_angle_l/r"],
}

# Verified against gait2392_thelen2003muscle.osim in opensim 4.6:
# model ships with EMPTY MarkerSet; programmatic markers use subject01-style
# names; coordinates below confirmed present via getCoordinateSet().contains.
KINELAB_TO_OPENSIM_MARKERS = {
    "left-hip": "L.ASIS",
    "right-hip": "R.ASIS",
    "left-knee": "L.Knee.Lat",
    "right-knee": "R.Knee.Lat",
    "left-ankle": "L.Ankle.Lat",
    "right-ankle": "R.Ankle.Lat",
    "knee-flexion-l": {"coordinate": "knee_angle_l"},
    "knee-flexion-r": {"coordinate": "knee_angle_r"},
    "hip-flexion-l": {"coordinate": "hip_flexion_l"},
    "hip-flexion-r": {"coordinate": "hip_flexion_r"},
    "ankle-flexion-l": {"coordinate": "ankle_angle_l"},
    "ankle-flexion-r": {"coordinate": "ankle_angle_r"},
}


class OpenSimRunner:
    BLOCKED = "OPENSIM: BLOCKED — runtime unavailable in this environment"

    def __init__(self):
        st = opensim_status()
        if not st["opensim"]:
            raise RuntimeError(st["reason"])
        self._status = st

    def solve_ik(self, *args, **kwargs):  # pragma: no cover
        raise NotImplementedError("IK requires a loaded model + marker trajectory")
