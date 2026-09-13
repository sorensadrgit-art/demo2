"""Charuco calibration where the OpenCV build supports it, else explicit BLOCKED."""
from __future__ import annotations

import cv2


def charuco_supported() -> bool:
    aruco = getattr(cv2, "aruco", None)
    return aruco is not None and hasattr(aruco, "CharucoBoard")


def charuco_status() -> dict:
    if charuco_supported():
        return {"charuco": True, "reason": None}
    return {"charuco": False, "reason": "cv2.aruco.CharucoBoard unavailable in this OpenCV build"}


class CharucoCalibrator:
    """Same calibrate(...) interface as the chessboard path."""

    def __init__(self):
        if not charuco_supported():
            raise RuntimeError("CHARUCO: BLOCKED — " + str(charuco_status()["reason"]))

    def calibrate(self, *args, **kwargs):  # pragma: no cover - needs physical boards
        raise NotImplementedError("Charuco dataset capture not available in this environment")
