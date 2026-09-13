"""OpenSim runtime boundary: real import/model/IK when available, else honest BLOCKED."""
from __future__ import annotations


def opensim_status() -> dict:
    try:
        import opensim  # noqa: F401

        import opensim as m

        ver = getattr(m, "__version__", "present")
        return {"opensim": True, "version": str(ver), "reason": None}
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

KINELAB_TO_OPENSIM_MARKERS = {
    "left-hip": "LASI?",
    "right-hip": "RASI?",
    "left-knee": "L.Knee.Lat?",
    "right-knee": "R.Knee.Lat?",
    "left-ankle": "L.Ank.Lat?",
    "right-ankle": "R.Ank.Lat?",
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
