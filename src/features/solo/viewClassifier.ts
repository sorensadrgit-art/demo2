import { LM, type NormalizedLandmark } from '../pose/poseTypes';

/**
 * Approximate camera-plane classification from body geometry.
 * Quality evidence only — not anatomical ground truth.
 */
export type SoloViewClass =
  | 'FRONTAL'
  | 'LEFT_SAGITTAL'
  | 'RIGHT_SAGITTAL'
  | 'OBLIQUE'
  | 'REAR'
  | 'UNKNOWN';

export type ViewQuality = 'VIEW_GOOD' | 'VIEW_MARGINAL' | 'VIEW_INVALID';

export interface ViewClassification {
  view: SoloViewClass;
  quality: ViewQuality;
  /** 0..1 evidence that the classified view is stable. */
  confidence: number;
  shoulderWidthNorm: number;
  torsoHeightNorm: number;
  leftLimbVisibility: number;
  rightLimbVisibility: number;
  /** Approximate out-of-plane yaw proxy in degrees (0 frontal, ~90 sagittal). */
  yawProxyDeg: number;
}

const vis = (lms: NormalizedLandmark[], i: number) => lms[i]?.visibility ?? 0;

function meanVis(lms: NormalizedLandmark[], idx: number[]): number {
  if (!idx.length) return 0;
  return idx.reduce((s, i) => s + vis(lms, i), 0) / idx.length;
}

/**
 * Classify the camera plane from shoulders/hips/limbs.
 * Uses body geometry, not face landmarks as the sole signal.
 */
export function classifySoloView(lms: NormalizedLandmark[]): ViewClassification {
  const ls = lms[LM.leftShoulder];
  const rs = lms[LM.rightShoulder];
  const lh = lms[LM.leftHip];
  const rh = lms[LM.rightHip];
  if (!ls || !rs || !lh || !rh) {
    return {
      view: 'UNKNOWN', quality: 'VIEW_INVALID', confidence: 0,
      shoulderWidthNorm: 0, torsoHeightNorm: 0,
      leftLimbVisibility: 0, rightLimbVisibility: 0, yawProxyDeg: 0,
    };
  }
  const bodyVis = Math.min(ls.visibility, rs.visibility, lh.visibility, rh.visibility);
  if (bodyVis < 0.2) {
    return {
      view: 'UNKNOWN', quality: 'VIEW_INVALID', confidence: 0,
      shoulderWidthNorm: 0, torsoHeightNorm: 0,
      leftLimbVisibility: 0, rightLimbVisibility: 0, yawProxyDeg: 0,
    };
  }

  const midSh = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const midHp = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torsoH = Math.hypot(midSh.x - midHp.x, midSh.y - midHp.y);
  const shW = Math.abs(rs.x - ls.x);
  const shWNorm = torsoH > 1e-6 ? shW / torsoH : 0;
  // Frontal: shoulders nearly as wide as torso is tall. Sagittal: foreshortened.
  const yawProxyDeg = Math.acos(Math.min(1, Math.max(0, Math.min(1, shWNorm / 0.85)))) * (180 / Math.PI);

  const leftLimb = meanVis(lms, [LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftShoulder, LM.leftElbow]);
  const rightLimb = meanVis(lms, [LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightShoulder, LM.rightElbow]);
  const nose = lms[LM.nose];
  const noseVis = nose?.visibility ?? 0;
  // MediaPipe z: smaller (more negative) is closer to camera.
  const midZ = ((ls.z ?? 0) + (rs.z ?? 0)) / 2;
  const noseBehind = nose != null && noseVis > 0.15 && (nose.z ?? 0) > midZ + 0.08;

  let view: SoloViewClass;
  let confidence: number;
  if (shWNorm >= 0.62 && noseBehind) {
    view = 'REAR';
    confidence = Math.min(1, 0.55 + (shWNorm - 0.62));
  } else if (shWNorm >= 0.62) {
    view = 'FRONTAL';
    confidence = Math.min(1, 0.6 + (shWNorm - 0.62));
  } else if (shWNorm <= 0.38) {
    view = leftLimb >= rightLimb + 0.04 ? 'LEFT_SAGITTAL'
      : rightLimb >= leftLimb + 0.04 ? 'RIGHT_SAGITTAL'
        : leftLimb >= rightLimb ? 'LEFT_SAGITTAL' : 'RIGHT_SAGITTAL';
    confidence = Math.min(1, 0.55 + (0.38 - shWNorm));
  } else {
    view = 'OBLIQUE';
    confidence = 0.45;
  }

  return {
    view,
    quality: 'VIEW_GOOD', // matched later against protocol
    confidence,
    shoulderWidthNorm: shWNorm,
    torsoHeightNorm: torsoH,
    leftLimbVisibility: leftLimb,
    rightLimbVisibility: rightLimb,
    yawProxyDeg,
  };
}

export type RequiredView = SoloViewClass | 'SAGITTAL' | 'FRONTAL_OR_REAR';

export function matchRequiredView(
  classified: ViewClassification,
  required: RequiredView,
  allowedDeviation: 'strict' | 'moderate' = 'moderate',
): { quality: ViewQuality; matched: boolean } {
  const v = classified.view;
  if (v === 'UNKNOWN') return { quality: 'VIEW_INVALID', matched: false };

  const exact = required === v
    || (required === 'SAGITTAL' && (v === 'LEFT_SAGITTAL' || v === 'RIGHT_SAGITTAL'))
    || (required === 'FRONTAL_OR_REAR' && (v === 'FRONTAL' || v === 'REAR'));

  if (exact) {
    const quality: ViewQuality = classified.confidence >= 0.6 ? 'VIEW_GOOD' : 'VIEW_MARGINAL';
    return { quality, matched: true };
  }

  const sagittalFamily = (x: SoloViewClass) => x === 'LEFT_SAGITTAL' || x === 'RIGHT_SAGITTAL' || x === 'OBLIQUE';
  const wantsSagittal = required === 'SAGITTAL' || required === 'LEFT_SAGITTAL' || required === 'RIGHT_SAGITTAL';
  if (wantsSagittal && v === 'OBLIQUE' && allowedDeviation === 'moderate') {
    return { quality: 'VIEW_MARGINAL', matched: false };
  }
  if (wantsSagittal && sagittalFamily(v) && required !== 'SAGITTAL' && v !== required) {
    // Opposite sagittal (left vs right) is invalid for a side-specific protocol.
    return { quality: 'VIEW_INVALID', matched: false };
  }
  if (required === 'FRONTAL' && v === 'OBLIQUE' && allowedDeviation === 'moderate') {
    return { quality: 'VIEW_MARGINAL', matched: false };
  }
  return { quality: 'VIEW_INVALID', matched: false };
}
