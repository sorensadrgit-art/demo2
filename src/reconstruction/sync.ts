/**
 * Multi-camera synchronization model (Phase 5).
 * Every captured frame joins a shared session-monotonic timeline
 * (lib/timing SessionClock domain). Frames are only triangulated when
 * their temporal alignment passes explicit tolerance — never merely
 * because they arrived near each other.
 */
export interface CameraFrameRef {
  cameraId: string;
  frameIndex: number;
  sourceTimestampMs: number;
}

export interface SynchronizedFrameSet {
  timestampMs: number;
  frames: CameraFrameRef[];
}

export interface SynchronizationQuality {
  maxOffsetMs: number;
  meanOffsetMs: number;
  valid: boolean;
}

export interface SyncTolerances {
  /** Hard limit: any frame beyond this offset invalidates the set. */
  maxOffsetMs: number;
  /** Tighter target for hardware-synced fixtures. */
  targetOffsetMs: number;
}

export const HARDWARE_SYNC_TOLERANCE: SyncTolerances = { maxOffsetMs: 2, targetOffsetMs: 0.5 };
export const SOFTWARE_SYNC_TOLERANCE: SyncTolerances = { maxOffsetMs: 16, targetOffsetMs: 8 };

/**
 * Group per-camera frames into a synchronized set around a master
 * timestamp. Frames outside tolerance are dropped (returned separately
 * for diagnostics); a set with < minCameras in-tolerance frames is
 * marked invalid and must NOT be triangulated.
 */
export function synchronizeFrames(
  masterTimestampMs: number,
  candidates: CameraFrameRef[],
  tolerance: SyncTolerances,
  minCameras = 2,
): { set: SynchronizedFrameSet; dropped: CameraFrameRef[]; quality: SynchronizationQuality } {
  const inTol: CameraFrameRef[] = [];
  const dropped: CameraFrameRef[] = [];
  for (const c of candidates) {
    if (Math.abs(c.sourceTimestampMs - masterTimestampMs) <= tolerance.maxOffsetMs) inTol.push(c);
    else dropped.push(c);
  }
  const offsets = inTol.map((c) => Math.abs(c.sourceTimestampMs - masterTimestampMs));
  const maxOffsetMs = offsets.length ? Math.max(...offsets) : Number.POSITIVE_INFINITY;
  const meanOffsetMs = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : Number.POSITIVE_INFINITY;
  const quality: SynchronizationQuality = {
    maxOffsetMs,
    meanOffsetMs,
    valid: inTol.length >= minCameras && maxOffsetMs <= tolerance.maxOffsetMs,
  };
  return { set: { timestampMs: masterTimestampMs, frames: inTol }, dropped, quality };
}
