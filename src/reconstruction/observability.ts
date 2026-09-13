import type { AcquisitionGrade, LandmarkPoint3D } from '../measurement/domain';
import { MIN_VIEWS_FOR_GRADE } from '../measurement/domain';

/**
 * Joint observability matrix (Phase 15). Per-frame structure describing
 * how well each joint is observed: which cameras see it, whether 3D is
 * available, reprojection agreement, and a 0..1 confidence.
 * Precision quality strongly depends on this; Focus capture never shows
 * it — Detailed Analysis may.
 */
export interface JointObservability {
  jointId: string;
  visibleCameraIds: string[];
  validCameraIds: string[];
  viewCount: number;
  triangulationAvailable: boolean;
  reprojectionErrorPx?: number;
  confidence: number;
}

/** Build observability for one joint from its reconstructed 3D landmarks. */
export function observabilityForJoint(
  jointId: string,
  points: Array<LandmarkPoint3D | null>,
  grade: AcquisitionGrade,
): JointObservability {
  const present = points.filter((p): p is LandmarkPoint3D => p !== null);
  const camSet = new Set<string>();
  for (const p of present) for (const c of p.sourceCameraIds) camSet.add(c);
  const validCameraIds = [...camSet];
  const viewCount = validCameraIds.length;
  const required = MIN_VIEWS_FOR_GRADE[grade];
  const triangulationAvailable = present.length > 0 && viewCount >= required;
  const reprojectionErrorPx = present.length
    ? Math.sqrt(present.reduce((a, p) => a + p.reprojectionErrorPx ** 2, 0) / present.length)
    : undefined;
  // Confidence: fraction of required views observed, discounted by error.
  const coverage = Math.min(1, viewCount / required);
  const agreement = reprojectionErrorPx === undefined
    ? 0
    : Math.max(0, 1 - reprojectionErrorPx / 12);
  const meanObs = present.length
    ? present.reduce((a, p) => a + p.observationConfidence, 0) / present.length
    : 0;
  const confidence = present.length === 0
    ? 0
    : Math.min(1, 0.5 * coverage + 0.3 * agreement + 0.2 * meanObs);
  return {
    jointId,
    visibleCameraIds: validCameraIds,
    validCameraIds,
    viewCount,
    triangulationAvailable,
    reprojectionErrorPx,
    confidence,
  };
}

/** Precision gate: ≥3 valid views required for high-confidence 3D. */
export function precisionViewsSatisfied(obs: JointObservability): boolean {
  return obs.viewCount >= MIN_VIEWS_FOR_GRADE.precision;
}

/** Clinical gate: 2 valid views suffice, with explicitly lower certainty. */
export function clinicalViewsSatisfied(obs: JointObservability): boolean {
  return obs.viewCount >= MIN_VIEWS_FOR_GRADE.clinical;
}
