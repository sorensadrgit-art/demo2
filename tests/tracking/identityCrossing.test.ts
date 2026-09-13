import { describe, expect, it } from 'vitest';
import { PatientIdentityManager } from '../../src/features/tracking/patientIdentity';
import {
  buildKneeFlexionPose, buildTherapistPose, crossingOcclusion, E2E_REST_POSE,
} from '../../src/features/pose/SyntheticPoseSource';
import { LM } from '../../src/features/pose/poseTypes';
import type { PoseDetection } from '../../src/features/pose/poseTypes';

const det = (landmarks: ReturnType<typeof buildKneeFlexionPose>, score = 0.92): PoseDetection => ({
  landmarks, score, bbox: { x: 0, y: 0, w: 1, h: 1 }, timestamp: 0,
});

const TRACK_FRAMES = 40;

/** Drive the manager with repeated detections (50ms cadence). */
function feed(m: PatientIdentityManager, detections: PoseDetection[], start: number, frames: number) {
  let r = m.update([], start);
  for (let i = 0; i < frames; i++) {
    r = m.update(detections.map((d) => ({ ...d, timestamp: start + i * 50 })), start + i * 50);
  }
  return r;
}

describe('identity continuity under the clinical crossing scenario', () => {
  it('auto-acquires exactly one patient from a stable rest pose', () => {
    const m = new PatientIdentityManager();
    const r = feed(m, [det(buildKneeFlexionPose(E2E_REST_POSE))], 1000, TRACK_FRAMES);
    expect(r.state).toBe('locked');
    expect(r.activeId).not.toBeNull();
    expect(r.idSwitches).toBe(0);
  });

  it('holds the patient when a LARGER therapist crosses (no switch)', () => {
    const m = new PatientIdentityManager();
    let now = 1000;
    feed(m, [det(buildKneeFlexionPose(E2E_REST_POSE))], now, TRACK_FRAMES);
    const original = m.activePatientId;
    now += TRACK_FRAMES * 50;
    // Therapist sweeps through while 1.35x larger than the patient.
    for (let k = 0; k <= 20; k++) {
      const crossT = k / 20;
      const occ = crossingOcclusion(crossT);
      const patient = buildKneeFlexionPose(E2E_REST_POSE);
      if (occ > 0) {
        for (const i of [LM.leftKnee, LM.leftHip, LM.rightHip]) {
          patient[i] = { ...patient[i], visibility: 0.05, presence: 0.05 };
        }
      }
      m.update([
        det(patient, 0.92 * (1 - occ * 0.5)),
        det(buildTherapistPose(crossT, 7, 1.35), 0.95),
      ], now += 50);
    }
    expect(m.update([], Date.now()).idSwitches).toBe(0);
    // Locked throughout the partial occlusion, or at worst reacquiring —
    // never transferred to the therapist.
    expect(['locked', 'reacquiring']).toContain(m.state);
    if (m.state === 'locked') expect(m.activePatientId).toBe(original);
  });

  it('suspends (never transfers) while ONLY the therapist is visible, then reacquires the original patient', () => {
    const m = new PatientIdentityManager();
    let now = 1000;
    feed(m, [det(buildKneeFlexionPose(E2E_REST_POSE))], now, TRACK_FRAMES);
    const original = m.activePatientId;
    now += TRACK_FRAMES * 50;
    // Full-hide window: therapist alone, high score.
    let worst: string = m.state;
    for (let k = 0; k < 40; k++) {
      const r = m.update([det(buildTherapistPose(0.5, 7, 1.35), 0.96)], now += 50);
      if (r.state !== 'locked') worst = r.state;
    }
    expect(m.activePatientId !== original || m.state !== 'locked').toBe(true);
    expect(worst).not.toBe('locked');
    expect(m.update([], Date.now()).idSwitches).toBe(0);
    // Patient returns → reacquired as the ORIGINAL identity.
    const r = feed(m, [det(buildKneeFlexionPose(E2E_REST_POSE))], now, TRACK_FRAMES);
    expect(r.state).toBe('locked');
    expect(r.activeId).toBe(original);
    expect(r.idSwitches).toBe(0);
  });

  it('never prefers the larger body on score alone', () => {
    const m = new PatientIdentityManager();
    let now = 1000;
    feed(m, [det(buildKneeFlexionPose(E2E_REST_POSE), 0.9)], now, TRACK_FRAMES);
    const original = m.activePatientId;
    now += TRACK_FRAMES * 50;
    // A bigger, higher-score body appears beside the patient: lock must hold.
    for (let k = 0; k < 20; k++) {
      m.update([
        det(buildKneeFlexionPose(E2E_REST_POSE), 0.9),
        det(buildTherapistPose(0.3, 7, 1.35), 0.99),
      ], now += 50);
    }
    expect(m.activePatientId).toBe(original);
    expect(m.update([], Date.now()).idSwitches).toBe(0);
  });
});
