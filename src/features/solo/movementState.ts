export type MovementPhase = 'START' | 'MOVING' | 'PEAK' | 'RETURN' | 'COMPLETE';

export interface MovementTracker {
  phase: MovementPhase;
  startAngle: number | null;
  minAngle: number;
  maxAngle: number;
  peakTimestamp: number | null;
  reps: number;
}

export function createMovementTracker(): MovementTracker {
  return {
    phase: 'START',
    startAngle: null,
    minAngle: Infinity,
    maxAngle: -Infinity,
    peakTimestamp: null,
    reps: 0,
  };
}

/**
 * Jitter-resistant phase machine for a flexion-positive clinical angle.
 * onsetDeg: excursion from start that counts as MOVING.
 */
export function pushMovement(
  t: MovementTracker,
  angle: number,
  timestamp: number,
  valid: boolean,
  onsetDeg = 8,
  returnFrac = 0.25,
): MovementTracker {
  if (!valid || !Number.isFinite(angle)) return t;
  if (t.startAngle === null) {
    return { ...t, startAngle: angle, minAngle: angle, maxAngle: angle, phase: 'START' };
  }
  const minAngle = Math.min(t.minAngle, angle);
  const maxAngle = Math.max(t.maxAngle, angle);
  const excursion = maxAngle - t.startAngle;
  const towardPeak = angle - t.startAngle;

  if (t.phase === 'START') {
    if (towardPeak >= onsetDeg) return { ...t, minAngle, maxAngle, phase: 'MOVING' };
    return { ...t, minAngle, maxAngle };
  }
  if (t.phase === 'MOVING') {
    const falling = angle < maxAngle - Math.max(4, onsetDeg * 0.35);
    if (falling && excursion >= onsetDeg) {
      return { ...t, minAngle, maxAngle, phase: 'PEAK', peakTimestamp: timestamp };
    }
    return { ...t, minAngle, maxAngle };
  }
  if (t.phase === 'PEAK') {
    return { ...t, minAngle, maxAngle, phase: 'RETURN' };
  }
  if (t.phase === 'RETURN') {
    const target = t.startAngle + excursion * returnFrac;
    if (angle <= target) {
      return { ...t, minAngle, maxAngle, phase: 'COMPLETE', reps: t.reps + 1 };
    }
    return { ...t, minAngle, maxAngle };
  }
  // COMPLETE → next cycle (drop previous extrema so a new rep cannot inherit them)
  if (towardPeak >= onsetDeg) {
    return {
      phase: 'MOVING',
      startAngle: t.startAngle,
      minAngle: angle,
      maxAngle: angle,
      peakTimestamp: null,
      reps: t.reps,
    };
  }
  return { ...t, minAngle: angle, maxAngle: angle, phase: 'START' };
}
