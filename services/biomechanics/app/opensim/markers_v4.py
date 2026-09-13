"""V4 lower-extremity anatomical marker schema (Phases 15-17, 19-20).

Every entry documents the KineLab landmark, the OpenSim attachment, the
provenance source, and the derivation. Model-side stations are expressed in
meters in the parent body frame and were cross-checked against gait2392 at
neutral (hipC [-0.0707,0.8839,0.0835], kneeC [-0.0752,0.4881,0.0835],
ankleC [-0.0752,0.0581,0.0835]; femur 0.3958 m, tibia 0.4300 m).

Sources: direct (RTMW/triangulation observes it), derived (computed from
observed landmarks by production code, with uncertainty), model (model-side
station definition only - never presented as observation).

Neutral model: raw OpenSim coordinates are absolute; clinical ROM is
raw minus an explicit patient-neutral offset recorded in provenance.
No implicit offset is ever applied (Phase 21).
"""
from __future__ import annotations

SCHEMA_ID = "kinelab-lower-extremity-v4"
SCHEMA_VERSION = "4.0.0"

# marker -> {body, station[m body frame], source, derivation, meaning}
V4_MARKERS: dict[str, dict] = {
    "R.ASIS": {
        "body": "pelvis", "station": [0.08, 0.08, 0.10], "source": "derived",
        "derivation": "hip-proxy + anterior/superior offset; inputs: [right-hip]; "
                      "assumes upright pelvis, uncertainty ~15mm",
        "meaning": "right anterior pelvis constraint",
    },
    "L.ASIS": {
        "body": "pelvis", "station": [0.08, 0.08, -0.10], "source": "derived",
        "derivation": "mirror of R.ASIS; inputs: [left-hip]; uncertainty ~15mm",
        "meaning": "left anterior pelvis constraint",
    },
    "V.Sacral": {
        "body": "pelvis", "station": [-0.08, 0.10, 0.0], "source": "derived",
        "derivation": "midpoint(hips) + posterior/superior offset; inputs: "
                      "[left-hip, right-hip]; uncertainty ~20mm",
        "meaning": "posterior pelvis constraint stabilizing tilt/list",
    },
    "R.Hip": {
        "body": "femur_r", "station": [0.0, 0.0, 0.0], "source": "direct",
        "derivation": "triangulated right-hip (RTMW hip ~ joint center); "
                      "attached at femur origin = model hip center",
        "meaning": "hip joint center",
    },
    "R.Thigh.Front": {
        "body": "femur_r", "station": [0.10, -0.20, 0.0], "source": "derived",
        "derivation": "midpoint(right-hip, right-knee) + anterior offset; inputs: "
                      "[right-hip, right-knee]; uncertainty ~10mm",
        "meaning": "femur segment orientation constraint",
    },
    "R.Knee.Lat": {
        "body": "tibia_r", "station": [0.0, 0.02, 0.09], "source": "direct",
        "derivation": "triangulated right-knee + lateral offset; knee landmark "
                      "approximates joint center",
        "meaning": "knee joint line, lateral side",
    },
    "R.Knee.Med": {
        "body": "tibia_r", "station": [0.0, 0.02, -0.09], "source": "derived",
        "derivation": "mirror of R.Knee.Lat across segment axis; inputs: "
                      "[right-knee]; uncertainty ~12mm",
        "meaning": "knee joint line, medial side; pairs with Lat for axis",
    },
    "R.Shank.Front": {
        "body": "tibia_r", "station": [0.08, -0.20, 0.0], "source": "derived",
        "derivation": "midpoint(right-knee, right-ankle) + anterior offset; inputs: "
                      "[right-knee, right-ankle]; uncertainty ~10mm",
        "meaning": "tibia segment orientation constraint",
    },
    "R.Ankle.Lat": {
        "body": "talus_r", "station": [0.0, -0.02, 0.06], "source": "direct",
        "derivation": "triangulated right-ankle + lateral offset",
        "meaning": "ankle joint, lateral side",
    },
    "R.Ankle.Med": {
        "body": "talus_r", "station": [0.0, -0.02, -0.06], "source": "derived",
        "derivation": "mirror of R.Ankle.Lat; inputs: [right-ankle]; uncertainty ~10mm",
        "meaning": "ankle joint, medial side",
    },
    "R.Heel": {
        "body": "calcn_r", "station": [-0.06, -0.05, 0.0], "source": "direct",
        "derivation": "triangulated right-heel (RTMW foot landmark 19/21)",
        "meaning": "posterior foot constraint",
    },
    "R.Toe.Tip": {
        "body": "toes_r", "station": [0.12, -0.03, 0.0], "source": "direct",
        "derivation": "triangulated right forefoot (RTMW foot landmark 17/20)",
        "meaning": "forefoot constraint for ankle angle",
    },
}

DERIVED_COUNT = sum(1 for m in V4_MARKERS.values() if m["source"] == "derived")
DIRECT_COUNT = sum(1 for m in V4_MARKERS.values() if m["source"] == "direct")


def clinical_rom(raw_deg: float, neutral_deg: float | None) -> dict:
    """Absolute vs ROM discipline (Phase 20): never conflate the two.

    Returns both values separately; ROM requires an explicit neutral.
    """
    if neutral_deg is None:
        return {"absoluteDeg": raw_deg, "romDeg": None,
                "neutralReference": "model-zero (no patient calibration)"}
    return {"absoluteDeg": raw_deg, "romDeg": raw_deg - neutral_deg,
            "neutralReference": "patient-calibrated"}
