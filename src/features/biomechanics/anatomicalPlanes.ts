import { LM, type NormalizedLandmark } from '../pose/poseTypes';
import { norm3, sub3, cross3, v3, type Vec3 } from '../../lib/math/vectors';
import type { CameraPlane } from './jointAngles';

/** Torso segment coordinate system from shoulder/hip landmarks. */
export function torsoFrame(lms: NormalizedLandmark[]): {
  origin: Vec3; superior: Vec3; anterior: Vec3; lateral: Vec3; valid: boolean;
} {
  const mid = (a?: NormalizedLandmark, b?: NormalizedLandmark): Vec3 =>
    a && b ? v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2) : v3();
  const sh = mid(lms[LM.leftShoulder], lms[LM.rightShoulder]);
  const hip = mid(lms[LM.leftHip], lms[LM.rightHip]);
  const conf = Math.min(
    lms[LM.leftShoulder]?.visibility ?? 0, lms[LM.rightShoulder]?.visibility ?? 0,
    lms[LM.leftHip]?.visibility ?? 0, lms[LM.rightHip]?.visibility ?? 0,
  );
  if (conf < 0.3) return { origin: hip, superior: v3(0, -1, 0), anterior: v3(0, 0, -1), lateral: v3(1, 0, 0), valid: false };
  const superior = norm3(sub3(sh, hip));
  const shoulderAxis = norm3(sub3(
    v3(lms[LM.rightShoulder].x, lms[LM.rightShoulder].y, lms[LM.rightShoulder].z),
    v3(lms[LM.leftShoulder].x, lms[LM.leftShoulder].y, lms[LM.leftShoulder].z),
  ));
  const anterior = norm3(cross3(shoulderAxis, superior));
  const lateral = norm3(cross3(superior, anterior));
  return { origin: hip, superior, anterior, lateral, valid: true };
}

export interface ViewAssessment {
  plane: CameraPlane;
  suitability: number;
  guidance: string | null;
  yawDeg: number;
}

/** Estimate subject yaw from shoulder-width foreshortening; score view suitability. */
export function assessCameraView(
  lms: NormalizedLandmark[],
  requested: CameraPlane,
  expectedShoulderWidth = 0.32,
): ViewAssessment {
  const frame = torsoFrame(lms);
  if (!frame.valid) {
    return { plane: requested, suitability: 0, guidance: 'FULL BODY NOT VISIBLE', yawDeg: 0 };
  }
  const shW = Math.abs(lms[LM.rightShoulder].x - lms[LM.leftShoulder].x);
  const foreshorten = Math.min(1, shW / expectedShoulderWidth);
  const yawDeg = Math.acos(Math.min(1, Math.max(0, foreshorten))) * (180 / Math.PI);
  if (requested === 'any') return { plane: requested, suitability: 1, guidance: null, yawDeg };
  const frontalScore = 1 - yawDeg / 90;
  const sagittalScore = yawDeg / 90;
  const suitability = requested === 'frontal' ? frontalScore : sagittalScore;
  let guidance: string | null = null;
  if (suitability < 0.55) {
    guidance = requested === 'sagittal'
      ? 'TURN PATIENT TOWARD SIDE VIEW'
      : "MOVE CAMERA TOWARD PATIENT'S FRONT";
  } else if (suitability < 0.75) {
    const off = Math.round(Math.abs(requested === 'sagittal' ? 90 - yawDeg : yawDeg));
    guidance = requested === 'sagittal'
      ? `MOVE CAMERA 14° TOWARD PATIENT'S LEFT — OFF ~${off}°`
      : `MOVE CAMERA TOWARD CENTER — OFF ~${off}°`;
  }
  return { plane: requested, suitability, guidance, yawDeg };
}
