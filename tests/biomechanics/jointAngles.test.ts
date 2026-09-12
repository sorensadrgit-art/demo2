import { describe, it, expect } from 'vitest';
import { computeJointAngle, computePlaneAngle, JOINT_DEFS } from '../../src/features/biomechanics/jointAngles';
import { LM, emptyLandmarks } from '../../src/features/pose/poseTypes';
import { v3 } from '../../src/lib/math/vectors';

const placed = (idx: number, x: number, y: number, vis = 0.95) => ({ idx, x, y, vis });

function build(
  pts: Array<{ idx: number; x: number; y: number; vis?: number }>,
  z = 0,
) {
  const lms = emptyLandmarks();
  for (const p of pts) {
    lms[p.idx] = { x: p.x, y: p.y, z, visibility: p.vis ?? 0.95, presence: 0.95 };
  }
  return lms;
}

describe('ROM engine geometric configurations', () => {
  it('straight leg reads ~180° knee', () => {
    const lms = build([
      placed(LM.leftHip, 0.5, 0.3),
      placed(LM.leftKnee, 0.5, 0.55),
      placed(LM.leftAnkle, 0.5, 0.85),
    ]);
    const r = computeJointAngle(lms, 'leftKnee');
    expect(r.valid).toBe(true);
    expect(r.angle).toBeCloseTo(180, 0);
  });

  it('right-angle knee reads ~90°', () => {
    const lms = build([
      placed(LM.leftHip, 0.4, 0.4),
      placed(LM.leftKnee, 0.5, 0.4),
      placed(LM.leftAnkle, 0.5, 0.6),
    ]);
    expect(computeJointAngle(lms, 'leftKnee').angle).toBeCloseTo(90, 0);
  });

  it('deep flexion reads acute interior angle', () => {
    // Vertex at knee; hip up-left, ankle down-right at 45° each → ~90° interior.
    const lms = build([
      placed(LM.leftHip, 0.5 - 0.2, 0.5 - 0.2),
      placed(LM.leftKnee, 0.5, 0.5),
      placed(LM.leftAnkle, 0.5 + 0.2, 0.5 + 0.2),
    ]);
    expect(computeJointAngle(lms, 'leftKnee').angle).toBeCloseTo(180, 0);
    const flexed = build([
      placed(LM.leftHip, 0.5, 0.3),
      placed(LM.leftKnee, 0.5, 0.5),
      placed(LM.leftAnkle, 0.5 + 0.2, 0.5),
    ]);
    const a = computeJointAngle(flexed, 'leftKnee').angle;
    expect(a).toBeCloseTo(90, 0);
  });

  it('folded segment reads ~0°', () => {
    const lms = build([
      placed(LM.leftHip, 0.5, 0.6),
      placed(LM.leftKnee, 0.5, 0.5),
      placed(LM.leftAnkle, 0.5, 0.6),
    ]);
    expect(computeJointAngle(lms, 'leftKnee').angle).toBeCloseTo(0, 0);
  });

  it('low-confidence landmarks suspend measurement', () => {
    const lms = build([
      { idx: LM.leftHip, x: 0.5, y: 0.3, vis: 0.9 },
      { idx: LM.leftKnee, x: 0.5, y: 0.55, vis: 0.1 },
      { idx: LM.leftAnkle, x: 0.5, y: 0.85, vis: 0.9 },
    ]);
    const r = computeJointAngle(lms, 'leftKnee');
    expect(r.valid).toBe(false);
    expect(Number.isNaN(r.angle)).toBe(true);
  });

  it('every joint def computes without throwing', () => {
    const lms = emptyLandmarks().map((_, i) => ({
      x: 0.3 + (i % 7) * 0.05, y: 0.2 + Math.floor(i / 7) * 0.12,
      z: 0, visibility: 0.9, presence: 0.9,
    }));
    for (const id of Object.keys(JOINT_DEFS) as Array<keyof typeof JOINT_DEFS>) {
      expect(() => computeJointAngle(lms, id)).not.toThrow();
      expect(() => computePlaneAngle(lms, id, v3(0, 0, 1))).not.toThrow();
    }
  });
});
