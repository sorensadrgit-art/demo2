import { describe, it, expect } from 'vitest';
import { projectionMatrixFrom, projectPoint, reprojectionErrorPx, rmse, validateCalibration } from '../../src/capture/calibration';
import { ringCameras } from '../../src/reconstruction/synthFixture';

/** Calibration math: projection, reprojection error, quality gates. */
describe('optical calibration', () => {
  it('projects a known 3D point through a known camera', () => {
    const cams = ringCameras(2);
    const P = cams[0].camera.projectionMatrix;
    // Point on the optical axis target: projects near image center.
    const proj = projectPoint(P, { x: 0, y: 0.6, z: 0 });
    expect(Number.isFinite(proj.x + proj.y)).toBe(true);
    expect(Math.abs(proj.x - 640)).toBeLessThan(120);
    expect(Math.abs(proj.y - 360)).toBeLessThan(120);
  });

  it('projection matrix P = K[R|t] matches manual composition', () => {
    const cams = ringCameras(1);
    const { intrinsics, extrinsics } = cams[0].camera;
    const P = projectionMatrixFrom(intrinsics, extrinsics);
    expect(P).toHaveLength(3);
    expect(P[0]).toHaveLength(4);
    // Last row of K[R|t] is the rotation third row + translation term.
    expect(Math.abs(P[2][3] - (extrinsics.rotation[2][0] * -extrinsics.translationM[0]
      + extrinsics.rotation[2][1] * -extrinsics.translationM[1]
      + extrinsics.rotation[2][2] * -extrinsics.translationM[2]))).toBeLessThan(1e-9);
  });

  it('reprojection error is ~0 for exact projection, large for offset', () => {
    const cams = ringCameras(2);
    const P = cams[0].camera.projectionMatrix;
    const world = { x: 0.06, y: 0.55, z: 0 };
    const exact = projectPoint(P, world);
    expect(reprojectionErrorPx(P, world, exact)).toBeLessThan(1e-9);
    expect(reprojectionErrorPx(P, world, { x: exact.x + 10, y: exact.y })).toBeCloseTo(10, 6);
  });

  it('rmse aggregates residuals; validation rejects poor calibration', () => {
    expect(rmse([1, 2, 3])).toBeCloseTo(Math.sqrt(14 / 3), 9);
    expect(Number.isNaN(rmse([]))).toBe(true);
    const good = validateCalibration(0.8, { 'cam-01': 0.9, 'cam-02': 1.1 }, 'cal-good');
    expect(good.valid).toBe(true);
    expect(good.warnings).toHaveLength(0);
    const bad = validateCalibration(5.2, { 'cam-01': 0.9, 'cam-02': 6.1 }, 'cal-bad');
    expect(bad.valid).toBe(false);
    expect(bad.warnings.length).toBeGreaterThan(0);
    const warn = validateCalibration(2.0, { 'cam-01': 1.0 }, 'cal-warn');
    expect(warn.valid).toBe(true);
    expect(warn.warnings.length).toBeGreaterThan(0);
  });
});
