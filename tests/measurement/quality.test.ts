import { describe, it, expect } from 'vitest';
import { assessMeasurementQuality } from '../../src/measurement/quality';
import { observabilityForJoint } from '../../src/reconstruction/observability';
import { validateCalibration } from '../../src/capture/calibration';
import type { LandmarkPoint3D } from '../../src/measurement/domain';

const pt = (id: string, cams: string[], err = 1.2): LandmarkPoint3D => ({
  landmarkId: id, xM: 0, yM: 0, zM: 0,
  sourceCameraIds: cams, validViewCount: cams.length,
  observationConfidence: 0.92, reprojectionErrorPx: err,
  timestamp: { monotonicMs: 0, frameIndex: 0 },
});

const base = {
  poseConfidence: 0.9,
  visibility: 0.95,
  trackingContinuity: 0.95,
  calibrationQuality01: 0.9,
  cameraMoving: false,
};

/** Quality V2: evidence-based confidence, suspension on weak evidence. */
describe('measurement quality V2', () => {
  it('precision with 4 good views is high; solo same evidence is moderate', () => {
    const obs = observabilityForJoint('knee-flexion-l',
      [pt('left-hip', ['c1', 'c2', 'c3', 'c4']), pt('left-knee', ['c1', 'c2', 'c3', 'c4']), pt('left-ankle', ['c1', 'c2', 'c3', 'c4'])],
      'precision');
    const cal = validateCalibration(0.9, { c1: 0.8, c2: 0.9 }, 'cal-1');
    const prec = assessMeasurementQuality({
      ...base, grade: 'precision', observability: obs, calibration: cal,
      sync: { maxOffsetMs: 1, meanOffsetMs: 0.5, valid: true },
    });
    expect(prec.suspended).toBe(false);
    expect(prec.confidence.level).toBe('high');
    const soloObs = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-solo'])], 'solo');
    const solo = assessMeasurementQuality({ ...base, grade: 'solo', observability: soloObs, calibration: null, sync: null });
    expect(solo.suspended).toBe(false);
    expect(solo.confidence.level).not.toBe('high');
    expect(solo.confidence.reasons.join(' ')).toMatch(/SOLO/);
  });

  it('insufficient views suspend 3D measurement', () => {
    const obs = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['c1', 'c2'])], 'precision');
    const r = assessMeasurementQuality({ ...base, grade: 'precision', observability: obs, calibration: null, sync: null });
    expect(r.suspended).toBe(true);
    expect(r.confidence.level).toBe('suspended');
    expect(r.confidence.reasons.join(' ')).toMatch(/INSUFFICIENT VIEWS/);
  });

  it('bad calibration suspends; high reprojection error lowers confidence', () => {
    const obs = observabilityForJoint('knee-flexion-l',
      [pt('left-knee', ['c1', 'c2', 'c3'], 1.0)], 'precision');
    const badCal = validateCalibration(6.0, { c1: 6.5 }, 'cal-bad');
    expect(badCal.valid).toBe(false);
    const suspended = assessMeasurementQuality({ ...base, grade: 'precision', observability: obs, calibration: badCal, sync: null });
    expect(suspended.suspended).toBe(true);
    const errObs = observabilityForJoint('knee-flexion-l',
      [pt('left-knee', ['c1', 'c2', 'c3'], 9.0)], 'clinical');
    const lowered = assessMeasurementQuality({ ...base, grade: 'clinical', observability: errObs, calibration: null, sync: null });
    expect(lowered.suspended).toBe(false);
    expect(lowered.confidence.level).not.toBe('high');
  });

  it('invalid sync suspends; every measurement carries provenance-ready evidence', () => {
    const obs = observabilityForJoint('knee-flexion-l',
      [pt('left-knee', ['c1', 'c2', 'c3'])], 'clinical');
    const r = assessMeasurementQuality({
      ...base, grade: 'clinical', observability: obs, calibration: null,
      sync: { maxOffsetMs: 40, meanOffsetMs: 30, valid: false },
    });
    expect(r.suspended).toBe(true);
    expect(r.confidence.reasons.join(' ')).toMatch(/SYNC/);
  });
});
