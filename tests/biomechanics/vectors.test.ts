import { describe, it, expect } from 'vitest';
import {
  angleBetween, signedAngle, projectToPlane, interiorAngle,
  normalizeAngle360, angleDelta, v3,
} from '../../src/lib/math/vectors';

describe('vector primitives', () => {
  it('angleBetween: 0°, 45°, 90°, 180°', () => {
    expect(angleBetween(v3(1, 0, 0), v3(1, 0, 0))).toBeCloseTo(0, 6);
    expect(angleBetween(v3(1, 0, 0), v3(1, 1, 0))).toBeCloseTo(45, 6);
    expect(angleBetween(v3(1, 0, 0), v3(0, 1, 0))).toBeCloseTo(90, 6);
    expect(angleBetween(v3(1, 0, 0), v3(-1, 0, 0))).toBeCloseTo(180, 6);
  });

  it('interiorAngle: right angle at vertex', () => {
    expect(interiorAngle(v3(1, 0, 0), v3(0, 0, 0), v3(0, 1, 0))).toBeCloseTo(90, 6);
    expect(interiorAngle(v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0))).toBeCloseTo(180, 6);
    expect(interiorAngle(v3(0, 0, 0), v3(1, 0, 0), v3(1, 0, 0))).toBeNaN();
  });

  it('signedAngle respects axis handedness', () => {
    const s = signedAngle(v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1));
    expect(s).toBeCloseTo(90, 6);
    expect(signedAngle(v3(1, 0, 0), v3(0, -1, 0), v3(0, 0, 1))).toBeCloseTo(-90, 6);
  });

  it('projectToPlane removes the normal component', () => {
    const p = projectToPlane(v3(1, 2, 3), v3(0, 0, 1));
    expect(p.z).toBeCloseTo(0, 9);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(2, 9);
  });

  it('angle normalization + delta wrap correctly', () => {
    expect(normalizeAngle360(-10)).toBeCloseTo(350, 9);
    expect(normalizeAngle360(370)).toBeCloseTo(10, 9);
    expect(angleDelta(10, 350)).toBeCloseTo(20, 9);
    expect(angleDelta(350, 10)).toBeCloseTo(-20, 9);
  });
});
