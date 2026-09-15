import type { ConfidenceLevel } from '../biomechanics/confidence';
import type { ViewQuality } from './viewClassifier';
import type { SuspensionReason } from './suspension';
import type { FramingAssessment } from './framing';

export type SoloQualityState = 'VALID' | 'MARGINAL' | 'SUSPENDED';

export interface SoloQualityInput {
  viewQuality: ViewQuality;
  framing: FramingAssessment;
  landmarkVisibility: number;
  poseScore: number;
  trackingContinuity: number;
  identityState: string;
  identityAmbiguous: boolean;
  cameraLost: boolean;
  frameRate: number;
  yawProxyDeg: number;
  requiredYawDeg: number;
  rawJitterDeg: number;
}

export interface SoloQualityResult {
  state: SoloQualityState;
  /** Solo never receives 'high' — reserved for multi-view grades. */
  level: Exclude<ConfidenceLevel, 'high'> | 'suspended';
  score: number;
  reasons: string[];
  suspension: SuspensionReason | null;
}

const SOLO_CAP: Exclude<ConfidenceLevel, 'high'> = 'moderate';

export function assessSoloQuality(q: SoloQualityInput): SoloQualityResult {
  const reasons: string[] = [];
  let suspension: SuspensionReason | null = null;

  if (q.cameraLost) {
    return cap({ state: 'SUSPENDED', level: 'suspended', score: 0, reasons: ['CAMERA_LOST'], suspension: 'CAMERA_LOST' });
  }
  if (q.identityAmbiguous || q.identityState === 'unselected') {
    suspension = q.identityState === 'unselected' ? 'NO_SUBJECT_SELECTED' : 'PATIENT_IDENTITY_AMBIGUOUS';
    return cap({ state: 'SUSPENDED', level: 'suspended', score: 0, reasons: [suspension], suspension });
  }
  if (q.identityState === 'lost' || q.identityState === 'reacquiring') {
    return cap({
      state: 'SUSPENDED', level: 'suspended', score: 0.2,
      reasons: ['PATIENT_IDENTITY_AMBIGUOUS'],
      suspension: 'PATIENT_IDENTITY_AMBIGUOUS',
    });
  }
  if (q.viewQuality === 'VIEW_INVALID') {
    return cap({ state: 'SUSPENDED', level: 'suspended', score: 0.25, reasons: ['WRONG_VIEW'], suspension: 'WRONG_VIEW' });
  }
  if (q.framing.reason) {
    return cap({
      state: 'SUSPENDED', level: 'suspended', score: 0.3,
      reasons: [q.framing.reason],
      suspension: q.framing.reason,
    });
  }
  if (q.landmarkVisibility < 0.25) {
    return cap({ state: 'SUSPENDED', level: 'suspended', score: 0.25, reasons: ['LANDMARK_OCCLUDED'], suspension: 'LANDMARK_OCCLUDED' });
  }
  if (q.frameRate > 0 && q.frameRate < 8) {
    return cap({ state: 'SUSPENDED', level: 'suspended', score: 0.3, reasons: ['LOW_FRAME_RATE'], suspension: 'LOW_FRAME_RATE' });
  }
  const outOfPlane = Math.abs(q.yawProxyDeg - q.requiredYawDeg);
  if (outOfPlane > 45) {
    return cap({
      state: 'SUSPENDED', level: 'suspended', score: 0.35,
      reasons: ['EXCESSIVE_OUT_OF_PLANE_MOTION'],
      suspension: 'EXCESSIVE_OUT_OF_PLANE_MOTION',
    });
  }

  if (q.viewQuality === 'VIEW_MARGINAL') reasons.push('VIEW_MARGINAL');
  if (q.trackingContinuity < 0.6) reasons.push('POSE_UNSTABLE');
  if (q.rawJitterDeg > 12) reasons.push('POSE_UNSTABLE');
  if (outOfPlane > 25) reasons.push('EXCESSIVE_OUT_OF_PLANE_MOTION');
  reasons.push('SOLO SINGLE-CAMERA: SPATIAL CERTAINTY BELOW MULTI-VIEW');

  const score = Math.min(0.79, Math.max(0,
    q.landmarkVisibility * 0.35
    + q.poseScore * 0.2
    + (q.viewQuality === 'VIEW_GOOD' ? 0.2 : 0.1)
    + q.trackingContinuity * 0.15
    + 0.1,
  ));

  const marginal = q.viewQuality === 'VIEW_MARGINAL' || q.trackingContinuity < 0.7 || outOfPlane > 25;
  if (marginal) {
    return cap({
      state: 'MARGINAL',
      level: 'low',
      score,
      reasons,
      suspension: null,
    });
  }
  return cap({
    state: 'VALID',
    level: SOLO_CAP,
    score,
    reasons,
    suspension: null,
  });
}

function cap(r: SoloQualityResult): SoloQualityResult {
  if (r.level === 'suspended') return r;
  // Hard cap: Solo cannot occupy the strongest confidence tier.
  if ((r.level as string) === 'high') return { ...r, level: 'moderate', reasons: [...r.reasons, 'SOLO_MONOCULAR_CAP'] };
  return r;
}
