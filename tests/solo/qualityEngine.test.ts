import { describe, expect, it } from 'vitest';
import {
  assessSoloQuality,
  type SoloQualityInput,
} from '../../src/features/solo/qualityEngine';
import type { FramingAssessment } from '../../src/features/solo/framing';

function cleanFraming(): FramingAssessment {
  return {
    bboxHeight: 0.6,
    segmentLengthPx: 300,
    requiredVisible: true,
    clipped: false,
    tooSmall: false,
    tooClose: false,
    reason: null,
    cue: null,
  };
}

function goodInput(): SoloQualityInput {
  return {
    viewQuality: 'VIEW_GOOD',
    framing: cleanFraming(),
    landmarkVisibility: 0.9,
    poseScore: 0.9,
    trackingContinuity: 0.9,
    identityState: 'locked',
    identityAmbiguous: false,
    cameraLost: false,
    frameRate: 30,
    yawProxyDeg: 90,
    requiredYawDeg: 90,
    rawJitterDeg: 1,
  };
}

describe('assessSoloQuality — happy path', () => {
  it('returns VALID / moderate for a clean, in-plane session', () => {
    const r = assessSoloQuality(goodInput());
    expect(r.state).toBe('VALID');
    expect(r.level).toBe('moderate');
    expect(r.suspension).toBeNull();
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(0.79);
  });

  it('flags MARGINAL for marginal view or weak continuity', () => {
    const r = assessSoloQuality({ ...goodInput(), viewQuality: 'VIEW_MARGINAL' });
    expect(r.state).toBe('MARGINAL');
    expect(r.level).toBe('low');
    expect(r.suspension).toBeNull();
    expect(r.reasons).toContain('VIEW_MARGINAL');
  });

  it('never returns high, even for perfect inputs', () => {
    const perfect = assessSoloQuality({
      ...goodInput(),
      landmarkVisibility: 1,
      poseScore: 1,
      trackingContinuity: 1,
      rawJitterDeg: 0,
    });
    expect(perfect.level).not.toBe('high');
    expect(perfect.level).toBe('moderate');
  });

  it('never returns high across a sweep of input combinations', () => {
    const viewQualities = ['VIEW_GOOD', 'VIEW_MARGINAL', 'VIEW_INVALID'] as const;
    const visibilities = [0, 0.1, 0.3, 0.6, 1];
    const continuities = [0, 0.5, 0.8, 1];
    for (const viewQuality of viewQualities) {
      for (const landmarkVisibility of visibilities) {
        for (const trackingContinuity of continuities) {
          const r = assessSoloQuality({
            ...goodInput(),
            viewQuality,
            landmarkVisibility,
            trackingContinuity,
          });
          expect(r.level).not.toBe('high');
          expect(['low', 'moderate', 'suspended']).toContain(r.level);
        }
      }
    }
  });
});

describe('assessSoloQuality — suspensions', () => {
  it('suspends with CAMERA_LOST when the camera is gone', () => {
    const r = assessSoloQuality({ ...goodInput(), cameraLost: true });
    expect(r.state).toBe('SUSPENDED');
    expect(r.level).toBe('suspended');
    expect(r.suspension).toBe('CAMERA_LOST');
    expect(r.score).toBe(0);
  });

  it('suspends with PATIENT_IDENTITY_AMBIGUOUS when identity is ambiguous', () => {
    const r = assessSoloQuality({ ...goodInput(), identityAmbiguous: true });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('PATIENT_IDENTITY_AMBIGUOUS');
  });

  it('suspends with PATIENT_IDENTITY_AMBIGUOUS when identity is lost or reacquiring', () => {
    for (const identityState of ['lost', 'reacquiring']) {
      const r = assessSoloQuality({ ...goodInput(), identityState });
      expect(r.state).toBe('SUSPENDED');
      expect(r.suspension).toBe('PATIENT_IDENTITY_AMBIGUOUS');
    }
  });

  it('suspends with NO_SUBJECT_SELECTED when identity is unselected', () => {
    const r = assessSoloQuality({ ...goodInput(), identityState: 'unselected' });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('NO_SUBJECT_SELECTED');
  });

  it('suspends with WRONG_VIEW when the view is invalid', () => {
    const r = assessSoloQuality({ ...goodInput(), viewQuality: 'VIEW_INVALID' });
    expect(r.state).toBe('SUSPENDED');
    expect(r.level).toBe('suspended');
    expect(r.suspension).toBe('WRONG_VIEW');
    expect(r.reasons).toContain('WRONG_VIEW');
  });

  it('suspends with LANDMARK_OCCLUDED when visibility is below the floor', () => {
    const r = assessSoloQuality({ ...goodInput(), landmarkVisibility: 0.1 });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('LANDMARK_OCCLUDED');
  });

  it('suspends with the framing reason when framing fails', () => {
    const framing: FramingAssessment = { ...cleanFraming(), reason: 'PATIENT_TOO_SMALL', cue: 'Move closer', tooSmall: true };
    const r = assessSoloQuality({ ...goodInput(), framing });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('PATIENT_TOO_SMALL');
  });

  it('suspends with LOW_FRAME_RATE below 8 fps', () => {
    const r = assessSoloQuality({ ...goodInput(), frameRate: 5 });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('LOW_FRAME_RATE');
  });

  it('suspends with EXCESSIVE_OUT_OF_PLANE_MOTION when yaw deviates over 45°', () => {
    const r = assessSoloQuality({ ...goodInput(), yawProxyDeg: 30, requiredYawDeg: 90 });
    expect(r.state).toBe('SUSPENDED');
    expect(r.suspension).toBe('EXCESSIVE_OUT_OF_PLANE_MOTION');
  });

  it('CAMERA_LOST takes priority over every other reason', () => {
    const r = assessSoloQuality({
      ...goodInput(),
      cameraLost: true,
      identityAmbiguous: true,
      viewQuality: 'VIEW_INVALID',
      landmarkVisibility: 0,
    });
    expect(r.suspension).toBe('CAMERA_LOST');
  });
});
