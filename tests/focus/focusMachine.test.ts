import { describe, expect, it } from 'vitest';
import {
  CLINICAL_PROTOCOLS, getProtocol, primaryJoint, resolveJoints, defaultSideFor,
} from '../../src/features/focus/protocols';
import {
  canEnterReady, evaluateTrialQuality, selectBestTrial, trialNeedsRetake,
  OnsetDetector, CompletionDetector, CycleCounter,
} from '../../src/features/focus/focusMachine';

const sweep = (peak: number, n = 60): Array<{ t: number; angle: number; vel: number }> => {
  const out: Array<{ t: number; angle: number; vel: number }> = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const angle = 170 - Math.sin(f * Math.PI) * peak;
    out.push({ t: i * 33, angle, vel: -Math.cos(f * Math.PI) * 60 });
  }
  return out;
};

describe('clinical protocol registry', () => {
  it('knee flexion loads the affected-side knee joint + sagittal plane', () => {
    const p = getProtocol('knee-flexion-arom')!;
    expect(p.preferredPlane).toBe('sagittal');
    expect(primaryJoint(p, 'left')).toBe('leftKnee');
    expect(primaryJoint(p, 'right')).toBe('rightKnee');
    expect(resolveJoints(p, 'left')).toEqual(['leftKnee']);
  });

  it('shoulder abduction loads frontal plane + abduction joints', () => {
    const p = getProtocol('shoulder-abduction')!;
    expect(p.preferredPlane).toBe('frontal');
    expect(primaryJoint(p, 'left')).toBe('leftShoulderAbd');
  });

  it('squat is bilateral with rep-based completion', () => {
    const p = getProtocol('squat')!;
    expect(p.bilateral).toBe(true);
    expect(resolveJoints(p, 'left')).toEqual(['leftKnee', 'rightKnee']);
    expect(p.completionCriteria.cyclesPerTrial).toBe(5);
  });

  it('stored affected side wins the default', () => {
    const p = getProtocol('knee-flexion-arom')!;
    expect(defaultSideFor(p, 'right')).toBe('right');
    expect(defaultSideFor(p, 'na')).toBe('left');
  });

  it('covers the required initial protocol set', () => {
    for (const id of ['knee-flexion-arom', 'knee-extension-arom', 'shoulder-flexion', 'shoulder-abduction', 'elbow-flexion', 'squat', 'sit-to-stand']) {
      expect(CLINICAL_PROTOCOLS.some((p) => p.id === id), id).toBe(true);
    }
  });
});

describe('READY gate', () => {
  it('blocks READY when calibration fails', () => {
    const g = canEnterReady({ tracking: 'locked', calibQuality: 0.2, viewSuitability: 0.9, level: 'high' });
    expect(g.ok).toBe(false);
    expect(g.blockers.join(' ')).toMatch(/Calibration/);
  });

  it('blocks READY on tracking loss', () => {
    const g = canEnterReady({ tracking: 'lost', calibQuality: 0.9, viewSuitability: 0.9, level: 'high' });
    expect(g.ok).toBe(false);
  });

  it('blocks READY on wrong camera plane', () => {
    const g = canEnterReady({ tracking: 'locked', calibQuality: 0.9, viewSuitability: 0.3, level: 'high' });
    expect(g.ok).toBe(false);
  });

  it('blocks READY on suspended confidence (measurement suspended)', () => {
    const g = canEnterReady({ tracking: 'locked', calibQuality: 0.9, viewSuitability: 0.9, level: 'suspended' });
    expect(g.ok).toBe(false);
  });

  it('enters READY when everything is green', () => {
    expect(canEnterReady({ tracking: 'locked', calibQuality: 0.9, viewSuitability: 0.9, level: 'high' }).ok).toBe(true);
  });
});

describe('quality gate', () => {
  const base = {
    samples: sweep(120), minSamples: 10, validRatio: 0.95,
    tracking: 'locked' as const, calibQuality: 0.9, viewSuitability: 0.9,
    liveLevel: 'high' as const, completedCycles: 1, requiredCycles: 1,
    minExcursionDeg: 20, occludedRatio: 0,
  };

  it('accepts a clean trial', () => {
    expect(evaluateTrialQuality(base).verdict).toBe('valid');
  });

  it('requires retake when the target is lost', () => {
    const r = evaluateTrialQuality({ ...base, tracking: 'lost' });
    expect(r.verdict).toBe('invalid');
    expect(r.reasons.join(' ')).toMatch(/lost/);
  });

  it('requires retake when calibration is incomplete', () => {
    expect(evaluateTrialQuality({ ...base, calibQuality: 0.2 }).verdict).toBe('invalid');
  });

  it('requires retake when the movement is too small', () => {
    const r = evaluateTrialQuality({ ...base, samples: sweep(5), completedCycles: 1 });
    expect(r.verdict).toBe('invalid');
  });

  it('recommends retake on heavy occlusion', () => {
    const r = evaluateTrialQuality({ ...base, occludedRatio: 0.4, validRatio: 0.6 });
    expect(['retake-recommended', 'valid-warning']).toContain(r.verdict);
  });

  it('requires retake when cycles are incomplete', () => {
    const r = evaluateTrialQuality({ ...base, completedCycles: 2, requiredCycles: 5 });
    expect(r.verdict).toBe('invalid');
  });
});

describe('best-trial selection', () => {
  it('prefers confidence over the largest ROM', () => {
    const trials = [
      { index: 0, peak: 150, min: 20, excursion: 130, peakVelocity: 90, duration: 3, sampleCount: 120, verdict: 'valid' as const, reasons: [], confidence: 0.6, startedAt: 0, endedAt: 3000 },
      { index: 1, peak: 140, min: 25, excursion: 115, peakVelocity: 80, duration: 3, sampleCount: 140, verdict: 'valid' as const, reasons: [], confidence: 0.95, startedAt: 0, endedAt: 3000 },
    ];
    const best = selectBestTrial(trials)!;
    expect(best.index).toBe(1);
    expect(best.reason).toMatch(/confidence/);
  });

  it('ignores invalid trials', () => {
    const trials = [
      { index: 0, peak: 160, min: 10, excursion: 150, peakVelocity: 99, duration: 3, sampleCount: 200, verdict: 'invalid' as const, reasons: ['lost'], confidence: 0.9, startedAt: 0, endedAt: 3000 },
      { index: 1, peak: 130, min: 30, excursion: 100, peakVelocity: 70, duration: 3, sampleCount: 100, verdict: 'valid' as const, reasons: [], confidence: 0.8, startedAt: 0, endedAt: 3000 },
    ];
    expect(selectBestTrial(trials)!.index).toBe(1);
  });

  it('invalid trials need retake; valid trials advance', () => {
    expect(trialNeedsRetake({ index: 0, peak: 0, min: 0, excursion: 0, peakVelocity: 0, duration: 0, sampleCount: 0, verdict: 'invalid', reasons: [], confidence: 0, startedAt: 0, endedAt: 0 })).toBe(true);
    expect(trialNeedsRetake({ index: 0, peak: 0, min: 0, excursion: 0, peakVelocity: 0, duration: 0, sampleCount: 0, verdict: 'valid', reasons: [], confidence: 0, startedAt: 0, endedAt: 0 })).toBe(false);
  });
});

describe('onset / completion / cycles', () => {
  it('detects movement onset after rest', () => {
    const o = new OnsetDetector();
    o.observeRest(170, 0);
    o.observeRest(170, 100);
    expect(o.detect(170, 2, 8)).toBe(false);
    expect(o.detect(150, -40, 8)).toBe(true);
  });

  it('completes only after cycles + return + stillness', () => {
    const c = new CompletionDetector();
    c.arm(170);
    const baseInput = {
      now: 5000, angle: 170, vel: 0, valid: true, cyclesDone: 1, required: 1,
      returnTolDeg: 8, stillnessMs: 700, startT: 0, maxDurationMs: 30000,
      excursionSoFar: 100, minExcursionDeg: 20,
    };
    expect(c.detect({ ...baseInput, cyclesDone: 0 })).toBe(false);
    expect(c.detect({ ...baseInput, now: 100 })).toBe(false);
    expect(c.detect({ ...baseInput, now: 900 })).toBe(true);
  });

  it('times out runaway trials', () => {
    const c = new CompletionDetector();
    c.arm(170);
    expect(c.detect({
      now: 99999, angle: 90, vel: -50, valid: true, cyclesDone: 0, required: 5,
      returnTolDeg: 8, stillnessMs: 700, startT: 0, maxDurationMs: 30000,
      excursionSoFar: 0, minExcursionDeg: 20,
    })).toBe(true);
  });

  it('counts a full flexion-extension cycle', () => {
    const cc = new CycleCounter();
    let n = 0;
    for (let a = 170; a >= 60; a -= 5) n = cc.push(a, -40, 20);
    expect(n).toBe(0);
    for (let a = 60; a <= 170; a += 5) n = cc.push(a, 40, 20);
    expect(n).toBe(1);
  });
});
