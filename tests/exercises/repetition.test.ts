import { describe, it, expect } from 'vitest';
import { RepetitionDetector } from '../../src/features/movement/repetitionDetector';
import { symmetryOf, timingLagMs } from '../../src/features/movement/symmetryEngine';
import { detectCompensations } from '../../src/features/movement/compensationEngine';
import { evaluateConfidence } from '../../src/features/biomechanics/confidence';

describe('hysteresis rep detection', () => {
  it('counts clean sinusoidal squats without double counting', () => {
    const d = new RepetitionDetector();
    let t = 0;
    const done: number[] = [];
    for (let rep = 0; rep < 3; rep++) {
      for (let i = 0; i <= 60; i++) {
        const ph = (i / 60) * Math.PI * 2;
        const angle = 100 + 60 * (0.5 - 0.5 * Math.cos(ph)); // 100..160..100
        const vel = 60 * Math.PI * Math.sin(ph);
        t += 33;
        const r = d.push(t, angle, vel, true);
        if (r) done.push(r.index);
      }
    }
    expect(d.repCount).toBe(3);
  });

  it('ignores sub-threshold jitter around a single threshold', () => {
    const d = new RepetitionDetector({ highFrac: 0.7, lowFrac: 0.3, minExcursionDeg: 15, minDurationMs: 400 });
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += 33;
      d.push(t, 120 + Math.sin(i) * 3, 5, true); // ±3° tremor
    }
    expect(d.repCount).toBe(0);
  });
});

describe('symmetry engine', () => {
  it('computes difference + pct from underlying metrics', () => {
    const m = symmetryOf('Peak angle', 118, 126, '°')!;
    expect(m.difference).toBeCloseTo(8, 6);
    expect(m.symmetryPct).toBeCloseTo((118 / 126) * 100, 4);
  });
  it('timing lag detects a leading side', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({
      t: i * 33,
      left: Math.sin(i * 0.2),
      right: Math.sin((i - 3) * 0.2),
    }));
    expect(Math.abs(timingLagMs(samples))).toBeGreaterThan(0);
  });
});

describe('compensation + confidence', () => {
  it('flags trunk compensation with evidence', () => {
    const flags = detectCompensations({
      trunkLateralDeg: 14.2, trunkFlexDeg: 5,
      leftKneeDeg: 100, rightKneeDeg: 102,
      leftHipDeg: 150, rightHipDeg: 150,
      pelvisShiftNorm: 0.05, trunkValid: true, kneeValid: true, t: 1000,
    });
    expect(flags.some((f) => f.id === 'trunk-lateral')).toBe(true);
    const f = flags.find((x) => x.id === 'trunk-lateral')!;
    expect(f.evidence[0].value).toBeCloseTo(14.2, 4);
    expect(f.evidence[0].threshold).toBe(10);
  });
  it('suspends on unreliable pose instead of false precision', () => {
    const c = evaluateConfidence({
      landmarkVisibility: 0.1, poseScore: 0.9, viewSuitability: 0.9,
      calibrationQuality: 0.9, trackingContinuity: 1, frameDropRate: 0, cameraMoving: false,
    });
    expect(c.suspend).toBe(true);
    expect(c.level).toBe('suspended');
  });
});
