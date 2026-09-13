import { describe, it, expect } from 'vitest';
import { PatientIdentityManager, scoreCandidate, signatureSimilarity, geometrySignature } from '../../src/features/tracking/patientIdentity';
import { buildKneeFlexionPose, E2E_REST_POSE } from '../../src/features/pose/SyntheticPoseSource';
import { bboxOf, LM, emptyLandmarks, type NormalizedLandmark, type PoseDetection } from '../../src/features/pose/poseTypes';

/**
 * Deterministic multi-person identity fixtures. The therapist is a genuinely
 * different body (taller torso, wider shoulders, different x-position and
 * gait phase) — not a translated copy — so geometry similarity must separate
 * them while pelvis-normalization keeps the SAME patient similar across
 * translation.
 */

function shift(lms: NormalizedLandmark[], dx: number, dy = 0, vis = 0.95): NormalizedLandmark[] {
  return lms.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy, visibility: vis, presence: vis }));
}

function therapistPose(seed: number): NormalizedLandmark[] {
  // Taller, wider body standing right-of-center, mid-stride (arms/legs differ
  // from the patient's rest pose every frame).
  const lms = emptyLandmarks();
  const P = (i: number, x: number, y: number, v = 0.93) => {
    lms[i] = { x, y, z: 0, visibility: v, presence: v };
  };
  const sway = Math.sin(seed * 1.7) * 0.008;
  const cx = 0.74 + sway;
  P(LM.nose, cx, 0.07);
  P(LM.leftEye, cx - 0.012, 0.055); P(LM.rightEye, cx + 0.012, 0.055);
  P(LM.leftEar, cx - 0.022, 0.062); P(LM.rightEar, cx + 0.022, 0.062);
  P(LM.leftShoulder, cx - 0.085, 0.20); P(LM.rightShoulder, cx + 0.085, 0.20);
  P(LM.leftHip, cx - 0.055, 0.42); P(LM.rightHip, cx + 0.055, 0.42);
  const step = Math.sin(seed * 2.3) * 0.05;
  P(LM.leftElbow, cx - 0.095, 0.36); P(LM.rightElbow, cx + 0.095, 0.36);
  P(LM.leftWrist, cx - 0.10 + step * 0.4, 0.52); P(LM.rightWrist, cx + 0.10 - step * 0.4, 0.52);
  P(LM.leftIndex, cx - 0.10 + step * 0.4, 0.55); P(LM.rightIndex, cx + 0.10 - step * 0.4, 0.55);
  P(LM.leftPinky, cx - 0.11 + step * 0.4, 0.545); P(LM.rightPinky, cx + 0.11 - step * 0.4, 0.545);
  P(LM.leftThumb, cx - 0.09 + step * 0.4, 0.52); P(LM.rightThumb, cx + 0.09 - step * 0.4, 0.52);
  P(LM.mouthLeft, cx - 0.01, 0.085); P(LM.mouthRight, cx + 0.01, 0.085);
  P(LM.leftKnee, cx - 0.05 + step, 0.62); P(LM.rightKnee, cx + 0.05 - step, 0.62);
  P(LM.leftAnkle, cx - 0.055 + step * 1.6, 0.90); P(LM.rightAnkle, cx + 0.055 - step * 1.6, 0.90);
  P(LM.leftHeel, cx - 0.075 + step * 1.6, 0.92); P(LM.rightHeel, cx + 0.075 - step * 1.6, 0.92);
  P(LM.leftFootIndex, cx - 0.035 + step * 1.6, 0.92); P(LM.rightFootIndex, cx + 0.035 - step * 1.6, 0.92);
  return lms;
}

function crossingTherapistPose(t: number): { lms: NormalizedLandmark[]; phase: 'enter' | 'cross' | 'exit' } {
  // Walks left → right THROUGH the patient (x 0.2 → 0.85), occludes at center.
  const x = 0.2 + (t / 60) * 0.65;
  const base = therapistPose(t);
  const dx = x - 0.74;
  const moved = base.map((l) => ({ ...l, x: l.x + dx }));
  const near = Math.abs(x - 0.5);
  return { lms: moved, phase: near < 0.09 ? 'cross' : x < 0.5 ? 'enter' : 'exit' };
}

const det = (lms: NormalizedLandmark[], score: number, t: number): PoseDetection => ({
  landmarks: lms, score, bbox: bboxOf(lms), timestamp: t,
});

const patientDet = (t: number, flex = 0, vis = 0.95): PoseDetection =>
  det(shift(buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: flex, vis }), -0.06), 0.92, t);

function occludedPatient(t: number): PoseDetection {
  // Therapist body blocks the camera: knee chain + torso visibility collapse.
  const OCCLUDED = new Set<number>([LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex, LM.leftHip, LM.rightHip]);
  const lms = shift(buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: 20, vis: 0.95 }), -0.06)
    .map((l, i) => (OCCLUDED.has(i)
      ? { ...l, visibility: 0.05, presence: 0.05 }
      : l));
  return det(lms, 0.4, t);
}

describe('PatientIdentityManager', () => {
  it('auto-acquires the dominant candidate with no clicks after the stability gate', () => {
    const m = new PatientIdentityManager();
    let r = m.update([], 0);
    expect(r.state).toBe('unselected');
    // Ambiguous pair first: two equally strong subjects → minimal cue, no lock.
    for (let k = 0; k < 4; k++) {
      r = m.update([patientDet(k * 66), det(therapistPose(k), 0.92, k * 66)], k * 66);
    }
    expect(r.cue).toBe('clear-area');
    expect(r.activeId).toBeNull();
    // Single dominant patient → stability gate → sticky lock, zero clicks.
    for (let k = 4; k < 30; k++) {
      r = m.update([patientDet(k * 66)], k * 66);
    }
    expect(r.state).toBe('locked');
    expect(r.activeId).not.toBeNull();
    expect(r.active).not.toBeNull();
    expect(r.idSwitches).toBe(0);
    expect(m.sessionDescriptor).not.toBeNull();
  });

  it('holds identity when a higher-score therapist crosses (no silent switch)', () => {
    const m = new PatientIdentityManager();
    let r = m.update([patientDet(0)], 0);
    for (let k = 1; k <= 20; k++) r = m.update([patientDet(k * 66)], k * 66);
    expect(r.state).toBe('locked');
    const patientId = r.activeId!;
    // Therapist enters with HIGHER score, walks through, exits.
    for (let k = 21; k <= 80; k++) {
      const { lms, phase } = crossingTherapistPose(k - 21);
      const frame = phase === 'cross'
        ? [occludedPatient(k * 66), det(lms, 0.99, k * 66)]
        : [patientDet(k * 66, 10), det(lms, 0.99, k * 66)];
      r = m.update(frame, k * 66);
      // Identity is sticky: never handed to the therapist.
      expect(r.activeId).toBe(patientId);
    }
    expect(r.idSwitches).toBe(0);
    // Therapist gone → patient re-locks (reacquiring or locked, never lost-forever).
    for (let k = 81; k <= 110; k++) r = m.update([patientDet(k * 66)], k * 66);
    expect(['locked', 'reacquiring']).toContain(r.state);
    expect(r.activeId).toBe(patientId);
    expect(r.idSwitches).toBe(0);
  });

  it('suspends measurement during occlusion, reacquires the ORIGINAL on return', () => {
    const m = new PatientIdentityManager();
    let r = m.update([patientDet(0)], 0);
    for (let k = 1; k <= 20; k++) r = m.update([patientDet(k * 66)], k * 66);
    const patientId = r.activeId!;
    // Full occlusion: patient invisible, only the therapist present.
    for (let k = 21; k <= 40; k++) {
      r = m.update([det(therapistPose(k), 0.95, k * 66)], k * 66);
      expect(r.activeId).toBe(patientId);
    }
    expect(r.state).toBe('reacquiring');
    expect(r.active).toBeNull();
    // Patient returns ALONE with a neutral pose — must re-lock the original.
    for (let k = 41; k <= 70; k++) r = m.update([patientDet(k * 66)], k * 66);
    expect(r.activeId).toBe(patientId);
    expect(r.state).toBe('locked');
    expect(r.idSwitches).toBe(0);
  });

  it('declares TARGET LOST (never switches) when the patient leaves for good', () => {
    const m = new PatientIdentityManager();
    m.reacquireWindowMs = 300;
    let r = m.update([patientDet(0)], 0);
    for (let k = 1; k <= 20; k++) r = m.update([patientDet(k * 66)], k * 66);
    const patientId = r.activeId!;
    for (let k = 21; k <= 40; k++) r = m.update([], k * 100);
    expect(r.state).toBe('lost');
    expect(r.activeId).toBe(patientId);
    expect(r.idSwitches).toBe(0);
  });

  it('pelvis-normalized similarity survives translation and prefers the same body', () => {
    const a = geometrySignature(buildKneeFlexionPose(E2E_REST_POSE)).sig;
    const moved = geometrySignature(shift(buildKneeFlexionPose(E2E_REST_POSE), 0.15, 0.05)).sig;
    const other = geometrySignature(therapistPose(3)).sig;
    // Translation-invariant for the same body…
    expect(signatureSimilarity(a, moved)).toBeGreaterThan(0.95);
    // …but the same body still outranks a different upright body. (Two
    // standing humans are positionally similar by design — scale + shoulder
    // gates in verifyAgainstDescriptor carry the separation, not geometry.)
    expect(signatureSimilarity(a, moved)).toBeGreaterThan(signatureSimilarity(a, other));
  });

  it('scores the complete, centered patient above a partial distractor', () => {
    const full = scoreCandidate(patientDet(0), 12);
    const partial = shift(buildKneeFlexionPose(E2E_REST_POSE), 0.3)
      .map((l, i) => (i > 16 ? { ...l, visibility: 0.1, presence: 0.1 } : l));
    const weak = scoreCandidate(det(partial, 0.99, 0), 12);
    expect(full.score).toBeGreaterThan(weak.score);
  });
});
