import { describe, expect, it } from 'vitest';
import {
  E2E_REST_POSE, SCENARIO_SCRIPTS, buildKneeFlexionPose, cosineFlex,
} from '../../src/features/pose/SyntheticPoseSource';
import { computeAllJointAngles } from '../../src/features/biomechanics/jointAngles';
import { assessCameraView } from '../../src/features/biomechanics/anatomicalPlanes';
import { assessCalibrationQuality } from '../../src/features/calibration/calibrationEngine';
import { checkFraming } from '../../src/features/calibration/cameraAlignment';
import { evaluateConfidence } from '../../src/features/biomechanics/confidence';

const knee = (flexDeg: number) =>
  computeAllJointAngles(buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg })).leftKnee;

describe('synthetic knee-flexion fixture geometry', () => {
  it('rests straight (interior ~180) and flexes monotonically', () => {
    const rest = knee(0);
    expect(rest.valid).toBe(true);
    expect(rest.angle).toBeGreaterThan(175);
    const mid = knee(60);
    expect(mid.angle).toBeCloseTo(120, 0);
    const peak = knee(112);
    expect(peak.angle).toBeCloseTo(68, 0);
  });

  it('reaches the scripted peak excursions (T1=112 T2=119 T3=116)', () => {
    for (const peak of [112, 119, 116]) {
      expect(180 - knee(peak).angle).toBeCloseTo(peak, 0);
    }
  });

  it('cosine profile starts/ends at rest and peaks mid-move', () => {
    expect(cosineFlex(0, 5000, 112)).toBeCloseTo(0, 6);
    expect(cosineFlex(2500, 5000, 112)).toBeCloseTo(112, 6);
    expect(cosineFlex(5000, 5000, 112)).toBeCloseTo(0, 6);
  });
});

describe('fixture satisfies every positioning/calibration gate', () => {
  const lms = buildKneeFlexionPose(E2E_REST_POSE);
  it('framing has no blockers', () => {
    const blockers = checkFraming(lms, 1, 1).filter((x) => x.severity === 'blocker');
    expect(blockers).toEqual([]);
  });
  it('sagittal suitability >= 0.55 with no TURN guidance', () => {
    const view = assessCameraView(lms, 'sagittal');
    expect(view.suitability).toBeGreaterThanOrEqual(0.55);
    expect(view.guidance ?? '').not.toMatch(/SIDE VIEW/);
  });
  it('calibration quality >= 0.4 with no blockers', () => {
    const cal = assessCalibrationQuality(lms, 0.7);
    expect(cal.fullBodyVisible).toBe(true);
    expect(cal.blockers).toEqual([]);
    expect(cal.score).toBeGreaterThanOrEqual(0.5);
  });
  it('confidence reaches moderate with realistic gate inputs', () => {
    const conf = evaluateConfidence({
      landmarkVisibility: 0.95, poseScore: 0.92, viewSuitability: 0.72,
      calibrationQuality: 0.9, trackingContinuity: 1, frameDropRate: 0, cameraMoving: false,
    });
    expect(conf.suspend).toBe(false);
    expect(['high', 'moderate']).toContain(conf.level);
  });
});

describe('failure fixtures trip the intended gates', () => {
  it('wrong-plane pose is rejected for sagittal protocols', () => {
    const lms = buildKneeFlexionPose({ ...E2E_REST_POSE, shoulderHalfWidth: 0.16 });
    const view = assessCameraView(lms, 'sagittal');
    expect(view.suitability).toBeLessThan(0.55);
    expect(view.guidance).toMatch(/SIDE VIEW/);
  });
  it('missing-knee pose has no measurable knee angle', () => {
    const lms = buildKneeFlexionPose({ ...E2E_REST_POSE, missingKnee: true });
    const r = computeAllJointAngles(lms).leftKnee;
    expect(r.valid).toBe(false);
  });
  it('scenario scripts expose the expected variants', () => {
    expect(SCENARIO_SCRIPTS['knee-flexion-full'].length).toBeGreaterThan(5);
    expect(SCENARIO_SCRIPTS['wrong-plane'].length).toBe(1);
    expect(SCENARIO_SCRIPTS['missing-knee'].length).toBe(1);
    expect(SCENARIO_SCRIPTS['trunk-lean'].length).toBe(
      SCENARIO_SCRIPTS['knee-flexion-full'].length,
    );
  });
});
