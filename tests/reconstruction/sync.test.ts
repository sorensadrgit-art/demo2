import { describe, it, expect } from 'vitest';
import { synchronizeFrames, HARDWARE_SYNC_TOLERANCE, SOFTWARE_SYNC_TOLERANCE } from '../../src/reconstruction/sync';

/** Sync model: shared timeline, explicit tolerance, no silent triangulation. */
describe('synchronization', () => {
  it('groups in-tolerance frames and reports quality', () => {
    const { set, dropped, quality } = synchronizeFrames(1000, [
      { cameraId: 'cam-01', frameIndex: 60, sourceTimestampMs: 999 },
      { cameraId: 'cam-02', frameIndex: 60, sourceTimestampMs: 1001 },
      { cameraId: 'cam-03', frameIndex: 60, sourceTimestampMs: 1000 },
    ], SOFTWARE_SYNC_TOLERANCE);
    expect(set.frames).toHaveLength(3);
    expect(dropped).toHaveLength(0);
    expect(quality.valid).toBe(true);
    expect(quality.maxOffsetMs).toBe(1);
    expect(quality.meanOffsetMs).toBeCloseTo(2 / 3, 9);
  });

  it('drops out-of-tolerance frames; hardware fixture expects near-exact', () => {
    const { set, dropped, quality } = synchronizeFrames(1000, [
      { cameraId: 'cam-01', frameIndex: 60, sourceTimestampMs: 1000 },
      { cameraId: 'cam-02', frameIndex: 60, sourceTimestampMs: 1005 },
    ], HARDWARE_SYNC_TOLERANCE);
    expect(set.frames).toHaveLength(1);
    expect(dropped.map((d) => d.cameraId)).toEqual(['cam-02']);
    expect(quality.valid).toBe(false);
  });

  it('fewer than minCameras invalidates the set (must not triangulate)', () => {
    const { quality } = synchronizeFrames(1000, [
      { cameraId: 'cam-01', frameIndex: 60, sourceTimestampMs: 1000 },
    ], SOFTWARE_SYNC_TOLERANCE, 2);
    expect(quality.valid).toBe(false);
  });
});
