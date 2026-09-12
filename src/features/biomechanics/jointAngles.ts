import { LM, type NormalizedLandmark } from '../pose/poseTypes';
import { interiorAngle, projectToPlane, norm3, v3, type Vec3 } from '../../lib/math/vectors';

export type JointId =
  | 'leftShoulderFlex' | 'rightShoulderFlex'
  | 'leftShoulderAbd' | 'rightShoulderAbd'
  | 'leftElbow' | 'rightElbow'
  | 'leftWrist' | 'rightWrist'
  | 'trunkFlex' | 'trunkLateral'
  | 'leftHipFlex' | 'rightHipFlex'
  | 'leftHipAbd' | 'rightHipAbd'
  | 'leftKnee' | 'rightKnee'
  | 'leftAnkle' | 'rightAnkle';

export type CameraPlane = 'sagittal' | 'frontal' | 'transverse' | 'any';

export interface JointDef {
  id: JointId;
  label: string;
  triple: [number, number, number];
  plane: Exclude<CameraPlane, 'any'>;
  neutral: number;
  mirrorOf?: JointId;
}

const L = LM;
export const JOINT_DEFS: Record<JointId, JointDef> = {
  leftShoulderFlex: { id: 'leftShoulderFlex', label: 'L Shoulder Flex/Ext', triple: [L.leftHip, L.leftShoulder, L.leftElbow], plane: 'sagittal', neutral: 0, mirrorOf: 'rightShoulderFlex' },
  rightShoulderFlex: { id: 'rightShoulderFlex', label: 'R Shoulder Flex/Ext', triple: [L.rightHip, L.rightShoulder, L.rightElbow], plane: 'sagittal', neutral: 0, mirrorOf: 'leftShoulderFlex' },
  leftShoulderAbd: { id: 'leftShoulderAbd', label: 'L Shoulder Abd/Add', triple: [L.rightShoulder, L.leftShoulder, L.leftElbow], plane: 'frontal', neutral: 0, mirrorOf: 'rightShoulderAbd' },
  rightShoulderAbd: { id: 'rightShoulderAbd', label: 'R Shoulder Abd/Add', triple: [L.leftShoulder, L.rightShoulder, L.rightElbow], plane: 'frontal', neutral: 0, mirrorOf: 'leftShoulderAbd' },
  leftElbow: { id: 'leftElbow', label: 'L Elbow Flex/Ext', triple: [L.leftShoulder, L.leftElbow, L.leftWrist], plane: 'sagittal', neutral: 180, mirrorOf: 'rightElbow' },
  rightElbow: { id: 'rightElbow', label: 'R Elbow Flex/Ext', triple: [L.rightShoulder, L.rightElbow, L.rightWrist], plane: 'sagittal', neutral: 180, mirrorOf: 'leftElbow' },
  leftWrist: { id: 'leftWrist', label: 'L Wrist (approx)', triple: [L.leftElbow, L.leftWrist, L.leftIndex], plane: 'sagittal', neutral: 180, mirrorOf: 'rightWrist' },
  rightWrist: { id: 'rightWrist', label: 'R Wrist (approx)', triple: [L.rightElbow, L.rightWrist, L.rightIndex], plane: 'sagittal', neutral: 180, mirrorOf: 'leftWrist' },
  trunkFlex: { id: 'trunkFlex', label: 'Trunk Flex/Ext', triple: [L.leftHip, L.leftShoulder, L.nose], plane: 'sagittal', neutral: 180 },
  trunkLateral: { id: 'trunkLateral', label: 'Trunk Lateral Flex', triple: [L.leftHip, L.nose, L.rightHip], plane: 'frontal', neutral: 180 },
  leftHipFlex: { id: 'leftHipFlex', label: 'L Hip Flex/Ext', triple: [L.leftShoulder, L.leftHip, L.leftKnee], plane: 'sagittal', neutral: 180, mirrorOf: 'rightHipFlex' },
  rightHipFlex: { id: 'rightHipFlex', label: 'R Hip Flex/Ext', triple: [L.rightShoulder, L.rightHip, L.rightKnee], plane: 'sagittal', neutral: 180, mirrorOf: 'leftHipFlex' },
  leftHipAbd: { id: 'leftHipAbd', label: 'L Hip Abd/Add', triple: [L.rightHip, L.leftHip, L.leftKnee], plane: 'frontal', neutral: 180, mirrorOf: 'rightHipAbd' },
  rightHipAbd: { id: 'rightHipAbd', label: 'R Hip Abd/Add', triple: [L.leftHip, L.rightHip, L.rightKnee], plane: 'frontal', neutral: 180, mirrorOf: 'leftHipAbd' },
  leftKnee: { id: 'leftKnee', label: 'L Knee Flex/Ext', triple: [L.leftHip, L.leftKnee, L.leftAnkle], plane: 'sagittal', neutral: 180, mirrorOf: 'rightKnee' },
  rightKnee: { id: 'rightKnee', label: 'R Knee Flex/Ext', triple: [L.rightHip, L.rightKnee, L.rightAnkle], plane: 'sagittal', neutral: 180, mirrorOf: 'leftKnee' },
  leftAnkle: { id: 'leftAnkle', label: 'L Ankle (approx)', triple: [L.leftKnee, L.leftAnkle, L.leftFootIndex], plane: 'sagittal', neutral: 90, mirrorOf: 'rightAnkle' },
  rightAnkle: { id: 'rightAnkle', label: 'R Ankle (approx)', triple: [L.rightKnee, L.rightAnkle, L.rightFootIndex], plane: 'sagittal', neutral: 90, mirrorOf: 'leftAnkle' },
};

const toVec3 = (l: NormalizedLandmark): Vec3 => v3(l.x, l.y, l.z);

export interface JointAngleResult {
  joint: JointId;
  angle: number;
  confidence: number;
  valid: boolean;
}

export function computeJointAngle(lms: NormalizedLandmark[], joint: JointId): JointAngleResult {
  const def = JOINT_DEFS[joint];
  const [ia, ib, ic] = def.triple;
  const a = lms[ia]; const b = lms[ib]; const c = lms[ic];
  if (!a || !b || !c) return { joint, angle: NaN, confidence: 0, valid: false };
  const conf = Math.min(a.visibility, b.visibility, c.visibility);
  if (conf < 0.2) return { joint, angle: NaN, confidence: conf, valid: false };
  const angle = interiorAngle(toVec3(a), toVec3(b), toVec3(c));
  return { joint, angle, confidence: conf, valid: Number.isFinite(angle) };
}

export function computeAllJointAngles(lms: NormalizedLandmark[]): Record<JointId, JointAngleResult> {
  const out = {} as Record<JointId, JointAngleResult>;
  for (const id of Object.keys(JOINT_DEFS) as JointId[]) out[id] = computeJointAngle(lms, id);
  return out;
}

/** Plane-aware angle: projects both segments onto the measurement plane first. */
export function computePlaneAngle(
  lms: NormalizedLandmark[], joint: JointId, planeNormal: Vec3,
): JointAngleResult {
  const def = JOINT_DEFS[joint];
  const [ia, ib, ic] = def.triple;
  const a = lms[ia]; const b = lms[ib]; const c = lms[ic];
  if (!a || !b || !c) return { joint, angle: NaN, confidence: 0, valid: false };
  const conf = Math.min(a.visibility, b.visibility, c.visibility);
  if (conf < 0.2) return { joint, angle: NaN, confidence: conf, valid: false };
  const n = norm3(planeNormal);
  const ba = projectToPlane(v3(a.x - b.x, a.y - b.y, a.z - b.z), n);
  const bc = projectToPlane(v3(c.x - b.x, c.y - b.y, c.z - b.z), n);
  const mba = Math.hypot(ba.x, ba.y, ba.z);
  const mbc = Math.hypot(bc.x, bc.y, bc.z);
  if (mba < 1e-9 || mbc < 1e-9) return { joint, angle: NaN, confidence: conf, valid: false };
  const dot = (ba.x * bc.x + ba.y * bc.y + ba.z * bc.z) / (mba * mbc);
  const angle = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
  return { joint, angle, confidence: conf, valid: Number.isFinite(angle) };
}
