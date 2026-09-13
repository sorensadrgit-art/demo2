"""V4 OpenSim round-trip + neutral-math regression tests (Phases 14, 19-20, 56).

Round-trip tests need opensim 4.6 (KINELAB_TEST_OPENSIM=1); they generate
markers FROM the model at known coordinates and recover them with real IK.
Acceptance: <1deg absolute error (Phase 22 target for model-derived path).
Neutral/ROM math tests always run (pure python).
"""
from __future__ import annotations

import os
import sys

import pytest

RUNTIME_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "runtime"))
if RUNTIME_DIR not in sys.path:
    sys.path.insert(0, RUNTIME_DIR)

NEED_OPENSIM = os.environ.get("KINELAB_TEST_OPENSIM") == "1"


def test_marker_mapping_semantics():
    from app.opensim.markers_v4 import (  # noqa: PLC0415
        DIRECT_COUNT, DERIVED_COUNT, SCHEMA_VERSION, V4_MARKERS,
    )

    assert SCHEMA_VERSION == "4.0.0"
    assert DIRECT_COUNT >= 5 and DERIVED_COUNT >= 5
    for name, m in V4_MARKERS.items():
        assert set(m) >= {"body", "station", "source", "derivation", "meaning"}, name
        assert m["source"] in {"direct", "derived", "model"}, name
        assert len(m["station"]) == 3, name
        if m["source"] == "direct":
            assert "triangulated" in m["derivation"], name
        else:
            assert "inputs" in m["derivation"] and "uncertainty" in m["derivation"], name
    assert V4_MARKERS["R.Knee.Lat"]["body"] == "tibia_r"
    assert V4_MARKERS["R.Hip"]["station"] == [0.0, 0.0, 0.0]


def test_neutral_reference_math():
    from app.opensim.markers_v4 import clinical_rom  # noqa: PLC0415

    r = clinical_rom(5.0, None)
    assert r["absoluteDeg"] == 5.0 and r["romDeg"] is None
    r = clinical_rom(5.0, 5.0)
    assert r["absoluteDeg"] == 5.0 and r["romDeg"] == 0.0
    assert "patient-calibrated" in r["neutralReference"]


def test_absolute_angle_vs_rom():
    from app.opensim.markers_v4 import clinical_rom  # noqa: PLC0415

    # Same raw coordinate, different neutrals -> different ROM, same absolute.
    a = clinical_rom(92.0, 2.0)
    b = clinical_rom(92.0, 0.0)
    assert a["absoluteDeg"] == b["absoluteDeg"] == 92.0
    assert a["romDeg"] == 90.0 and b["romDeg"] == 92.0


ROUNDTRIP_ANGLES = [0, 30, 60, 90, 120]


def _roundtrip(angle: float, tmp_path) -> float:
    from bias_study import run_ik, STATIONS  # noqa: PLC0415
    import opensim  # noqa: PLC0415
    import math

    model_path = os.path.join(os.path.dirname(__file__), "..", "models",
                              "opensim", "gait2392_thelen2003muscle.osim")
    model = opensim.Model(os.path.abspath(model_path))
    model.initSystem()
    st = model.getWorkingState()
    model.getCoordinateSet().get("knee_angle_r").setValue(st, math.radians(angle))
    model.realizePosition(st)
    bodies = {b: model.getBodySet().get(b) for b in
              ["pelvis", "femur_r", "tibia_r", "talus_r", "calcn_r", "toes_r"]}
    mk = {}
    for name, (bname, off) in STATIONS.items():
        p = bodies[bname].findStationLocationInGround(st, opensim.Vec3(*off))
        mk[name] = [p.get(0), p.get(1), p.get(2)]
    out = str(tmp_path / f"rt_{angle}")
    rep = run_ik(os.path.abspath(model_path),
                 {"rateHz": 60, "frames": [{"t": 0.0, "markers": mk}]}, out, "station")
    got = rep["coordinatesDeg"]["knee_angle_r"]
    assert len(got) == 1
    return got[0]


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
@pytest.mark.parametrize("angle", ROUNDTRIP_ANGLES)
def test_opensim_roundtrip_known_coordinates(angle, tmp_path):
    recovered = _roundtrip(float(angle), tmp_path)
    assert abs(recovered - angle) < 1.0, (angle, recovered)


# Explicit named aliases required by the V4 test plan (Phase 56).
@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_roundtrip_zero(tmp_path):
    assert abs(_roundtrip(0.0, tmp_path)) < 1.0


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_roundtrip_30(tmp_path):
    assert abs(_roundtrip(30.0, tmp_path) - 30.0) < 1.0


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_roundtrip_60(tmp_path):
    assert abs(_roundtrip(60.0, tmp_path) - 60.0) < 1.0


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_roundtrip_90(tmp_path):
    assert abs(_roundtrip(90.0, tmp_path) - 90.0) < 1.0


@pytest.mark.skipif(not NEED_OPENSIM, reason="needs opensim 4.6")
def test_opensim_roundtrip_120(tmp_path):
    assert abs(_roundtrip(120.0, tmp_path) - 120.0) < 1.0
