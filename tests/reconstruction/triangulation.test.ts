import { describe, it, expect } from 'vitest';
import type { CalibratedCamera } from '../../src/capture/calibration';
import { triangulateLandmark } from '../../src/reconstruction/triangulation';
import { ringCameras, kneeFlexionSkeleton, projectSkeleton } from '../../src/reconstruction/synthFixture';
import type { FrameTimestamp } from '../../src/measurement/domain';

const T: FrameTimestamp = { monotonicMs: 1000, frameIndex: 1 };

function camMap(n: number, corrupt?: Array<'ok' | 'noisy' | 'bad' | 'missing'>) {
  const cams = ringCameras(n);
  if (corrupt) cams.forEach((c, i) => { c.corrupt = corrupt[i] ?? 'ok'; });
  return { cams, map: new Map<string, CalibratedCamera>(cams.map((c) => [c.camera.cameraId, c.camera])) };
}

/** Synthetic geometry validation suite (Phase 16): real triangulation, no mocks. */
describe('triangulation geometry', () => {
  it('exact two-view reconstruction is millimeter-accurate', () => {
    const { cams, map } = camMap(2);
    const skel = kneeFlexionSkeleton(45);
    const obs = projectSkeleton(skel, cams, T);
    const kneeObs = obs.filter((o) => o.landmarkId === 'left-knee');
    const r = triangulateLandmark('left-knee', kneeObs, map, T);
    expect(r.insufficientViews).toBe(false);
    expect(r.point).not.toBeNull();
    const errM = Math.hypot(r.point!.xM - 0.06, r.point!.yM - 0.55, r.point!.zM - 0);
    expect(errM).toBeLessThan(0.002);
    expect(r.point!.validViewCount).toBe(2);
    expect(r.point!.sourceCameraIds).toHaveLength(2);
    expect(r.point!.reprojectionErrorPx).toBeLessThan(0.5);
  });

  it('exact three-view and eight-view reconstructions agree', () => {
    const t3 = camMap(3);
    const t8 = camMap(8);
    const skel = kneeFlexionSkeleton(60);
    const p3 = triangulateLandmark('left-ankle',
      projectSkeleton(skel, t3.cams, T).filter((o) => o.landmarkId === 'left-ankle'), t3.map, T);
    const p8 = triangulateLandmark('left-ankle',
      projectSkeleton(skel, t8.cams, T).filter((o) => o.landmarkId === 'left-ankle'), t8.map, T);
    expect(p3.point && p8.point).toBeTruthy();
    const disagree = Math.hypot(p3.point!.xM - p8.point!.xM, p3.point!.yM - p8.point!.yM, p3.point!.zM - p8.point!.zM);
    expect(disagree).toBeLessThan(0.002);
    expect(p8.point!.validViewCount).toBe(8);
  });

  it('noisy observations degrade gracefully within engineering tolerance', () => {
    const { cams, map } = camMap(4);
    const skel = kneeFlexionSkeleton(90);
    const obs = projectSkeleton(skel, cams, T, { noisePx: 1.5, seed: 42 });
    const r = triangulateLandmark('left-knee', obs.filter((o) => o.landmarkId === 'left-knee'), map, T);
    expect(r.point).not.toBeNull();
    const errMm = Math.hypot(r.point!.xM - 0.06, r.point!.yM - 0.55, r.point!.zM) * 1000;
    expect(errMm).toBeLessThan(15);
    expect(r.point!.reprojectionErrorPx).toBeGreaterThan(0);
  });

  it('one bad camera is rejected; reconstruction stays accurate', () => {
    const { cams, map } = camMap(4, ['ok', 'ok', 'bad', 'ok']);
    const skel = kneeFlexionSkeleton(45);
    const obs = projectSkeleton(skel, cams, T);
    const r = triangulateLandmark('left-knee', obs.filter((o) => o.landmarkId === 'left-knee'), map, T);
    expect(r.point).not.toBeNull();
    expect(r.rejectedCameraIds).toContain('cam-03');
    expect(r.point!.validViewCount).toBe(3);
    const errMm = Math.hypot(r.point!.xM - 0.06, r.point!.yM - 0.55, r.point!.zM) * 1000;
    expect(errMm).toBeLessThan(5);
  });

  it('one missing camera still reconstructs with correct view count', () => {
    const { cams, map } = camMap(3, ['ok', 'missing', 'ok']);
    const skel = kneeFlexionSkeleton(30);
    const obs = projectSkeleton(skel, cams, T);
    const r = triangulateLandmark('left-knee', obs.filter((o) => o.landmarkId === 'left-knee'), map, T);
    expect(r.point).not.toBeNull();
    expect(r.point!.validViewCount).toBe(2);
    expect(r.point!.sourceCameraIds).not.toContain('cam-02');
  });

  it('single view is insufficient; low-confidence observations filtered', () => {
    const { cams, map } = camMap(3, ['ok', 'missing', 'missing']);
    const skel = kneeFlexionSkeleton(30);
    const obs = projectSkeleton(skel, cams, T, { confidence: 0.1 });
    const r = triangulateLandmark('left-knee', obs.filter((o) => o.landmarkId === 'left-knee'), map, T, {
      minConfidence: 0.25, outlierResidualPx: 12, minViews: 2,
    });
    expect(r.point).toBeNull();
    expect(r.insufficientViews).toBe(true);
  });

  it('partial occlusion hides only the occluded landmark', () => {
    const { cams, map } = camMap(4);
    const skel = kneeFlexionSkeleton(45);
    const obs = projectSkeleton(skel, cams, T, { occluded: ['left-knee'] });
    expect(obs.filter((o) => o.landmarkId === 'left-knee')).toHaveLength(0);
    const rKnee = triangulateLandmark('left-knee', [], map, T);
    expect(rKnee.point).toBeNull();
    const rAnkle = triangulateLandmark('left-ankle',
      obs.filter((o) => o.landmarkId === 'left-ankle'), map, T);
    expect(rAnkle.point).not.toBeNull();
  });
});
