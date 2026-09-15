import { describe, expect, it } from 'vitest';
import {
  createMovementTracker,
  pushMovement,
  type MovementTracker,
} from '../../src/features/solo/movementState';

/** Push a sequence of valid angles, one degree per tick. */
function run(t: MovementTracker, angles: number[], startTs = 0): MovementTracker {
  let cur = t;
  angles.forEach((a, i) => {
    cur = pushMovement(cur, a, startTs + i, true);
  });
  return cur;
}

describe('movement phase machine', () => {
  it('walks START → MOVING → PEAK → RETURN → COMPLETE and counts one rep', () => {
    let t = createMovementTracker();
    expect(t.phase).toBe('START');
    expect(t.reps).toBe(0);

    t = pushMovement(t, 0, 0, true); // establishes start angle
    expect(t.phase).toBe('START');
    expect(t.startAngle).toBe(0);

    t = pushMovement(t, 10, 1, true); // onset crossed
    expect(t.phase).toBe('MOVING');

    t = run(t, [20, 30, 40], 2); // still rising
    expect(t.phase).toBe('MOVING');
    expect(t.maxAngle).toBe(40);

    t = pushMovement(t, 30, 5, true); // fell > 4° from max after excursion → peak detected
    expect(t.phase).toBe('PEAK');
    expect(t.peakTimestamp).toBe(5);

    t = pushMovement(t, 25, 6, true); // any sample after PEAK → RETURN
    expect(t.phase).toBe('RETURN');

    // Return target = start + excursion * 0.25 = 0 + 40*0.25 = 10
    t = pushMovement(t, 8, 7, true);
    expect(t.phase).toBe('COMPLETE');
    expect(t.reps).toBe(1);
  });

  it('does not complete before the angle returns near the start', () => {
    let t = createMovementTracker();
    t = run(t, [0, 10, 20, 30, 40, 30, 25, 20], 0);
    expect(t.phase).toBe('RETURN');
    t = pushMovement(t, 15, 8, true); // still above target 10
    expect(t.phase).toBe('RETURN');
    expect(t.reps).toBe(0);
    t = pushMovement(t, 9, 9, true);
    expect(t.phase).toBe('COMPLETE');
    expect(t.reps).toBe(1);
  });

  it('ignores jitter near the peak instead of double-counting', () => {
    let t = createMovementTracker();
    t = run(t, [0, 15, 30], 0);
    expect(t.phase).toBe('MOVING');

    // Jitter within 4° of the running max must not trigger PEAK.
    for (const j of [27, 29, 26.5, 30, 28, 29.5]) {
      t = pushMovement(t, j, 100, true);
      expect(t.phase).toBe('MOVING');
      expect(t.reps).toBe(0);
    }

    // A real drop past the jitter band flips to PEAK exactly once.
    t = pushMovement(t, 20, 200, true);
    expect(t.phase).toBe('PEAK');
    expect(t.peakTimestamp).toBe(200);
    expect(t.reps).toBe(0);
  });

  it('ignores jitter below the onset threshold while in START', () => {
    let t = createMovementTracker();
    t = run(t, [0, 3, 1, 4, 2, 7], 0); // all below 8° onset
    expect(t.phase).toBe('START');
    expect(t.reps).toBe(0);
    t = pushMovement(t, 9, 6, true);
    expect(t.phase).toBe('MOVING');
  });

  it('starts a new cycle after COMPLETE without losing the rep count', () => {
    let t = createMovementTracker();
    t = run(t, [0, 10, 20, 30, 40, 30, 25, 8], 0);
    expect(t.phase).toBe('COMPLETE');
    expect(t.reps).toBe(1);

    t = pushMovement(t, 5, 100, true); // below onset → back to START
    expect(t.phase).toBe('START');
    expect(t.reps).toBe(1);

    t = pushMovement(t, 20, 101, true); // onset crossed → new cycle
    expect(t.phase).toBe('MOVING');
    expect(t.reps).toBe(1);

    t = run(t, [35, 25, 20, 5], 102); // second full cycle
    expect(t.phase).toBe('COMPLETE');
    expect(t.reps).toBe(2);
  });

  it('resets min/max when a new cycle begins straight from COMPLETE', () => {
    let t = run(createMovementTracker(), [0, 10, 20, 30, 40, 30, 25, 8], 0);
    expect(t.phase).toBe('COMPLETE');
    t = pushMovement(t, 20, 100, true); // above onset while COMPLETE
    expect(t.phase).toBe('MOVING');
    expect(t.minAngle).toBe(20);
    expect(t.maxAngle).toBe(20);
    expect(t.reps).toBe(1);
  });

  it('ignores invalid or non-finite samples', () => {
    let t = createMovementTracker();
    t = run(t, [0, 10, 20], 0);
    const before = t;
    expect(pushMovement(before, NaN, 3, true)).toBe(before);
    expect(pushMovement(before, Infinity, 3, true)).toBe(before);
    expect(pushMovement(before, 25, 3, false)).toBe(before);
    expect(t.phase).toBe('MOVING');
  });

  it('tracks min and max across the rep', () => {
    let t = createMovementTracker();
    t = run(t, [10, 5, 25, 40, 30, 20, 12], 0);
    expect(t.minAngle).toBe(5);
    expect(t.maxAngle).toBe(40);
  });
});
