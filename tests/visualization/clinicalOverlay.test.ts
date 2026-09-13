import { describe, it, expect } from 'vitest';
import { drawClinicalOverlay, overlayVisibilityFor, DirectionState } from '../../src/features/visualization/ClinicalOverlay';
import { buildKneeFlexionPose, E2E_REST_POSE } from '../../src/features/pose/SyntheticPoseSource';

const ctx = () => {
  const calls: string[] = [];
  const grad = { addColorStop: () => undefined };
  return {
    calls,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => calls.push('stroke'),
    fill: () => undefined,
    fillText: () => undefined,
    measureText: () => ({ width: 40 }),
    roundRect: () => undefined,
    createRadialGradient: () => grad,
    setLineDash: () => undefined,
    set strokeStyle(_: string) { void _; },
    set fillStyle(_: string) { void _; },
    set lineWidth(_: number) { void _; },
    set lineCap(_: string) { void _; },
    set font(_: string) { void _; },
    set textAlign(_: string) { void _; },
    set textBaseline(_: string) { void _; },
    set globalAlpha(_: number) { void _; },
  } as unknown as CanvasRenderingContext2D;
};

describe('ClinicalOverlay', () => {
  it('hides when suspended or joint-invalid, fades when low', () => {
    expect(overlayVisibilityFor('suspended', true)).toBe('hidden');
    expect(overlayVisibilityFor('high', false)).toBe('hidden');
    expect(overlayVisibilityFor('low', true)).toBe('fade');
    expect(overlayVisibilityFor('high', true)).toBe('full');
    expect(overlayVisibilityFor('moderate', true)).toBe('full');
  });

  it('draws the active joint and returns visibility (no throw on real pose)', () => {
    const lms = buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: 45 });
    const vis = drawClinicalOverlay(ctx(), 960, 600, {
      lms, joint: 'leftKnee', angle: 135, vel: 25,
      level: 'high', jointValid: true, t: 1000,
    });
    expect(vis).toBe('full');
    const hidden = drawClinicalOverlay(ctx(), 960, 600, {
      lms, joint: 'leftKnee', angle: NaN, vel: 0,
      level: 'suspended', jointValid: false, t: 1000,
    });
    expect(hidden).toBe('hidden');
  });

  it('direction state uses hysteresis (no flicker at zero crossing)', () => {
    const d = new DirectionState(10, 3);
    expect(d.push(25)).toBe(0);
    expect(d.push(26)).toBe(0);
    expect(d.push(27)).toBe(1);
    expect(d.push(2)).toBe(1);
    expect(d.push(-3)).toBe(1);
    expect(d.push(-30)).toBe(1);
    expect(d.push(-31)).toBe(1);
    expect(d.push(-32)).toBe(-1);
  });

  it('overlay hides (never migrates) when the knee chain collapses mid-crossing', () => {
    // Mid-crossing the therapist occludes the patient's knee chain: the
    // overlay must report hidden so the canvas draws nothing clinical.
    const lms = buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: 45 });
    for (const i of [23, 25, 27]) {
      lms[i] = { ...lms[i], visibility: 0.05, presence: 0.05 };
    }
    const vis = drawClinicalOverlay(ctx(), 960, 600, {
      lms, joint: 'leftKnee', angle: 135, vel: 25,
      level: 'high', jointValid: true, t: 1000,
    });
    expect(vis).toBe('hidden');
  });
});
