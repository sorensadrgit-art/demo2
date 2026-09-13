import { describe, it, expect } from 'vitest';
import type { CalibratedCamera } from '../../src/capture/calibration';
import { triangulateLandmark } from '../../src/reconstruction/triangulation';
import { ringCameras, kneeFlexionSkeleton, projectSkeleton } from '../../src/reconstruction/synthFixture';
import { interiorJointAngle3D, CLINICAL_JOINTS, soloDefMatchesSchema } from '../../src/biomechanics3d/joints';
import type { FrameTimestamp } from '../../src/measurement/domain';

const T: FrameTimestamp = { monotonicMs: 2000, frameIndex: 2 };

function reconAngle(flexDeg: number, nCams = 6): { expected: number; measured: number } {
  const cams = ringCameras(nCams);
  const map = new Map<string, CalibratedCamera>(cams.map((c) => [c.camera.cameraId, c.camera]));
  const skel = kneeFlexionSkeleton(flexDeg);
  const obs = projectSkeleton(skel, cams, T);
  const byId = (id: string) => obs.filter((o) => o.landmarkId === id);
  const H = triangulateLandmark('left-hip', byId('left-hip'), map, T).point!;
  const K = triangulateLandmark('left-knee', byId('left-knee'), map, T).point!;
  const A = triangulateLandmark('left-ankle', byId('left-ankle'), map, T).point!;
  const measured = interiorJointAngle3D(
    { x: H.xM, y: H.yM, z: H.zM },
    { x: K.xM, y: K.yM, z: K.zM },
    { x: A.xM, y: A.yM, z: A.zM },
  );
  return { expected: 180 - flexDeg, measured };
}

/** Known-angle tests (Phase 17): project → triangulate → angle vs truth. */
describe('known-angle reconstruction', () => {
  for (const flex of [0, 30, 45, 60, 90, 120]) {
    it(`knee flexion ${flex}° reconstructs within 1°`, () => {
      const { expected, measured } = reconAngle(flex);
      expect(Math.abs(measured - expected)).toBeLessThan(1.0);
    });
  }

  it('elbow-style triplet reconstructs within 1°', () => {
    // Straight upper-limb chain built analytically (not from the knee
    // fixture, whose shoulder/elbow/wrist are merely near-collinear):
    // shoulder→elbow→wrist on one line must measure 180°.
    const cams = ringCameras(4);
    const map = new Map<string, CalibratedCamera>(cams.map((c) => [c.camera.cameraId, c.camera]));
    const chain = {
      points: {
        'joint-a': { x: 0.12, y: 1.45, z: 0 },
        'joint-b': { x: 0.16, y: 1.15, z: 0 },
        'joint-c': { x: 0.20, y: 0.85, z: 0 },
      },
    };
    const obs = projectSkeleton(chain, cams, T);
    const byId = (id: string) => obs.filter((o) => o.landmarkId === id);
    const A = triangulateLandmark('joint-a', byId('joint-a'), map, T).point!;
    const B = triangulateLandmark('joint-b', byId('joint-b'), map, T).point!;
    const C = triangulateLandmark('joint-c', byId('joint-c'), map, T).point!;
    const measured = interiorJointAngle3D(
      { x: A.xM, y: A.yM, z: A.zM }, { x: B.xM, y: B.yM, z: B.zM }, { x: C.xM, y: C.yM, z: C.zM });
    expect(Math.abs(measured - 180)).toBeLessThan(1.0);
  });

  it('clinical joint definitions carry conventions and match Solo triples', () => {
    const knee = CLINICAL_JOINTS['knee-flexion-l'];
    expect(knee.anatomicalJoint).toBe('tibiofemoral joint');
    expect(knee.movement).toBe('flexion-extension');
    expect(knee.proximalSegment).toBe('femur-l');
    expect(knee.distalSegment).toBe('shank-l');
    expect(knee.convention.length).toBeGreaterThan(20);
    expect(knee.signConvention.length).toBeGreaterThan(10);
    for (const id of ['knee-flexion-l', 'knee-flexion-r', 'elbow-flexion-l', 'hip-flexion-l']) {
      expect(soloDefMatchesSchema(id)).toBe(true);
    }
  });
});
