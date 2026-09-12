import { LM, type NormalizedLandmark } from '../pose/poseTypes';

/** Framing checks that drive the on-screen camera-position guide. */
export interface FramingIssue {
  code: string;
  message: string;
  severity: 'blocker' | 'warning';
}

export function checkFraming(lms: NormalizedLandmark[] | null, width: number, height: number): FramingIssue[] {
  const issues: FramingIssue[] = [];
  if (!lms || width <= 0 || height <= 0) {
    return [{ code: 'no-subject', message: 'NO SUBJECT IN FRAME', severity: 'blocker' }];
  }
  const cx = (lms[LM.leftShoulder].x + lms[LM.rightShoulder].x) / 2;
  if (cx < 0.3 || cx > 0.7) {
    issues.push({ code: 'off-center', message: 'CENTER PATIENT IN FRAME', severity: 'warning' });
  }
  const top = Math.min(lms[LM.nose].y, lms[LM.leftShoulder].y, lms[LM.rightShoulder].y);
  const bottom = Math.max(lms[LM.leftAnkle].y, lms[LM.rightAnkle].y);
  if (top < 0.03) issues.push({ code: 'head-cut', message: 'HEAD OUT OF FRAME — MOVE CAMERA BACK', severity: 'blocker' });
  if (bottom > 0.98) issues.push({ code: 'feet-cut', message: 'FEET OUT OF FRAME — MOVE CAMERA BACK', severity: 'blocker' });
  return issues;
}

export function recommendPlane(movementId: string): { plane: 'sagittal' | 'frontal'; hint: string } {
  const frontal = ['shoulder-abduction', 'single-leg-squat', 'single-leg-balance'];
  if (frontal.includes(movementId)) {
    return { plane: 'frontal', hint: 'Frontal view recommended for this movement.' };
  }
  return { plane: 'sagittal', hint: 'Sagittal (side) view recommended for this movement.' };
}
