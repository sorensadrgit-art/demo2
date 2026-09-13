"""RTMW wholebody schema: 133 keypoints -> semantic names + clinical subset.

Ordering (CocoWholeBody, mmpose 1.3.2):
  0-16   body (COCO-17)
  17-22   feet (L big toe, L small toe, L heel, R big toe, R small toe, R heel)
  23-90   face (68)
  91-111  left hand (21)
  112-132  right hand (21)
"""
from __future__ import annotations

COCO_BODY_17 = [
    "nose", "left-eye", "right-eye", "left-ear", "right-ear",
    "left-shoulder", "right-shoulder", "left-elbow", "right-elbow",
    "left-wrist", "right-wrist", "left-hip", "right-hip",
    "left-knee", "right-knee", "left-ankle", "right-ankle",
]

FEET_6 = [
    "left-big-toe", "left-small-toe", "left-heel",
    "right-big-toe", "right-small-toe", "right-heel",
]

FACE_68 = [f"face-{i}" for i in range(68)]
LEFT_HAND_21 = [f"left-hand-{i}" for i in range(21)]
RIGHT_HAND_21 = [f"right-hand-{i}" for i in range(21)]

RTMW_WHOLEBODY_133: list[str] = COCO_BODY_17 + FEET_6 + FACE_68 + LEFT_HAND_21 + RIGHT_HAND_21
assert len(RTMW_WHOLEBODY_133) == 133

SCHEMA_ID = "rtmw-wholebody"
SCHEMA_VERSION = "1.0"

# Clinically relevant subset mapped to KineLab landmark ids used downstream.
CLINICAL_SUBSET: dict[str, int] = {
    "left-shoulder": 5, "right-shoulder": 6,
    "left-elbow": 7, "right-elbow": 8,
    "left-wrist": 9, "right-wrist": 10,
    "left-hip": 11, "right-hip": 12,
    "left-knee": 13, "right-knee": 14,
    "left-ankle": 15, "right-ankle": 16,
    "left-heel": 19, "right-heel": 22,
    "left-foot-index": 17, "right-foot-index": 20,  # big toes as forefoot proxy
}

# Landmark origin classification for the clinical subset.
ORIGIN = {lid: ("observed" if lid in COCO_BODY_17 + FEET_6 else "derived") for lid in CLINICAL_SUBSET}


def map_inference(keypoints, scores, width: int, height: int,
                  min_confidence: float = 0.3) -> dict:
    """Map raw (133,2)+(133,) arrays to KineLab pose result dict."""
    import math

    landmarks = []
    missing = []
    for lid, idx in CLINICAL_SUBSET.items():
        x, y, c = float(keypoints[idx][0]), float(keypoints[idx][1]), float(scores[idx])
        if not (math.isfinite(x) and math.isfinite(y) and math.isfinite(c)) or c < min_confidence:
            missing.append(lid)
            continue
        landmarks.append({"landmarkId": lid, "xPx": x, "yPx": y,
                          "confidence": c, "origin": ORIGIN[lid]})
    return {
        "provider": "rtmw",
        "schemaId": SCHEMA_ID,
        "schemaVersion": SCHEMA_VERSION,
        "imageWidthPx": width,
        "imageHeightPx": height,
        "landmarks": landmarks,
        "missingLandmarks": missing,
        "keypointCount": 133,
    }
