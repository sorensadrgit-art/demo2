import { describe, expect, it } from 'vitest';
import { validateTriangulateResponse, BIOMECHANICS_PIPELINE_VERSION } from '../src/services/biomechanics/client';

describe('biomechanics client contracts', () => {
  it('pipeline version matches backend', () => {
    expect(BIOMECHANICS_PIPELINE_VERSION).toBe('kinelab-biomechanics-v2');
  });
  it('accepts a valid triangulate response', () => {
    const body = {
      landmarkId: 'left-knee', pointM: [0.1, 0.45, 0.02],
      usedCameraIds: ['cam-01', 'cam-02'], rejectedCameraIds: [],
      residualsPx: { 'cam-01': 0.4 }, reprojectionErrorPx: 0.4,
      pipeline: BIOMECHANICS_PIPELINE_VERSION,
    };
    expect(validateTriangulateResponse(body).landmarkId).toBe('left-knee');
  });
  it('rejects malformed responses', () => {
    expect(() => validateTriangulateResponse({ pointM: [1, 2] })).toThrow();
    expect(() => validateTriangulateResponse(null)).toThrow();
  });
});
