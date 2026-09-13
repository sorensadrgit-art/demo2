import { describe, it, expect } from 'vitest';
import type { CalibratedCamera } from '../../src/capture/calibration';
import { triangulateLandmark, DEFAULT_TRIANGULATION_OPTIONS } from '../../src/reconstruction/triangulation';
import { synchronizeFrames, SOFTWARE_SYNC_TOLERANCE } from '../../src/reconstruction/sync';
import { ringCameras, kneeFlexionSkeleton, projectSkeleton } from '../../src/reconstruction/synthFixture';
import { observabilityForJoint } from '../../src/reconstruction/observability';
import { TemporalFilterBank } from '../../src/reconstruction/filtering';
import { interiorJointAngle3D } from '../../src/biomechanics3d/joints';
import { KineLabSegmentModel } from '../../src/biomechanics3d/modelAdapter';
import { assessMeasurementQuality } from '../../src/measurement/quality';
import { makeMeasurement } from '../../src/measurement/domain';
import { validateCalibration } from '../../src/capture/calibration';
import { pearsonCorrelation, comparisonStats, iccPlaceholder } from '../../src/analysis/comparison';

/**
 * REQUIRED INTEGRATION TEST (Phase 43): 8 virtual cameras, known knee
 * flexion cycle, noise + occlusion + one bad + one missing camera.
 * Full pipeline: 2D → sync → triangulate → filter → joint → quality →
 * measurement → provenance. Real math throughout; asserts tolerance,
 * rejection, view counts, provenance cameras, and suspension on
 * insufficient observability.
 */
describe('multi-camera pipeline integration', () => {
  it('8-camera knee cycle with corruption stays within tolerance', async () => {
    const cams = ringCameras(8);
    cams[5].corrupt = 'bad';
    cams[7].corrupt = 'missing';
    const map = new Map<string, CalibratedCamera>(cams.map((c) => [c.camera.cameraId, c.camera]));
    const model = new KineLabSegmentModel();
    const bank = new TemporalFilterBank();
    const errors: number[] = [];
    const measured: number[] = [];
    const expected: number[] = [];
    let rejectedSeen = false;
    let viewsSeen: number[] = [];

    for (const flex of [0, 20, 40, 60, 80, 100, 80, 60, 40, 20, 0]) {
      const t = { monotonicMs: flex * 100, frameIndex: flex };
      const skel = kneeFlexionSkeleton(flex);
      // Mid-cycle occlusion of the knee chain (frames 5-6).
      const occluded = (flex === 100 || flex === 80) && errors.length >= 5 && errors.length <= 6
        ? ['left-knee'] : [];
      const obs = projectSkeleton(skel, cams, t, { noisePx: 1.0, seed: 11, occluded });
      // Sync gate: all frames share timestamp → valid set.
      const { quality } = synchronizeFrames(t.monotonicMs,
        cams.filter((c) => c.corrupt !== 'missing').map((c) => ({
          cameraId: c.camera.cameraId, frameIndex: flex, sourceTimestampMs: t.monotonicMs,
        })), SOFTWARE_SYNC_TOLERANCE);
      expect(quality.valid).toBe(true);

      const tri = (id: string) => triangulateLandmark(id,
        obs.filter((o) => o.landmarkId === id), map, t, DEFAULT_TRIANGULATION_OPTIONS);
      const H = tri('left-hip'); const K = tri('left-knee'); const A = tri('left-ankle');
      if (K.rejectedCameraIds.length) rejectedSeen = true;
      if (!H.point || !K.point || !A.point) continue; // occluded frames: no measurement
      viewsSeen.push(K.point.validViewCount);
      const fH = bank.update(H.point, 'left-hip')!.filtered;
      const fK = bank.update(K.point, 'left-knee')!.filtered;
      const fA = bank.update(A.point, 'left-ankle')!.filtered;
      const angle = interiorJointAngle3D(
        { x: fH.xM, y: fH.yM, z: fH.zM },
        { x: fK.xM, y: fK.yM, z: fK.zM },
        { x: fA.xM, y: fA.yM, z: fA.zM });
      const obs3 = observabilityForJoint('knee-flexion-l', [H.point, K.point, A.point], 'precision');
      const cal = validateCalibration(1.0, { 'cam-01': 1.0 }, 'cal-int');
      const q = assessMeasurementQuality({
        grade: 'precision', observability: obs3, calibration: cal,
        sync: { maxOffsetMs: 0, meanOffsetMs: 0, valid: true },
        poseConfidence: 0.9, visibility: 0.95, trackingContinuity: 0.95,
        calibrationQuality01: 0.9, cameraMoving: false,
      });
      expect(q.suspended).toBe(false);
      const m = makeMeasurement({
        metric: 'joint-angle', value: angle, unit: 'deg',
        acquisitionGrade: 'precision', source: 'triangulated-3d',
        confidence: q.confidence,
        provenance: {
          providerName: 'synthetic-fixture', protocolId: 'knee-flexion-arom',
          cameraIds: K.point.sourceCameraIds, calibrationId: 'cal-int',
          landmarkModel: 'synthetic', sourceLandmarkIds: ['left-hip', 'left-knee', 'left-ankle'],
          reprojectionErrorPx: K.point.reprojectionErrorPx, validViewCount: K.point.validViewCount,
        },
        timestamp: t,
      });
      expect(m.provenance.cameraIds).not.toContain('cam-06');
      expect(m.provenance.cameraIds).not.toContain('cam-08');
      measured.push(angle);
      expected.push(180 - flex);
      errors.push(Math.abs(angle - (180 - flex)));
    }

    expect(measured.length).toBeGreaterThan(6);
    const maxErr = Math.max(...errors);
    expect(maxErr).toBeLessThan(2.0);
    expect(rejectedSeen).toBe(true);
    expect(viewsSeen.every((v) => v === 6)).toBe(true);
    const r = pearsonCorrelation(expected, measured);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.999);
  });

  it('insufficient observability suspends with no invalid 3D measurement', () => {
    const cams = ringCameras(2);
    cams[0].corrupt = 'missing'; cams[1].corrupt = 'missing';
    const map = new Map<string, CalibratedCamera>(cams.map((c) => [c.camera.cameraId, c.camera]));
    const t = { monotonicMs: 0, frameIndex: 0 };
    const obs = projectSkeleton(kneeFlexionSkeleton(45), cams, t);
    const r = triangulateLandmark('left-knee', obs.filter((o) => o.landmarkId === 'left-knee'), map, t);
    expect(r.point).toBeNull();
    const o = observabilityForJoint('knee-flexion-l', [null], 'precision');
    const q = assessMeasurementQuality({
      grade: 'precision', observability: o, calibration: null, sync: null,
      poseConfidence: 0, visibility: 0, trackingContinuity: 0,
      calibrationQuality01: 0, cameraMoving: false,
    });
    expect(q.suspended).toBe(true);
    expect(q.confidence.level).toBe('suspended');
  });

  it('comparison stats: pearson, Bland-Altman, MDC inputs, ICC placeholder', () => {
    const ref = [110, 115, 120, 118, 112];
    const app = [110.5, 114.6, 120.3, 117.8, 112.2];
    expect(pearsonCorrelation(ref, app)).toBeGreaterThan(0.99);
    expect(pearsonCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
    const s = comparisonStats(ref, app)!;
    expect(s.n).toBe(5);
    expect(s.blandAltman!.loaLow).toBeLessThan(s.blandAltman!.meanDiff);
    expect(s.blandAltman!.loaHigh).toBeGreaterThan(s.blandAltman!.meanDiff);
    expect(s.mdcInputs!.mdc95).toBeGreaterThan(0);
    expect(comparisonStats([1], [1])).toBeNull();
    expect(iccPlaceholder().minTrials).toBe(20);
  });
});
