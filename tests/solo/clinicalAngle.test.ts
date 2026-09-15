import { describe, expect, it } from 'vitest';
import { LM } from '../../src/features/pose/poseTypes';
import {
  KNEE_FLEXION_CONVENTION,
  computeScreenPlaneAngle,
  conventionDescription,
  screenPlaneInteriorDeg,
  toClinicalDegrees,
  type ClinicalConvention,
} from '../../src/features/solo/clinicalAngle';
import { makeLandmarks, setLm } from './helpers';

describe('screenPlaneInteriorDeg', () => {
  it('returns 90 for a right angle', () => {
    const deg = screenPlaneInteriorDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(deg).toBeCloseTo(90, 6);
  });

  it('returns 180 for a straight (extended) line', () => {
    const deg = screenPlaneInteriorDeg({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 });
    expect(deg).toBeCloseTo(180, 6);
  });

  it('returns 0 for a fully folded angle', () => {
    const deg = screenPlaneInteriorDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(deg).toBeCloseTo(0, 6);
  });

  it('returns NaN for a degenerate zero-length segment (A coincides with B)', () => {
    expect(screenPlaneInteriorDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNaN();
  });

  it('returns NaN for a degenerate zero-length segment (C coincides with B)', () => {
    expect(screenPlaneInteriorDeg({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNaN();
  });
});

describe('toClinicalDegrees', () => {
  it('knee clinical = 180 - interior: full extension reads ~0', () => {
    expect(toClinicalDegrees(180, KNEE_FLEXION_CONVENTION)).toBeCloseTo(0, 6);
  });

  it('knee clinical = 180 - interior: flexed interior 90 reads 90', () => {
    expect(toClinicalDegrees(90, KNEE_FLEXION_CONVENTION)).toBeCloseTo(90, 6);
  });

  it('interior-kind convention passes the angle through', () => {
    const interior: ClinicalConvention = { id: 'test', kind: 'interior', unit: 'deg' };
    expect(toClinicalDegrees(123, interior)).toBe(123);
  });

  it('propagates NaN for non-finite interior angles', () => {
    expect(toClinicalDegrees(NaN, KNEE_FLEXION_CONVENTION)).toBeNaN();
    expect(toClinicalDegrees(Infinity, KNEE_FLEXION_CONVENTION)).toBeNaN();
  });

  it('convention description documents the 180 - interior formula', () => {
    expect(conventionDescription(KNEE_FLEXION_CONVENTION)).toContain('180 - interior');
  });
});

describe('computeScreenPlaneAngle', () => {
  it('computes knee clinical ~90 for a flexed left knee with good visibility', () => {
    const lms = makeLandmarks();
    // Hip above knee, ankle to the side of the knee → interior 90° at the knee.
    setLm(lms, LM.leftHip, 0.5, 0.4);
    setLm(lms, LM.leftKnee, 0.5, 0.6);
    setLm(lms, LM.leftAnkle, 0.7, 0.6);
    const r = computeScreenPlaneAngle(lms, LM.leftHip, LM.leftKnee, LM.leftAnkle, KNEE_FLEXION_CONVENTION);
    expect(r.valid).toBe(true);
    expect(r.interiorDeg).toBeCloseTo(90, 6);
    expect(r.clinicalDeg).toBeCloseTo(90, 6);
    expect(r.visibility).toBeCloseTo(0.99, 6);
  });

  it('computes knee clinical ~0 for an extended leg', () => {
    const lms = makeLandmarks();
    setLm(lms, LM.rightHip, 0.5, 0.3);
    setLm(lms, LM.rightKnee, 0.5, 0.5);
    setLm(lms, LM.rightAnkle, 0.5, 0.7);
    const r = computeScreenPlaneAngle(lms, LM.rightHip, LM.rightKnee, LM.rightAnkle, KNEE_FLEXION_CONVENTION);
    expect(r.valid).toBe(true);
    expect(r.interiorDeg).toBeCloseTo(180, 6);
    expect(r.clinicalDeg).toBeCloseTo(0, 6);
  });

  it('is invalid when any joint landmark falls below the visibility floor', () => {
    const lms = makeLandmarks();
    setLm(lms, LM.leftHip, 0.5, 0.4, 0.9);
    setLm(lms, LM.leftKnee, 0.5, 0.6, 0.1);
    setLm(lms, LM.leftAnkle, 0.7, 0.6, 0.9);
    const r = computeScreenPlaneAngle(lms, LM.leftHip, LM.leftKnee, LM.leftAnkle, KNEE_FLEXION_CONVENTION);
    expect(r.valid).toBe(false);
    expect(r.interiorDeg).toBeNaN();
    expect(r.clinicalDeg).toBeNaN();
    expect(r.visibility).toBeCloseTo(0.1, 6);
  });

  it('is invalid for degenerate geometry even with full visibility', () => {
    const lms = makeLandmarks(0.99);
    // Knee and hip coincide → zero-length segment → NaN.
    setLm(lms, LM.leftHip, 0.5, 0.5);
    setLm(lms, LM.leftKnee, 0.5, 0.5);
    setLm(lms, LM.leftAnkle, 0.7, 0.6);
    const r = computeScreenPlaneAngle(lms, LM.leftHip, LM.leftKnee, LM.leftAnkle, KNEE_FLEXION_CONVENTION);
    expect(r.valid).toBe(false);
    expect(r.clinicalDeg).toBeNaN();
  });
});
