import type { CalibratedCamera } from '../capture/calibration';
import { projectPoint } from '../capture/calibration';
import type { FrameTimestamp, LandmarkObservation2D, LandmarkPoint3D } from '../measurement/domain';

/**
 * Calibrated multi-view triangulation engine (Phases 13-14).
 *
 * Pipeline: confidence filter → valid calibrated cameras → weighted DLT →
 * reprojection → reject large-residual outlier → recompute → 3D point +
 * error. Deterministic, UI-independent, no learned parameters.
 */
export interface TriangulationOptions {
  minConfidence: number;
  /** Residual above this (px) marks the worst view as an outlier. */
  outlierResidualPx: number;
  /** Minimum valid views required to emit a point at all. */
  minViews: number;
  /** Engineering uncertainty scale: mm per px of reprojection error. */
  mmPerPx?: number;
}

export const DEFAULT_TRIANGULATION_OPTIONS: TriangulationOptions = {
  minConfidence: 0.25,
  outlierResidualPx: 12,
  minViews: 2,
  mmPerPx: 1.5,
};

export interface TriangulationResult {
  point: LandmarkPoint3D | null;
  /** Per-camera residuals from the final solve (px). */
  residualsPx: Record<string, number>;
  /** Camera ids rejected as outliers this solve. */
  rejectedCameraIds: string[];
  /** True when too few valid views existed to attempt a solve. */
  insufficientViews: boolean;
}

interface Row4 { r: [number, number, number, number]; }

/** Solve Ax=0 least squares via normal equations on the 3x3 block. */
function solveDLT(rows: Row4[]): { x: number; y: number; z: number } | null {
  // Build M (3x3) and b from rows: [a b c | d] with x homogeneous w=1.
  let m00 = 0, m01 = 0, m02 = 0, m11 = 0, m12 = 0, m22 = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (const { r } of rows) {
    const [a, b, c, d] = r;
    m00 += a * a; m01 += a * b; m02 += a * c;
    m11 += b * b; m12 += b * c; m22 += c * c;
    b0 += -a * d; b1 += -b * d; b2 += -c * d;
  }
  // Gaussian elimination on 3x3 (M symmetric positive semi-definite).
  const A = [[m00, m01, m02, b0], [m01, m11, m12, b1], [m02, m12, m22, b2]];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const div = A[col][col];
    for (let k = col; k < 4; k++) A[col][k] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
    }
  }
  return { x: A[0][3], y: A[1][3], z: A[2][3] };
}

function dltRows(
  P: number[][],
  u: number,
  v: number,
  weight: number,
): Row4[] {
  const w = Math.sqrt(Math.max(0, weight));
  return [
    { r: [w * (u * P[2][0] - P[0][0]), w * (u * P[2][1] - P[0][1]), w * (u * P[2][2] - P[0][2]), w * (u * P[2][3] - P[0][3])] },
    { r: [w * (v * P[2][0] - P[1][0]), w * (v * P[2][1] - P[1][1]), w * (v * P[2][2] - P[1][2]), w * (v * P[2][3] - P[1][3])] },
  ];
}

/**
 * Triangulate one landmark from multi-camera 2D observations.
 * Every returned point carries sourceCameraIds, validViewCount,
 * observationConfidence, and reprojectionErrorPx (Phase 14).
 */
export function triangulateLandmark(
  landmarkId: string,
  observations: LandmarkObservation2D[],
  cameras: Map<string, CalibratedCamera>,
  timestamp: FrameTimestamp,
  opts: TriangulationOptions = DEFAULT_TRIANGULATION_OPTIONS,
): TriangulationResult {
  const usable = observations.filter(
    (o) => o.confidence >= opts.minConfidence && cameras.has(o.cameraId),
  );
  if (usable.length < opts.minViews) {
    return { point: null, residualsPx: {}, rejectedCameraIds: [], insufficientViews: true };
  }

  const solve = (obs: LandmarkObservation2D[]) => {
    const rows: Row4[] = [];
    for (const o of obs) {
      const P = cameras.get(o.cameraId)!.projectionMatrix;
      rows.push(...dltRows(P, o.xPx, o.yPx, Math.max(0.01, o.confidence)));
    }
    return solveDLT(rows);
  };

  let active = usable;
  const rejectedCameraIds: string[] = [];
  let est = solve(active);

  // Single outlier-rejection pass: drop the worst view above threshold.
  if (est) {
    let worstId: string | null = null;
    let worstRes = 0;
    for (const o of active) {
      const P = cameras.get(o.cameraId)!.projectionMatrix;
      const proj = projectPoint(P, est);
      const res = Math.hypot(proj.x - o.xPx, proj.y - o.yPx);
      if (res > worstRes) { worstRes = res; worstId = o.cameraId; }
    }
    if (worstId && worstRes > opts.outlierResidualPx && active.length - 1 >= opts.minViews) {
      rejectedCameraIds.push(worstId);
      active = active.filter((o) => o.cameraId !== worstId);
      est = solve(active);
    }
  }

  if (!est || !Number.isFinite(est.x + est.y + est.z)) {
    return { point: null, residualsPx: {}, rejectedCameraIds, insufficientViews: false };
  }

  const residualsPx: Record<string, number> = {};
  let sumSq = 0;
  let confSum = 0;
  for (const o of active) {
    const P = cameras.get(o.cameraId)!.projectionMatrix;
    const proj = projectPoint(P, est);
    const res = Math.hypot(proj.x - o.xPx, proj.y - o.yPx);
    residualsPx[o.cameraId] = res;
    sumSq += res * res;
    confSum += o.confidence;
  }
  const reprojectionErrorPx = Math.sqrt(sumSq / active.length);
  const observationConfidence = confSum / active.length;
  const mmPerPx = opts.mmPerPx ?? 1.5;

  return {
    point: {
      landmarkId,
      xM: est.x,
      yM: est.y,
      zM: est.z,
      sourceCameraIds: active.map((o) => o.cameraId),
      validViewCount: active.length,
      observationConfidence,
      reprojectionErrorPx,
      uncertaintyMm: reprojectionErrorPx * mmPerPx,
      timestamp,
    },
    residualsPx,
    rejectedCameraIds,
    insufficientViews: false,
  };
}
