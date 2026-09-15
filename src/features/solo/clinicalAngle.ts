import type { NormalizedLandmark } from '../pose/poseTypes';

/**
 * Screen-plane joint geometry for Solo.
 * MEASURED: 2D image coordinates and the interior angle they form.
 * ESTIMATED: pose landmarks themselves.
 * NOT DIRECTLY MEASURED: depth, true 3D joint angle, force, kinetics.
 */

export type ClinicalConvention =
  | { id: string; kind: 'interior'; unit: 'deg' }
  | { id: string; kind: 'flexion-from-interior'; interiorAtExtension: number; unit: 'deg' };

export const KNEE_FLEXION_CONVENTION: ClinicalConvention = {
  id: 'knee-flexion-screen-plane',
  kind: 'flexion-from-interior',
  interiorAtExtension: 180,
  unit: 'deg',
};

export const ELBOW_FLEXION_CONVENTION: ClinicalConvention = {
  id: 'elbow-flexion-screen-plane',
  kind: 'flexion-from-interior',
  interiorAtExtension: 180,
  unit: 'deg',
};

export const HIP_FLEXION_CONVENTION: ClinicalConvention = {
  id: 'hip-flexion-screen-plane',
  kind: 'flexion-from-interior',
  interiorAtExtension: 180,
  unit: 'deg',
};

export const SHOULDER_FLEXION_CONVENTION: ClinicalConvention = {
  id: 'shoulder-flexion-screen-plane',
  kind: 'flexion-from-interior',
  interiorAtExtension: 180,
  unit: 'deg',
};

export function conventionDescription(c: ClinicalConvention): string {
  if (c.kind === 'interior') return `${c.id}: clinical = interior(A,B,C) on screen plane`;
  return `${c.id}: clinical = ${c.interiorAtExtension} - interior(A,B,C) on screen plane`;
}

/** Interior angle at B from screen-plane vectors BA and BC. Degenerate → NaN. */
export function screenPlaneInteriorDeg(
  A: { x: number; y: number },
  B: { x: number; y: number },
  C: { x: number; y: number },
): number {
  const bax = A.x - B.x;
  const bay = A.y - B.y;
  const bcx = C.x - B.x;
  const bcy = C.y - B.y;
  const ma = Math.hypot(bax, bay);
  const mc = Math.hypot(bcx, bcy);
  if (ma < 1e-9 || mc < 1e-9) return NaN;
  const dot = (bax * bcx + bay * bcy) / (ma * mc);
  const clamped = Math.min(1, Math.max(-1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

export function toClinicalDegrees(interiorDeg: number, convention: ClinicalConvention): number {
  if (!Number.isFinite(interiorDeg)) return NaN;
  if (convention.kind === 'interior') return interiorDeg;
  return convention.interiorAtExtension - interiorDeg;
}

export interface ScreenPlaneAngle {
  interiorDeg: number;
  clinicalDeg: number;
  valid: boolean;
  visibility: number;
}

export function computeScreenPlaneAngle(
  lms: NormalizedLandmark[],
  proximal: number,
  joint: number,
  distal: number,
  convention: ClinicalConvention,
  minVisibility = 0.25,
): ScreenPlaneAngle {
  const A = lms[proximal];
  const B = lms[joint];
  const C = lms[distal];
  if (!A || !B || !C) {
    return { interiorDeg: NaN, clinicalDeg: NaN, valid: false, visibility: 0 };
  }
  const visibility = Math.min(A.visibility, B.visibility, C.visibility);
  if (visibility < minVisibility) {
    return { interiorDeg: NaN, clinicalDeg: NaN, valid: false, visibility };
  }
  const interiorDeg = screenPlaneInteriorDeg(A, B, C);
  const clinicalDeg = toClinicalDegrees(interiorDeg, convention);
  return {
    interiorDeg,
    clinicalDeg,
    valid: Number.isFinite(clinicalDeg),
    visibility,
  };
}
