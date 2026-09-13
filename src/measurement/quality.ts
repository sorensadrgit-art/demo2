import { evaluateConfidence } from '../features/biomechanics/confidence';
import type { AcquisitionGrade, MeasurementConfidence } from '../measurement/domain';
import { MIN_VIEWS_FOR_GRADE } from '../measurement/domain';
import type { JointObservability } from '../reconstruction/observability';
import type { CalibrationQuality } from '../capture/calibration';
import type { SynchronizationQuality } from '../reconstruction/sync';

/**
 * Measurement Quality Engine V2 (Phases 23-24). Evidence-based confidence:
 * wraps the Solo evaluateConfidence suspension semantics (never replaced)
 * with grade, optical-calibration, sync, view-count, reprojection, and
 * tracking evidence. Engineering uncertainty is labeled as such — never
 * as validated clinical accuracy.
 */
export interface QualityInputs {
  grade: AcquisitionGrade;
  observability: JointObservability;
  calibration: CalibrationQuality | null;
  sync: SynchronizationQuality | null;
  poseConfidence: number;
  visibility: number;
  trackingContinuity: number;
  calibrationQuality01: number;
  cameraMoving: boolean;
  temporalResidualM?: number;
}

export interface QualityResult {
  confidence: MeasurementConfidence;
  observability: JointObservability;
  /** Engineering uncertainty estimate (mm) — NOT clinical accuracy. */
  uncertaintyMm?: number;
  suspended: boolean;
}

/** Engineering uncertainty model (documented QA parameters). */
export function engineeringUncertaintyMm(
  reprojectionErrorPx: number | undefined,
  validViews: number,
  grade: AcquisitionGrade,
): number | undefined {
  if (reprojectionErrorPx === undefined) return undefined;
  const mmPerPx = 1.5;
  const viewDiscount = validViews >= 4 ? 0.7 : validViews >= 3 ? 0.85 : 1.0;
  const gradeFactor = grade === 'precision' ? 0.8 : grade === 'clinical' ? 1.0 : 1.6;
  return reprojectionErrorPx * mmPerPx * viewDiscount * gradeFactor;
}

export function assessMeasurementQuality(q: QualityInputs): QualityResult {
  const reasons: string[] = [];
  const required = MIN_VIEWS_FOR_GRADE[q.grade];

  // Legacy Solo evidence (suspension semantics preserved verbatim).
  const solo = evaluateConfidence({
    landmarkVisibility: q.visibility,
    poseScore: q.poseConfidence,
    viewSuitability: 1,
    calibrationQuality: q.calibrationQuality01,
    trackingContinuity: q.trackingContinuity,
    frameDropRate: 0,
    cameraMoving: q.cameraMoving,
  });

  // Multi-view evidence.
  if (q.observability.viewCount < required) {
    reasons.push(`INSUFFICIENT VIEWS ${q.observability.viewCount}/${required} FOR ${q.grade.toUpperCase()}`);
  }
  if (q.calibration && !q.calibration.valid) {
    reasons.push('OPTICAL CALIBRATION INVALID');
  }
  if (q.calibration && q.calibration.warnings.length) {
    reasons.push(...q.calibration.warnings.slice(0, 2));
  }
  if (q.sync && !q.sync.valid) {
    reasons.push('CAMERA SYNC OUT OF TOLERANCE');
  }
  const reproj = q.observability.reprojectionErrorPx;
  if (reproj !== undefined && reproj > 6) {
    reasons.push(`HIGH REPROJECTION ERROR ${reproj.toFixed(1)}px`);
  }
  if (q.temporalResidualM !== undefined && q.temporalResidualM > 0.05) {
    reasons.push(`TEMPORAL RESIDUAL ${(q.temporalResidualM * 1000).toFixed(0)}mm EXCEEDS QA TARGET`);
  }

  const suspend = solo.suspend
    || q.observability.viewCount < required
    || (q.calibration !== null && !q.calibration.valid)
    || (q.sync !== null && !q.sync.valid);

  if (suspend) {
    if (reasons.length === 0) reasons.push(...solo.reasons);
    return {
      confidence: { level: 'suspended', score: solo.score, reasons },
      observability: q.observability,
      uncertaintyMm: undefined,
      suspended: true,
    };
  }

  // Evidence-weighted score: Solo base discounted by view/reprojection gaps.
  const coverage = Math.min(1, q.observability.viewCount / Math.max(required, 4));
  const agreement = reproj === undefined ? 0.8 : Math.max(0, 1 - reproj / 12);
  const score = Math.min(1, solo.score * 0.6 + coverage * 0.25 + agreement * 0.15);
  const level = score >= 0.8 && q.grade !== 'solo' ? 'high'
    : score >= 0.8 && q.grade === 'solo' ? 'moderate'
    : score >= 0.55 ? 'moderate' : 'low';
  if (q.grade === 'solo') reasons.push('SOLO SINGLE-CAMERA: SPATIAL CERTAINTY BELOW MULTI-VIEW');
  reasons.push(...solo.reasons);

  return {
    confidence: { level, score, reasons },
    observability: q.observability,
    uncertaintyMm: engineeringUncertaintyMm(reproj, q.observability.viewCount, q.grade),
    suspended: false,
  };
}
