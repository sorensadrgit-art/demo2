import { LM, type NormalizedLandmark } from '../pose/poseTypes';
import type { SuspensionReason } from './suspension';

export interface FramingAssessment {
  bboxHeight: number;
  segmentLengthPx: number;
  requiredVisible: boolean;
  clipped: boolean;
  tooSmall: boolean;
  tooClose: boolean;
  reason: SuspensionReason | null;
  cue: string | null;
}

const REQUIRED_KNEE = {
  left: [LM.leftHip, LM.leftKnee, LM.leftAnkle],
  right: [LM.rightHip, LM.rightKnee, LM.rightAnkle],
} as const;

export function assessFraming(
  lms: NormalizedLandmark[],
  side: 'left' | 'right',
  frameW: number,
  frameH: number,
): FramingAssessment {
  const idx = REQUIRED_KNEE[side];
  const vis = idx.map((i) => lms[i]?.visibility ?? 0);
  const requiredVisible = vis.every((v) => v >= 0.25);
  // Protocol framing uses the required limb, not the full 33-point pose
  // (other landmarks are often invisible in unit fixtures and Solo cares
  // about the measured segment).
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0, nBox = 0;
  for (const i of idx) {
    const p = lms[i];
    if (!p || p.visibility < 0.15) continue;
    nBox += 1;
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const bboxHeight = nBox > 0 && y1 >= y0 ? y1 - y0 : 0;
  const A = lms[idx[0]];
  const C = lms[idx[2]];
  const segmentLengthPx = A && C
    ? Math.hypot((A.x - C.x) * frameW, (A.y - C.y) * frameH)
    : 0;

  const margin = 0.03;
  const clipped = idx.some((i) => {
    const p = lms[i];
    if (!p || p.visibility < 0.2) return true;
    return p.x < margin || p.x > 1 - margin || p.y < margin || p.y > 1 - margin;
  });

  // Thresholds are starting heuristics; physical tests refine them.
  const tooSmall = bboxHeight > 0 && bboxHeight < 0.28;
  const tooClose = bboxHeight >= 0.9 || idx.some((i) => {
    const p = lms[i];
    return p != null && p.visibility >= 0.2 && (p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98);
  });

  let reason: SuspensionReason | null = null;
  let cue: string | null = null;
  if (!requiredVisible) {
    reason = vis.some((v) => v < 0.15) ? 'LANDMARK_OCCLUDED' : 'TARGET_NOT_VISIBLE';
    cue = side === 'left' ? 'Show full left leg' : 'Show full right leg';
  } else if (clipped) {
    reason = 'JOINT_CLIPPED';
    cue = 'Keep ankle visible';
  } else if (tooClose) {
    reason = 'PATIENT_TOO_CLOSE';
    cue = 'Move back';
  } else if (tooSmall) {
    reason = 'PATIENT_TOO_SMALL';
    cue = 'Move closer';
  }

  return { bboxHeight, segmentLengthPx, requiredVisible, clipped, tooSmall, tooClose, reason, cue };
}
