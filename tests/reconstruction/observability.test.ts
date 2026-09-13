import { describe, it, expect } from 'vitest';
import { observabilityForJoint, precisionViewsSatisfied, clinicalViewsSatisfied } from '../../src/reconstruction/observability';
import type { LandmarkPoint3D } from '../../src/measurement/domain';

const pt = (id: string, cams: string[], err = 1.5): LandmarkPoint3D => ({
  landmarkId: id,
  xM: 0, yM: 0, zM: 0,
  sourceCameraIds: cams,
  validViewCount: cams.length,
  observationConfidence: 0.9,
  reprojectionErrorPx: err,
  timestamp: { monotonicMs: 0, frameIndex: 0 },
});

/** Observability: view counts gate Precision vs Clinical differently. */
describe('joint observability', () => {
  it('counts valid views across joint landmarks', () => {
    const o = observabilityForJoint('knee-flexion-l',
      [pt('left-hip', ['cam-01', 'cam-02']), pt('left-knee', ['cam-01', 'cam-02', 'cam-03']), pt('left-ankle', ['cam-01'])],
      'precision');
    expect(o.viewCount).toBe(3);
    expect(o.triangulationAvailable).toBe(true);
    expect(o.confidence).toBeGreaterThan(0);
  });

  it('precision requires 3 views; clinical accepts 2 with lower certainty', () => {
    const two = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-01', 'cam-02'])], 'precision');
    expect(two.triangulationAvailable).toBe(false);
    expect(precisionViewsSatisfied(two)).toBe(false);
    expect(clinicalViewsSatisfied(two)).toBe(true);
    const twoClinical = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-01', 'cam-02'])], 'clinical');
    expect(twoClinical.triangulationAvailable).toBe(true);
    const three = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-01', 'cam-02', 'cam-03'])], 'precision');
    expect(three.triangulationAvailable).toBe(true);
    expect(precisionViewsSatisfied(three)).toBe(true);
  });

  it('missing landmarks yield zero confidence, never NaN', () => {
    const o = observabilityForJoint('knee-flexion-l', [null, null, null], 'clinical');
    expect(o.viewCount).toBe(0);
    expect(o.triangulationAvailable).toBe(false);
    expect(o.confidence).toBe(0);
  });

  it('high reprojection error discounts confidence', () => {
    const clean = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-01', 'cam-02', 'cam-03'], 1.0)], 'precision');
    const noisy = observabilityForJoint('knee-flexion-l', [pt('left-knee', ['cam-01', 'cam-02', 'cam-03'], 10.0)], 'precision');
    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });
});
