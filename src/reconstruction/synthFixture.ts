import type { CalibratedCamera, CameraExtrinsics, CameraIntrinsics } from '../capture/calibration';
import { projectionMatrixFrom, projectPoint } from '../capture/calibration';
import type { FrameTimestamp, LandmarkObservation2D } from '../measurement/domain';

/**
 * Synthetic calibrated multi-camera fixture (Phases 16-17, 43).
 * N virtual cameras ring a known 3D skeleton; known points project into
 * each camera with optional noise, occlusion, bad-camera, and missing
 * camera corruption. Feeds the REAL triangulation pipeline — never mocks.
 */

export interface SynthCamera {
  camera: CalibratedCamera;
  /** Corruption mode for negative testing. */
  corrupt?: 'ok' | 'noisy' | 'bad' | 'missing';
}

export interface SynthSkeleton {
  points: Record<string, { x: number; y: number; z: number }>;
}

function lookAtRotation(eye: [number, number, number], target: [number, number, number]): number[][] {
  const fwd = norm3(sub3(target, eye));
  const worldUp: [number, number, number] = [0, 1, 0];
  let right = cross3(fwd, worldUp);
  if (mag3(right) < 1e-6) right = [1, 0, 0];
  right = norm3(right);
  const up = cross3(right, fwd);
  // Camera looks down -Z: rows are right, up, -fwd.
  return [
    [right[0], right[1], right[2]],
    [up[0], up[1], up[2]],
    [-fwd[0], -fwd[1], -fwd[2]],
  ];
}

type V3 = [number, number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const mag3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a: V3): V3 => {
  const m = mag3(a);
  return m < 1e-9 ? [0, 0, 0] : [a[0] / m, a[1] / m, a[2] / m];
};

/** Ring of N calibrated cameras around origin (radius m, height m). */
export function ringCameras(
  n: number,
  opts: { radius?: number; height?: number; width?: number; heightPx?: number; fx?: number } = {},
): SynthCamera[] {
  const radius = opts.radius ?? 3;
  const h = opts.height ?? 1.2;
  const width = opts.width ?? 1280;
  const heightPx = opts.heightPx ?? 720;
  const fx = opts.fx ?? 1000;
  const out: SynthCamera[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const eye: [number, number, number] = [radius * Math.cos(a), h, radius * Math.sin(a)];
    const extrinsics: CameraExtrinsics = { rotation: lookAtRotation(eye, [0, 0.6, 0]), translationM: eye };
    const intrinsics: CameraIntrinsics = {
      fx, fy: fx, cx: width / 2, cy: heightPx / 2,
      distortion: [], width, height: heightPx,
    };
    const cameraId = `cam-${String(i + 1).padStart(2, '0')}`;
    out.push({
      camera: {
        cameraId,
        intrinsics,
        extrinsics,
        projectionMatrix: projectionMatrixFrom(intrinsics, extrinsics),
      },
    });
  }
  return out;
}

/** Standing skeleton with flexing left knee (interior 180° − flexDeg). */
export function kneeFlexionSkeleton(flexDeg: number): SynthSkeleton {
  const phi = (Math.min(125, Math.max(0, flexDeg)) * Math.PI) / 180;
  const hip = { x: 0.06, y: 1.0, z: 0 };
  const knee = { x: 0.06, y: 0.55, z: 0 };
  const L2 = 0.45;
  const ankle = { x: 0.06 - L2 * Math.sin(phi), y: 0.55 - L2 * Math.cos(phi), z: 0 };
  return {
    points: {
      'left-hip': hip,
      'right-hip': { x: -0.06, y: 1.0, z: 0 },
      'left-knee': knee,
      'right-knee': { x: -0.06, y: 0.55, z: 0 },
      'left-ankle': ankle,
      'right-ankle': { x: -0.06, y: 0.1, z: 0 },
      'left-shoulder': { x: 0.12, y: 1.45, z: 0 },
      'right-shoulder': { x: -0.12, y: 1.45, z: 0 },
      'left-elbow': { x: 0.16, y: 1.15, z: 0 },
      'left-wrist': { x: 0.16, y: 0.9, z: 0 },
    },
  };
}

/** Deterministic PRNG (mulberry32) — fixtures are reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ProjectionOpts {
  noisePx?: number;
  seed?: number;
  /** Landmark ids hidden in ALL cameras (occlusion). */
  occluded?: string[];
  /** Per-camera confidence override. */
  confidence?: number;
}

/** Project skeleton into cameras → 2D observations for triangulation. */
export function projectSkeleton(
  skeleton: SynthSkeleton,
  cams: SynthCamera[],
  timestamp: FrameTimestamp,
  opts: ProjectionOpts = {},
): LandmarkObservation2D[] {
  const rand = prng(opts.seed ?? 7);
  const noisePx = opts.noisePx ?? 0;
  const occluded = new Set(opts.occluded ?? []);
  const out: LandmarkObservation2D[] = [];
  for (const sc of cams) {
    if (sc.corrupt === 'missing') continue;
    for (const [landmarkId, p] of Object.entries(skeleton.points)) {
      if (occluded.has(landmarkId)) continue;
      const proj = projectPoint(sc.camera.projectionMatrix, p);
      let { x, y } = proj;
      let confidence = opts.confidence ?? 0.95;
      if (sc.corrupt === 'noisy' || noisePx > 0) {
        // Box-Muller-ish: sum of uniforms approximates Gaussian.
        const g = () => (rand() + rand() + rand() - 1.5) * 2;
        const sigma = sc.corrupt === 'noisy' ? 2.5 : noisePx;
        x += g() * sigma;
        y += g() * sigma;
        if (sc.corrupt === 'noisy') confidence = 0.5;
      }
      if (sc.corrupt === 'bad') {
        // Gross outlier: 60px offset with HIGH confidence (tests rejection,
        // not the confidence gate).
        x += 60; y -= 40;
        confidence = 0.9;
      }
      out.push({
        cameraId: sc.camera.cameraId,
        landmarkId,
        xPx: x,
        yPx: y,
        confidence,
        visibility: confidence,
        timestamp,
      });
    }
  }
  return out;
}
