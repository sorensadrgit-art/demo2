import { LM } from '../pose/poseTypes';
import { JOINT_DEFS, type JointId } from '../biomechanics/jointAngles';

/** Vertex landmark index for each measurable joint (click target). */
export function jointVertexIndex(j: JointId): number {
  return JOINT_DEFS[j].triple[1];
}

/** Clickable joint hit-zones in pixel space. */
export function hitTestJoint(
  px: number, py: number,
  lms: Array<{ x: number; y: number; visibility: number }>,
  W: number, H: number,
  radiusPx = 26,
): JointId | null {
  const ids = Object.keys(JOINT_DEFS) as JointId[];
  // Prefer major joints when zones overlap.
  const priority: JointId[] = [
    'leftKnee', 'rightKnee', 'leftElbow', 'rightElbow',
    'leftHipFlex', 'rightHipFlex', 'leftShoulderFlex', 'rightShoulderFlex',
    'leftShoulderAbd', 'rightShoulderAbd', 'leftHipAbd', 'rightHipAbd',
    'trunkFlex', 'trunkLateral', 'leftAnkle', 'rightAnkle', 'leftWrist', 'rightWrist',
  ];
  let best: JointId | null = null;
  let bestD = radiusPx;
  for (const id of priority) {
    const vi = jointVertexIndex(id);
    const l = lms[vi];
    if (!l || l.visibility < 0.2) continue;
    const d = Math.hypot(l.x * W - px, l.y * H - py);
    if (d <= bestD) { bestD = d; best = id; }
  }
  void LM;
  return best;
}
