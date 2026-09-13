import { JOINT_DEFS, type JointId } from '../features/biomechanics/jointAngles';
import { anatomicalToMediapipe33 } from '../measurement/schemas';
import type { SegmentFrame, SegmentId } from './segments';

/**
 * Explicit clinical joint definitions (Phase 22). Every angle carries its
 * anatomical joint, movement, plane, proximal/distal segments, measurement
 * convention, and sign convention — angle(A,B,C) alone is never the full
 * definition. Semantic landmark ids reference the schema layer, with the
 * mediapipe-33 native indices resolved alongside for the Solo path.
 */
export interface ClinicalJointDefinition {
  id: string;
  anatomicalJoint: string;
  movement: 'flexion-extension' | 'abduction-adduction' | 'internal-external-rotation';
  plane: string;
  proximalSegment: SegmentId;
  distalSegment: SegmentId;
  convention: string;
  signConvention: string;
  /** Semantic landmark triple (proximal, vertex, distal). */
  landmarkTriple: [string, string, string];
  /** mediapipe-33 native indices for the Solo direct-2d path. */
  mediapipeTriple: [number, number, number] | null;
  neutralDeg: number;
  soloJointId: JointId | null;
}

function joint(
  id: string,
  anatomicalJoint: string,
  movement: ClinicalJointDefinition['movement'],
  plane: string,
  proximalSegment: SegmentId,
  distalSegment: SegmentId,
  convention: string,
  signConvention: string,
  landmarkTriple: [string, string, string],
  neutralDeg: number,
  soloJointId: JointId | null,
): ClinicalJointDefinition {
  const mi = landmarkTriple.map(anatomicalToMediapipe33);
  return {
    id,
    anatomicalJoint,
    movement,
    plane,
    proximalSegment,
    distalSegment,
    convention,
    signConvention,
    landmarkTriple,
    mediapipeTriple: mi.every((n): n is number => n !== null) ? [mi[0], mi[1], mi[2]] : null,
    neutralDeg,
    soloJointId,
  };
}

export const CLINICAL_JOINTS: Record<string, ClinicalJointDefinition> = {
  'knee-flexion-l': joint(
    'knee-flexion-l', 'tibiofemoral joint', 'flexion-extension', 'sagittal',
    'femur-l', 'shank-l',
    'Interior angle between femoral and tibial long axes, projected onto the sagittal plane; full extension = 180°.',
    'Positive = flexion (heel toward buttock); 0 = straight leg in anatomical extension reference.',
    ['left-hip', 'left-knee', 'left-ankle'], 180, 'leftKnee',
  ),
  'knee-flexion-r': joint(
    'knee-flexion-r', 'tibiofemoral joint', 'flexion-extension', 'sagittal',
    'femur-r', 'shank-r',
    'Interior angle between femoral and tibial long axes, projected onto the sagittal plane; full extension = 180°.',
    'Positive = flexion (heel toward buttock); 0 = straight leg in anatomical extension reference.',
    ['right-hip', 'right-knee', 'right-ankle'], 180, 'rightKnee',
  ),
  'elbow-flexion-l': joint(
    'elbow-flexion-l', 'humeroulnar joint', 'flexion-extension', 'sagittal',
    'humerus-l', 'forearm-l',
    'Interior angle between humeral and forearm long axes; full extension = 180°.',
    'Positive = flexion (hand toward shoulder).',
    ['left-shoulder', 'left-elbow', 'left-wrist'], 180, 'leftElbow',
  ),
  'elbow-flexion-r': joint(
    'elbow-flexion-r', 'humeroulnar joint', 'flexion-extension', 'sagittal',
    'humerus-r', 'forearm-r',
    'Interior angle between humeral and forearm long axes; full extension = 180°.',
    'Positive = flexion (hand toward shoulder).',
    ['right-shoulder', 'right-elbow', 'right-wrist'], 180, 'rightElbow',
  ),
  'shoulder-flexion-l': joint(
    'shoulder-flexion-l', 'glenohumeral joint', 'flexion-extension', 'sagittal',
    'thorax', 'humerus-l',
    'Angle between thorax longitudinal axis and humeral long axis, sagittal projection; arm at side = 0°.',
    'Positive = anterior elevation (flexion); negative = posterior extension.',
    ['left-hip', 'left-shoulder', 'left-elbow'], 0, 'leftShoulderFlex',
  ),
  'hip-flexion-l': joint(
    'hip-flexion-l', 'acetabulofemoral joint', 'flexion-extension', 'sagittal',
    'pelvis', 'femur-l',
    'Interior angle between pelvic longitudinal axis and femoral long axis; anatomical stance = 180°.',
    'Positive = anterior thigh elevation (flexion).',
    ['left-shoulder', 'left-hip', 'left-knee'], 180, 'leftHipFlex',
  ),
  'hip-flexion-r': joint(
    'hip-flexion-r', 'acetabulofemoral joint', 'flexion-extension', 'sagittal',
    'pelvis', 'femur-r',
    'Interior angle between pelvic longitudinal axis and femoral long axis; anatomical stance = 180°.',
    'Positive = anterior thigh elevation (flexion).',
    ['right-shoulder', 'right-hip', 'right-knee'], 180, 'rightHipFlex',
  ),
};

/** 3D joint angle from segment long axes (distal vs proximal y-axes). */
export function segmentJointAngle(proximal: SegmentFrame, distal: SegmentFrame): number {
  if (!proximal.valid || !distal.valid) return NaN;
  const d = Math.min(1, Math.max(-1,
    proximal.yAxis.x * distal.yAxis.x
    + proximal.yAxis.y * distal.yAxis.y
    + proximal.yAxis.z * distal.yAxis.z,
  ));
  return (Math.acos(d) * 180) / Math.PI;
}

/**
 * 3D interior joint angle at a vertex landmark from reconstructed points.
 * For flexion joints this equals 180° − segmentJointAngle; both forms are
 * exported so tests can assert the convention relationship explicitly.
 */
export function interiorJointAngle3D(
  proximal: { x: number; y: number; z: number },
  vertex: { x: number; y: number; z: number },
  distal: { x: number; y: number; z: number },
): number {
  const ax = proximal.x - vertex.x; const ay = proximal.y - vertex.y; const az = proximal.z - vertex.z;
  const bx = distal.x - vertex.x; const by = distal.y - vertex.y; const bz = distal.z - vertex.z;
  const ma = Math.hypot(ax, ay, az); const mb = Math.hypot(bx, by, bz);
  if (ma < 1e-9 || mb < 1e-9) return NaN;
  const d = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (ma * mb)));
  return (Math.acos(d) * 180) / Math.PI;
}

/** Solo triple definitions stay the single source for the 2D path. */
export function soloTripleFor(clinicalId: string): JointId | null {
  return CLINICAL_JOINTS[clinicalId]?.soloJointId ?? null;
}

export function soloDefMatchesSchema(clinicalId: string): boolean {
  const c = CLINICAL_JOINTS[clinicalId];
  if (!c || !c.mediapipeTriple || !c.soloJointId) return false;
  const s = JOINT_DEFS[c.soloJointId].triple;
  return s[0] === c.mediapipeTriple[0] && s[1] === c.mediapipeTriple[1] && s[2] === c.mediapipeTriple[2];
}
