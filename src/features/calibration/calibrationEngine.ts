import { LM, type NormalizedLandmark } from '../pose/poseTypes';

export interface CalibrationConfig {
  patientHeightCm: number;
  bodyMassKg?: number;
  affectedSide: 'left' | 'right' | 'bilateral' | 'na';
  movementId: string;
  cameraPlane: 'sagittal' | 'frontal';
  limbLengthCm?: number;
  sensorIds: string[];
}

export interface CalibrationQuality {
  score: number; // 0..1
  blockers: string[];
  fullBodyVisible: boolean;
  lightOk: boolean;
  distanceOk: boolean;
}

export interface CalibrationResult {
  config: CalibrationConfig;
  quality: CalibrationQuality;
  referencePose: NormalizedLandmark[] | null;
  bodyProportions: { torsoToHeight: number; legToHeight: number } | null;
  calibratedAt: number;
}

export function assessCalibrationQuality(
  lms: NormalizedLandmark[] | null,
  lightLevel: number, // 0..1 ambient estimate
): CalibrationQuality {
  const blockers: string[] = [];
  if (!lms) {
    return { score: 0, blockers: ['FULL BODY NOT VISIBLE'], fullBodyVisible: false, lightOk: false, distanceOk: false };
  }
  const key = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];
  const vis = key.map((k) => lms[k]?.visibility ?? 0);
  const fullBodyVisible = vis.every((v) => v > 0.4);
  if (!fullBodyVisible) {
    const names = ['nose', 'L shoulder', 'R shoulder', 'L hip', 'R hip', 'L knee', 'R knee', 'L ankle', 'R ankle'];
    vis.forEach((v, i) => { if (v <= 0.4) blockers.push(`${names[i].toUpperCase()} OCCLUDED`); });
  }
  const ys = key.map((k) => lms[k]?.y ?? 0);
  const span = Math.max(...ys) - Math.min(...ys);
  const distanceOk = span > 0.45 && span < 0.95;
  if (span <= 0.45) blockers.push('PATIENT TOO CLOSE');
  if (span >= 0.95) blockers.push('PATIENT TOO FAR');
  const ankleY = Math.max(lms[LM.leftAnkle]?.y ?? 0, lms[LM.rightAnkle]?.y ?? 0);
  if (ankleY < 0.55) blockers.push('CAMERA TOO LOW');
  const lightOk = lightLevel > 0.25;
  if (!lightOk) blockers.push('INSUFFICIENT LIGHT');
  const score = Math.min(1, Math.max(0,
    (vis.reduce((a, b) => a + b, 0) / vis.length) * 0.6
    + (distanceOk ? 0.2 : 0)
    + (lightOk ? 0.2 : 0),
  ));
  return { score, blockers, fullBodyVisible, lightOk, distanceOk };
}

export function captureReference(
  lms: NormalizedLandmark[],
  config: CalibrationConfig,
  lightLevel: number,
  now: number,
): CalibrationResult {
  const quality = assessCalibrationQuality(lms, lightLevel);
  const heightN = Math.abs((lms[LM.nose]?.y ?? 0) - Math.max(lms[LM.leftAnkle]?.y ?? 0, lms[LM.rightAnkle]?.y ?? 0));
  const torsoN = Math.abs(((lms[LM.leftShoulder]?.y ?? 0) + (lms[LM.rightShoulder]?.y ?? 0)) / 2
    - (((lms[LM.leftHip]?.y ?? 0) + (lms[LM.rightHip]?.y ?? 0)) / 2));
  return {
    config, quality,
    referencePose: quality.score > 0.5 ? lms.map((l) => ({ ...l })) : null,
    bodyProportions: heightN > 0.01
      ? { torsoToHeight: torsoN / heightN, legToHeight: 1 - torsoN / heightN }
      : null,
    calibratedAt: now,
  };
}
