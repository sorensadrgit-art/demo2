export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'suspended';

export interface ConfidenceInputs {
  landmarkVisibility: number;
  poseScore: number;
  viewSuitability: number;
  calibrationQuality: number;
  trackingContinuity: number;
  frameDropRate: number;
  cameraMoving: boolean;
}

export interface ConfidenceResult {
  score: number;
  level: ConfidenceLevel;
  suspend: boolean;
  reasons: string[];
}

const WEIGHTS = {
  landmarkVisibility: 0.35,
  poseScore: 0.2,
  viewSuitability: 0.2,
  calibrationQuality: 0.1,
  trackingContinuity: 0.1,
  frameDropRate: 0.05,
};

export function evaluateConfidence(i: ConfidenceInputs): ConfidenceResult {
  const reasons: string[] = [];
  if (i.landmarkVisibility < 0.35) reasons.push('LANDMARK OCCLUDED');
  if (i.viewSuitability < 0.5) reasons.push('PLANE OF MOTION INCORRECT');
  if (i.trackingContinuity < 0.6) reasons.push('TRACKING INTERRUPTED');
  if (i.frameDropRate > 0.25) reasons.push('EXCESSIVE FRAME DROPS');
  if (i.cameraMoving) reasons.push('CAMERA MOVING');
  if (i.calibrationQuality < 0.4) reasons.push('CALIBRATION INCOMPLETE');

  const score = Math.min(1, Math.max(0,
    i.landmarkVisibility * WEIGHTS.landmarkVisibility
    + i.poseScore * WEIGHTS.poseScore
    + i.viewSuitability * WEIGHTS.viewSuitability
    + i.calibrationQuality * WEIGHTS.calibrationQuality
    + i.trackingContinuity * WEIGHTS.trackingContinuity
    + (1 - i.frameDropRate) * WEIGHTS.frameDropRate,
  ));

  // Hard suspension — never show false precision.
  const suspend = i.landmarkVisibility < 0.25 || i.trackingContinuity < 0.35 || i.poseScore < 0.2;
  if (suspend && reasons.length === 0) reasons.push('MEASUREMENT SUSPENDED');
  if (suspend) return { score, level: 'suspended', suspend: true, reasons };

  const level: ConfidenceLevel = score >= 0.8 ? 'high' : score >= 0.55 ? 'moderate' : 'low';
  return { score, level, suspend: false, reasons };
}

export const CONFIDENCE_STYLE: Record<ConfidenceLevel, { label: string; color: string }> = {
  high: { label: 'High Confidence', color: '#4ade80' },
  moderate: { label: 'Moderate Confidence', color: '#fbbf24' },
  low: { label: 'Low Confidence', color: '#fb7185' },
  suspended: { label: 'Measurement Suspended', color: '#64748b' },
};

/** Precision gated by confidence: low confidence drops the decimal. */
export function formatAngle(angle: number, level: ConfidenceLevel): string {
  if (!Number.isFinite(angle) || level === 'suspended') return '—';
  if (level === 'low') return `${angle.toFixed(0)}°`;
  return `${angle.toFixed(1)}°`;
}
