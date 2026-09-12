import { describe, it, expect } from 'vitest';
import { SubjectTracker } from '../../src/features/tracking/subjectTracker';
import { emptyLandmarks, type PoseDetection } from '../../src/features/pose/poseTypes';

const det = (cx: number, score = 0.9, t = 0): PoseDetection => {
  const lms = emptyLandmarks().map((l, i) => ({ ...l, x: cx + (i % 5) * 0.01, y: 0.2 + Math.floor(i / 5) * 0.08, visibility: 0.9 }));
  return { landmarks: lms, score, bbox: { x: cx - 0.1, y: 0.1, w: 0.2, h: 0.7 }, timestamp: t };
};

describe('SubjectTracker persistent lock', () => {
  it('locks to the selected subject and never silently switches', () => {
    const tr = new SubjectTracker();
    let r = tr.update([det(0.3, 0.9, 0), det(0.7, 0.85, 0)], 0);
    expect(r.candidates.length).toBe(2);
    const first = r.candidates[0].id;
    tr.selectSubject(first, 0);
    // Second person walks closer (higher score, center frame) — must not steal lock.
    r = tr.update([det(0.32, 0.9, 100), det(0.5, 0.99, 100)], 100);
    expect(r.state).toBe('locked');
    expect(r.activeId).toBe(first);
    expect(r.active).not.toBeNull();
  });

  it('reacquiring → lost transitions without identity switch', () => {
    const tr = new SubjectTracker();
    tr.reacquireWindowMs = 300;
    let r = tr.update([det(0.4, 0.9, 0)], 0);
    tr.selectSubject(r.candidates[0].id, 0);
    r = tr.update([det(0.4, 0.9, 100)], 100);
    expect(r.state).toBe('locked');
    r = tr.update([], 200);
    expect(r.state).toBe('reacquiring');
    expect(r.active).toBeNull();
    r = tr.update([], 1000);
    expect(r.state).toBe('lost');
    expect(r.activeId).not.toBeNull(); // identity preserved, not switched
  });
});
