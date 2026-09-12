import { describe, expect, it } from 'vitest';
import { buildKneeFlexionPose, cosineFlex, E2E_REST_POSE } from '../../src/features/pose/SyntheticPoseSource';
import { computeAllJointAngles } from '../../src/features/biomechanics/jointAngles';
import { angularVelocity } from '../../src/features/biomechanics/angularVelocity';
import { CycleCounter, CompletionDetector, OnsetDetector } from '../../src/features/focus/focusMachine';

/** Drive the real detectors with the scripted T1 cosine (112°/5s).
 *  Landmarks stream at 60 Hz; the automation ticks detectors every 200 ms. */
describe('detector chain on scripted knee flexion', () => {
  it('onset fires, a cycle counts, completion fires near return-to-start', () => {
    const onset = new OnsetDetector();
    const completion = new CompletionDetector();
    const cycles = new CycleCounter();
    const hist: Array<{ t: number; angle: number }> = [];
    const dt = 1000 / 60;
    let recording = false;
    let startT = 0;
    let completedAt = -1;
    let onsetAt = -1;
    let peak = 180;
    for (let step = 0; step < 60 * 14; step++) {
      const now = step * dt;
      const flex = cosineFlex(now, 5000, 112);
      const lms = buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: flex });
      const angle = computeAllJointAngles(lms).leftKnee.angle;
      hist.push({ t: now, angle });
      if (hist.length > 40) hist.shift();
      if (step % 12 !== 0) continue; // 200 ms automation tick
      const vel = angularVelocity(hist, hist.length - 1, 2);
      if (!recording) {
        onset.observeRest(angle, now);
        if (onset.detect(angle, vel, 8)) {
          recording = true; onsetAt = now; startT = now;
          completion.arm(angle); cycles.reset();
        }
      } else {
        cycles.push(angle, vel, 20);
        peak = Math.min(peak, angle); // app accumulates excursion across samples
        const done = completion.detect({
          now, angle, vel, valid: true,
          cyclesDone: cycles.cycles, required: 1,
          returnTolDeg: 22, stillnessMs: 700, startT, maxDurationMs: 30000,
          excursionSoFar: 180 - peak, minExcursionDeg: 20,
        });
        if (done) { completedAt = now; break; }
      }
    }
    expect(onsetAt).toBeGreaterThanOrEqual(0);
    expect(cycles.cycles).toBeGreaterThanOrEqual(1);
    expect(completedAt).toBeGreaterThanOrEqual(0);
    // One clean flexion + return settles well before the 30s timeout.
    expect(completedAt - startT).toBeLessThan(15000);
  });
});
