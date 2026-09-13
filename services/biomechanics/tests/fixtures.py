"""Shared synthetic camera fixtures: known intrinsics/extrinsics/3D truth."""
from __future__ import annotations

import math
import numpy as np

FX, FY, CX, CY = 800.0, 800.0, 320.0, 240.0
W, H = 640, 480
DIST = np.zeros(5)


def ring_cameras(n: int = 8, radius: float = 3.0, height: float = 1.4):
    cams = []
    K = np.array([[FX, 0, CX], [0, FY, CY], [0, 0, 1.0]])
    for i in range(n):
        th = 2 * math.pi * i / n
        C = np.array([radius * math.cos(th), height, radius * math.sin(th)])
        z = -C / np.linalg.norm(C)
        up = np.array([0.0, 1.0, 0.0])
        x = np.cross(up, z)
        x /= np.linalg.norm(x)
        y = np.cross(z, x)
        R = np.stack([x, y, z])
        t = -R @ C
        P = K @ np.hstack([R, t.reshape(3, 1)])
        cams.append({"cameraId": f"cam-{i+1:02d}", "K": K, "R": R, "t": t, "P": P, "C": C})
    return cams


def project(P: np.ndarray, X: np.ndarray) -> tuple[float, float]:
    p = P @ np.append(X, 1.0)
    return float(p[0] / p[2]), float(p[1] / p[2])


def knee_chain(flexion_deg: float) -> dict[str, np.ndarray]:
    """Planar leg: hip at origin-ish, thigh 0.45m, shank 0.45m, flexion from straight."""
    hip = np.array([0.0, 0.9, 0.0])
    knee = np.array([0.0, 0.45, 0.0])
    r = math.radians(180.0 - flexion_deg)
    ankle = knee + 0.45 * np.array([math.sin(r), -math.cos(r), 0.0])
    shoulder = np.array([0.0, 1.4, 0.0])
    return {"left-shoulder": shoulder, "left-hip": hip, "left-knee": knee, "left-ankle": ankle}


def interior_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    u, v = a - b, c - b
    d = float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v)))
    return math.degrees(math.acos(max(-1.0, min(1.0, d))))
