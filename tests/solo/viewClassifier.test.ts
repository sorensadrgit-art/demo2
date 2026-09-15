import { describe, expect, it } from 'vitest';
import {
  classifySoloView,
  matchRequiredView,
} from '../../src/features/solo/viewClassifier';
import { frontalPose, makeLandmarks, sagittalPose } from './helpers';

describe('classifySoloView', () => {
  it('classifies a wide-shouldered pose as FRONTAL', () => {
    const r = classifySoloView(frontalPose());
    expect(r.view).toBe('FRONTAL');
    expect(r.shoulderWidthNorm).toBeGreaterThanOrEqual(0.62);
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('classifies a foreshortened left-side pose as LEFT_SAGITTAL', () => {
    const r = classifySoloView(sagittalPose('left'));
    expect(r.view).toBe('LEFT_SAGITTAL');
    expect(r.shoulderWidthNorm).toBeLessThanOrEqual(0.38);
    expect(r.leftLimbVisibility).toBeGreaterThan(r.rightLimbVisibility);
    expect(r.yawProxyDeg).toBeGreaterThan(45);
  });

  it('classifies a foreshortened right-side pose as RIGHT_SAGITTAL', () => {
    const r = classifySoloView(sagittalPose('right'));
    expect(r.view).toBe('RIGHT_SAGITTAL');
    expect(r.rightLimbVisibility).toBeGreaterThan(r.leftLimbVisibility);
  });

  it('returns UNKNOWN / VIEW_INVALID when body landmarks are invisible', () => {
    const r = classifySoloView(makeLandmarks(0));
    expect(r.view).toBe('UNKNOWN');
    expect(r.quality).toBe('VIEW_INVALID');
    expect(r.confidence).toBe(0);
  });

  it('yaw proxy is near 0 for frontal and near 90 for sagittal', () => {
    expect(classifySoloView(frontalPose()).yawProxyDeg).toBeLessThan(10);
    expect(classifySoloView(sagittalPose('left')).yawProxyDeg).toBeCloseTo(90, 0);
  });
});

describe('matchRequiredView', () => {
  it('matches LEFT_SAGITTAL against a SAGITTAL requirement', () => {
    const c = classifySoloView(sagittalPose('left'));
    const m = matchRequiredView(c, 'SAGITTAL');
    expect(m.matched).toBe(true);
    expect(m.quality).toBe('VIEW_GOOD');
  });

  it('matches FRONTAL against a FRONTAL requirement', () => {
    const c = classifySoloView(frontalPose());
    const m = matchRequiredView(c, 'FRONTAL');
    expect(m.matched).toBe(true);
    expect(m.quality).toBe('VIEW_GOOD');
  });

  it('FRONTAL view against a LEFT_SAGITTAL requirement is VIEW_INVALID', () => {
    const c = classifySoloView(frontalPose());
    const m = matchRequiredView(c, 'LEFT_SAGITTAL');
    expect(m.matched).toBe(false);
    expect(m.quality).toBe('VIEW_INVALID');
  });

  it('LEFT_SAGITTAL view against a FRONTAL requirement is VIEW_INVALID', () => {
    const c = classifySoloView(sagittalPose('left'));
    const m = matchRequiredView(c, 'FRONTAL');
    expect(m.matched).toBe(false);
    expect(m.quality).toBe('VIEW_INVALID');
  });

  it('opposite sagittal (right view vs left requirement) is VIEW_INVALID', () => {
    const c = classifySoloView(sagittalPose('right'));
    expect(c.view).toBe('RIGHT_SAGITTAL');
    const m = matchRequiredView(c, 'LEFT_SAGITTAL');
    expect(m.matched).toBe(false);
    expect(m.quality).toBe('VIEW_INVALID');
  });

  it('opposite sagittal (left view vs right requirement) is VIEW_INVALID', () => {
    const c = classifySoloView(sagittalPose('left'));
    const m = matchRequiredView(c, 'RIGHT_SAGITTAL');
    expect(m.matched).toBe(false);
    expect(m.quality).toBe('VIEW_INVALID');
  });

  it('UNKNOWN view is always VIEW_INVALID', () => {
    const c = classifySoloView(makeLandmarks(0));
    for (const req of ['FRONTAL', 'LEFT_SAGITTAL', 'SAGITTAL'] as const) {
      expect(matchRequiredView(c, req).quality).toBe('VIEW_INVALID');
    }
  });
});
