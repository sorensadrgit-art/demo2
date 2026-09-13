/**
 * Optical camera calibration core (Phases 6-8).
 *
 * Distinct from features/calibration/calibrationEngine.ts, which assesses
 * PATIENT SETUP quality (framing/light/distance). This module owns CAMERA
 * OPTICS: intrinsics, extrinsics, projection matrices, and calibration
 * quality. Numerical fitting (chessboard/Charuco via OpenCV) belongs in a
 * backend service (services/calibration, BLOCKED — no backend runtime in
 * this environment); this module owns the data model, projection math,
 * validation thresholds, and version history.
 */

/** Pinhole intrinsics + distortion (Brown model coefficients k1,k2,p1,p2,k3). */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  distortion: number[];
  width: number;
  height: number;
}

export interface CameraExtrinsics {
  /** 3x3 rotation, camera-from-world. */
  rotation: number[][];
  /** Camera center offset in world meters. */
  translationM: [number, number, number];
}

export interface CalibratedCamera {
  cameraId: string;
  intrinsics: CameraIntrinsics;
  extrinsics: CameraExtrinsics;
  /** 3x4 projection matrix P = K [R | -R·C]. */
  projectionMatrix: number[][];
}

export interface CalibrationQuality {
  calibrationId: string;
  reprojectionRmsePx: number;
  perCameraRmsePx: Record<string, number>;
  timestamp: string;
  valid: boolean;
  warnings: string[];
}

export interface CalibrationRecord {
  id: string;
  cameras: CalibratedCamera[];
  quality: CalibrationQuality;
  /** Geometry fingerprint: invalidated when any camera moves. */
  geometryHash: string;
  previousId?: string;
  createdAt: string;
}

/**
 * Engineering QA thresholds (NOT medically validated). Configurable;
 * documented as engineering parameters, never as clinical accuracy.
 */
export interface CalibrationThresholds {
  maxRmsePx: number;
  maxPerCameraRmsePx: number;
  warnRmsePx: number;
}

export const DEFAULT_CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  maxRmsePx: 3.0,
  maxPerCameraRmsePx: 4.0,
  warnRmsePx: 1.5,
};

/** P = K [R | t] with t = -R·C. Pure matrix math, no dependencies. */
export function projectionMatrixFrom(
  k: CameraIntrinsics,
  e: CameraExtrinsics,
): number[][] {
  const K = [
    [k.fx, 0, k.cx],
    [0, k.fy, k.cy],
    [0, 0, 1],
  ];
  const R = e.rotation;
  const C = e.translationM;
  const t: number[] = [
    -(R[0][0] * C[0] + R[0][1] * C[1] + R[0][2] * C[2]),
    -(R[1][0] * C[0] + R[1][1] * C[1] + R[1][2] * C[2]),
    -(R[2][0] * C[0] + R[2][1] * C[1] + R[2][2] * C[2]),
  ];
  const Rt = [R[0].concat(t[0]), R[1].concat(t[1]), R[2].concat(t[2])];
  return K.map((row) => [
    row[0] * Rt[0][0] + row[1] * Rt[1][0] + row[2] * Rt[2][0],
    row[0] * Rt[0][1] + row[1] * Rt[1][1] + row[2] * Rt[2][1],
    row[0] * Rt[0][2] + row[1] * Rt[1][2] + row[2] * Rt[2][2],
    row[0] * Rt[0][3] + row[1] * Rt[1][3] + row[2] * Rt[2][3],
  ]);
}

/** Project a world point (meters) to pixel space via P. */
export function projectPoint(P: number[][], p: { x: number; y: number; z: number }): { x: number; y: number } {
  const X = [p.x, p.y, p.z, 1];
  const u = P[0][0] * X[0] + P[0][1] * X[1] + P[0][2] * X[2] + P[0][3] * X[3];
  const v = P[1][0] * X[0] + P[1][1] * X[1] + P[1][2] * X[2] + P[1][3] * X[3];
  const w = P[2][0] * X[0] + P[2][1] * X[1] + P[2][2] * X[2] + P[2][3] * X[3];
  return { x: u / w, y: v / w };
}

export function reprojectionErrorPx(
  P: number[][],
  world: { x: number; y: number; z: number },
  observed: { x: number; y: number },
): number {
  const proj = projectPoint(P, world);
  return Math.hypot(proj.x - observed.x, proj.y - observed.y);
}

export function rmse(values: number[]): number {
  if (!values.length) return NaN;
  return Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length);
}

/** Validate a calibration record against engineering thresholds. */
export function validateCalibration(
  reprojectionRmsePx: number,
  perCameraRmsePx: Record<string, number>,
  calibrationId: string,
  thresholds: CalibrationThresholds = DEFAULT_CALIBRATION_THRESHOLDS,
): CalibrationQuality {
  const warnings: string[] = [];
  if (reprojectionRmsePx >= thresholds.warnRmsePx) {
    warnings.push(`REPROJECTION RMSE ${reprojectionRmsePx.toFixed(2)}px EXCEEDS ENGINEERING QA TARGET ${thresholds.warnRmsePx}px`);
  }
  for (const [cam, e] of Object.entries(perCameraRmsePx)) {
    if (e > thresholds.maxPerCameraRmsePx) {
      warnings.push(`CAMERA ${cam} RMSE ${e.toFixed(2)}px EXCEEDS LIMIT`);
    }
  }
  const valid = reprojectionRmsePx <= thresholds.maxRmsePx
    && Object.values(perCameraRmsePx).every((e) => e <= thresholds.maxPerCameraRmsePx);
  return {
    calibrationId,
    reprojectionRmsePx,
    perCameraRmsePx,
    timestamp: new Date().toISOString(),
    valid,
    warnings,
  };
}

/**
 * Geometry fingerprint: any camera move/replacement changes the hash and
 * invalidates the calibration. Callers compare stored vs current hash.
 */
export function geometryFingerprint(cameras: Array<{ cameraId: string; width: number; height: number; positionKey: string }>): string {
  return cameras.map((c) => `${c.cameraId}:${c.width}x${c.height}@${c.positionKey}`).join('|');
}

export function isCalibrationCurrent(record: CalibrationRecord, currentHash: string): boolean {
  return record.quality.valid && record.geometryHash === currentHash;
}
