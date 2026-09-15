import { LM, type NormalizedLandmark } from '../../src/features/pose/poseTypes';

/** Build a 33-landmark array; every landmark starts invisible at frame centre. */
export function makeLandmarks(fillVisibility = 0): NormalizedLandmark[] {
  return Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: fillVisibility,
    presence: fillVisibility,
  }));
}

export function setLm(
  lms: NormalizedLandmark[],
  index: number,
  x: number,
  y: number,
  visibility = 0.99,
  z = 0,
): void {
  lms[index] = { x, y, z, visibility, presence: visibility };
}

/** Upright frontal pose: shoulders wide relative to torso height. */
export function frontalPose(): NormalizedLandmark[] {
  const lms = makeLandmarks();
  setLm(lms, LM.leftShoulder, 0.3, 0.3);
  setLm(lms, LM.rightShoulder, 0.7, 0.3);
  setLm(lms, LM.leftHip, 0.4, 0.7);
  setLm(lms, LM.rightHip, 0.6, 0.7);
  for (const i of [LM.leftKnee, LM.leftAnkle, LM.leftElbow]) setLm(lms, i, 0.4, 0.85, 0.9);
  for (const i of [LM.rightKnee, LM.rightAnkle, LM.rightElbow]) setLm(lms, i, 0.6, 0.85, 0.9);
  return lms;
}

/** Side-on pose: shoulders stacked (foreshortened). `side` marks the near, well-visible side. */
export function sagittalPose(side: 'left' | 'right'): NormalizedLandmark[] {
  const lms = makeLandmarks();
  setLm(lms, LM.leftShoulder, 0.5, 0.3);
  setLm(lms, LM.rightShoulder, 0.5, 0.3);
  setLm(lms, LM.leftHip, 0.5, 0.7);
  setLm(lms, LM.rightHip, 0.5, 0.7);
  const nearVis = 0.9;
  const farVis = 0.5;
  const leftIdx = [LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftShoulder, LM.leftElbow];
  const rightIdx = [LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightShoulder, LM.rightElbow];
  for (const i of leftIdx) {
    lms[i] = { ...lms[i], visibility: side === 'left' ? nearVis : farVis, presence: side === 'left' ? nearVis : farVis };
  }
  for (const i of rightIdx) {
    lms[i] = { ...lms[i], visibility: side === 'right' ? nearVis : farVis, presence: side === 'right' ? nearVis : farVis };
  }
  return lms;
}
