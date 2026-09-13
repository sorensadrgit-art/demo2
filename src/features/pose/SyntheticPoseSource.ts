import {
  bboxOf, emptyLandmarks, LM,
  type NormalizedLandmark, type PoseDetection, type PoseFrame,
} from './poseTypes';
import type { IPoseProvider } from './PoseProvider';

/**
 * TEST-ONLY deterministic pose scenarios for headless E2E.
 *
 * Activation is deliberately narrow: `?e2ePose=synthetic` is honored ONLY in
 * dev builds or when VITE_E2E_MODE=true. Production builds ignore the query
 * entirely, so the MediaPipe webcam path stays the default everywhere real
 * therapists work.
 *
 * Synthetic detections enter the SAME downstream pipeline as real landmarks
 * (SubjectTracker → smoother → joint angles → plane/confidence →
 * focusMachine gates). Nothing is bypassed.
 */
export type E2EScenario = 'knee-flexion-full' | 'wrong-plane' | 'missing-knee' | 'trunk-lean' | 'therapist-crossing';

export const E2E_SCENARIOS: readonly E2EScenario[] = [
  'knee-flexion-full', 'wrong-plane', 'missing-knee', 'trunk-lean', 'therapist-crossing',
];

export function e2ePoseRequest(): { scenario: E2EScenario } | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('e2ePose') !== 'synthetic') return null;
  if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return null;
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E_MODE !== 'true') return null;
  const s = q.get('e2eScenario');
  const scenario = (E2E_SCENARIOS as readonly string[]).includes(s ?? '')
    ? (s as E2EScenario)
    : 'knee-flexion-full';
  return { scenario };
}

export interface KneePoseOpts {
  /** Left-knee flexion in degrees (0 = anatomical straight, interior 180°). */
  flexDeg: number;
  /** Half of the shoulder separation. Side view ~0.0675 (yaw ≈ 65°). */
  shoulderHalfWidth: number;
  /** Base landmark visibility. */
  vis: number;
  /** Nose x. Kept above the shoulder so the trunk-flex metric stays quiet. */
  noseX: number;
  /** Forward trunk shift applied during lean trials (trunk-flex evidence). */
  leanX: number;
  /** When true, left knee chain visibility is 0 (occlusion fixture). */
  missingKnee: boolean;
}

export const E2E_REST_POSE: KneePoseOpts = {
  flexDeg: 0, shoulderHalfWidth: 0.0675, vis: 0.95, noseX: 0.445, leanX: 0, missingKnee: false,
};

/** Cosine flexion profile 0 → peak → 0 over the step (smooth onset/offset). */
export function cosineFlex(elapsedMs: number, moveMs: number, peakDeg: number): number {
  const u = Math.min(1, Math.max(0, elapsedMs / moveMs));
  return peakDeg * (1 - Math.cos(2 * Math.PI * u)) / 2;
}

/**
 * Deterministic side-view standing pose with a flexing LEFT knee.
 * Hip–knee–ankle are collinear at rest (interior 180°); flexion swings the
 * ankle posteriorly so interior angle = 180° − flexDeg. Framing, calibration
 * span and shoulder geometry satisfy every positioning gate for sagittal
 * protocols; only the scenario variant decides whether they should.
 */
export function buildKneeFlexionPose(o: KneePoseOpts): NormalizedLandmark[] {
  const lms = emptyLandmarks();
  const P = (i: number, x: number, y: number, v = o.vis) => {
    lms[i] = { x, y, z: 0, visibility: v, presence: v };
  };
  const lean = o.leanX;
  // Head. At rest the nose sits above the shoulders (trunk-flex baseline
  // quiet); `lean` protracts the rigid head forward/down around fixed
  // shoulders — the stimulus the hip–shoulder–nose trunk-flexion metric
  // reads. lean=0.06 targets ~32° deviation (rule threshold 25°).
  P(LM.nose, o.noseX + lean * 0.75, 0.12 + lean * 0.25);
  P(LM.leftEye, o.noseX - 0.01 + lean * 0.75, 0.10 + lean * 0.25);
  P(LM.rightEye, o.noseX + 0.01 + lean * 0.75, 0.10 + lean * 0.25);
  P(LM.leftEar, o.noseX - 0.02 + lean * 0.75, 0.11 + lean * 0.25);
  P(LM.rightEar, o.noseX + 0.02 + lean * 0.75, 0.11 + lean * 0.25);
  // Torso (fixed: the lean stimulus is head protraction alone, so the
  // positioning gates see the same torso geometry as a clean trial).
  const shLx = 0.5 - o.shoulderHalfWidth;
  const shRx = 0.5 + o.shoulderHalfWidth;
  P(LM.leftShoulder, shLx, 0.24);
  P(LM.rightShoulder, shRx, 0.24);
  P(LM.leftHip, 0.44, 0.34);
  P(LM.rightHip, 0.56, 0.34);
  // Arms hang static.
  P(LM.leftElbow, shLx, 0.40); P(LM.rightElbow, shRx, 0.40);
  P(LM.leftWrist, shLx, 0.55); P(LM.rightWrist, shRx, 0.55);
  P(LM.leftIndex, shLx, 0.58); P(LM.rightIndex, shRx, 0.58);
  P(LM.leftPinky, shLx - 0.01, 0.57); P(LM.rightPinky, shRx + 0.01, 0.57);
  P(LM.leftThumb, shLx + 0.01, 0.55); P(LM.rightThumb, shRx - 0.01, 0.55);
  P(LM.mouthLeft, o.noseX - 0.01 + lean * 0.75, 0.14 + lean * 0.25);
  P(LM.mouthRight, o.noseX + 0.01 + lean * 0.75, 0.14 + lean * 0.25);
  // Left leg: flexion arc around a fixed knee.
  const phi = (Math.min(125, Math.max(0, o.flexDeg)) * Math.PI) / 180;
  const kx = 0.44; const ky = 0.60; const L2 = 0.26;
  const kv = o.missingKnee ? 0 : o.vis;
  P(LM.leftKnee, kx, ky, kv);
  P(LM.leftAnkle, kx - L2 * Math.sin(phi), ky + L2 * Math.cos(phi), kv);
  P(LM.leftHeel, kx - L2 * Math.sin(phi) - 0.02, ky + L2 * Math.cos(phi) + 0.02, kv);
  P(LM.leftFootIndex, kx - L2 * Math.sin(phi) + 0.02, ky + L2 * Math.cos(phi) + 0.02, kv);
  // Right leg: static straight reference.
  P(LM.rightKnee, 0.56, 0.60);
  P(LM.rightAnkle, 0.56, 0.86);
  P(LM.rightHeel, 0.54, 0.88);
  P(LM.rightFootIndex, 0.58, 0.88);
  return lms;
}

export interface E2ETrialSpec {
  peakFlexDeg: number;
  moveMs: number;
  vis: number;
  leanX: number;
}

type Step =
  | { kind: 'rest'; ms: number; pose: KneePoseOpts }
  | { kind: 'flex'; ms: number; spec: E2ETrialSpec }
  | { kind: 'wait'; want: string; timeoutMs: number; pose: KneePoseOpts }
  | { kind: 'trial'; index: number; spec: E2ETrialSpec }
  | { kind: 'crossing-trial'; index: number; spec: E2ETrialSpec };

const WAIT_READY_TIMEOUT = 120000;

function fullScript(trials: E2ETrialSpec[]): Step[] {
  // Per-trial: rest at neutral; when the orchestrator ENTERS ready the
  // scripted flexion plays (repeat until onset fires — the UI needs ~20s of
  // countdown+acquiring before its first ready, far longer than any fixed
  // rest); then rest at neutral while the trial records and completes.
  // Motion itself triggers automatic onset → recording → completion.
  const steps: Step[] = [{ kind: 'rest', ms: 3000, pose: E2E_REST_POSE }];
  trials.forEach((spec, i) => {
    steps.push({ kind: 'wait', want: `enter-ready:${i}`, timeoutMs: WAIT_READY_TIMEOUT, pose: E2E_REST_POSE });
    steps.push({ kind: 'trial', index: i, spec });
    steps.push({ kind: 'rest', ms: 8000, pose: E2E_REST_POSE });
  });
  steps.push({ kind: 'wait', want: 'done', timeoutMs: 120000, pose: E2E_REST_POSE });
  steps.push({ kind: 'rest', ms: Number.POSITIVE_INFINITY, pose: E2E_REST_POSE });
  return steps;
}

const CLEAN_TRIALS: E2ETrialSpec[] = [
  { peakFlexDeg: 112, moveMs: 5000, vis: 0.95, leanX: 0 },
  { peakFlexDeg: 119, moveMs: 8000, vis: 0.98, leanX: 0 },
  { peakFlexDeg: 116, moveMs: 5000, vis: 0.94, leanX: 0 },
];

const LEAN_TRIALS: E2ETrialSpec[] = CLEAN_TRIALS.map((t) => ({ ...t, leanX: 0.06 }));

export const SCENARIO_SCRIPTS: Record<E2EScenario, Step[]> = {
  'knee-flexion-full': fullScript(CLEAN_TRIALS),
  'trunk-lean': fullScript(LEAN_TRIALS),
  // Dual-person acceptance: ONE trial. The therapist enters during the
  // rest beat, crosses THROUGH the patient mid-trial (brief occlusion),
  // then exits. The orchestrator must complete the trial on the ORIGINAL
  // patient with zero clicks and zero identity switch.
  'therapist-crossing': [
    { kind: 'rest', ms: 3000, pose: E2E_REST_POSE },
    { kind: 'wait', want: 'enter-ready:0', timeoutMs: WAIT_READY_TIMEOUT, pose: E2E_REST_POSE },
    { kind: 'crossing-trial', index: 0, spec: CLEAN_TRIALS[1] },
    { kind: 'rest', ms: 8000, pose: E2E_REST_POSE },
    { kind: 'wait', want: 'done', timeoutMs: 120000, pose: E2E_REST_POSE },
    { kind: 'rest', ms: Number.POSITIVE_INFINITY, pose: E2E_REST_POSE },
  ],
  'wrong-plane': [
    {
      kind: 'rest', ms: Number.POSITIVE_INFINITY,
      pose: { ...E2E_REST_POSE, shoulderHalfWidth: 0.16 },
    },
  ],
  'missing-knee': [
    {
      kind: 'rest', ms: Number.POSITIVE_INFINITY,
      pose: { ...E2E_REST_POSE, missingKnee: true },
    },
  ],
};

export class SyntheticPoseSource implements IPoseProvider {
  readonly name = 'SyntheticPoseSource (E2E TEST ONLY)';
  readonly trackingMode = 'single' as const;
  private t0: number | null = null;
  private lastT = 0;
  private stepIdx = 0;
  private stepElapsed = 0;
  private gate: (() => string) | null = null;
  private lastGate = '';

  constructor(readonly scenario: E2EScenario) {}

  /** Orchestration reader (e.g. "ready:1") so motion waits for the UI. */
  setGateReader(fn: (() => string) | null) { this.gate = fn; }

  async initialize(): Promise<void> { /* deterministic: nothing to load */ }

  setOptions(): void { /* fixed fixture */ }

  async close(): Promise<void> { this.reset(); }

  reset() {
    this.t0 = null; this.lastT = 0; this.stepIdx = 0; this.stepElapsed = 0;
  }

  private steps(): Step[] { return SCENARIO_SCRIPTS[this.scenario]; }

  private advance(dtMs: number) {
    const steps = this.steps();
    const gate = this.gate?.() ?? '';
    this.lastGate = gate;
    // `enter-ready:i` fires while the orchestrator holds ready for trial i.
    // Level (not edge) semantics: the UI phase outlasts script frames by
    // orders of magnitude, and the script routinely arrives AFTER the
    // transition (e.g. trial-complete auto-advances to the next ready during
    // the post-trial rest), so an edge-only check would stall to timeout.
    const entered = (want: string): boolean => {
      const m = /^enter-ready:(\d+)$/.exec(want);
      if (!m) return gate === want;
      return gate === `ready:${m[1]}`;
    };
    let guard = 0;
    while (guard++ < 8) {
      const step = steps[Math.min(this.stepIdx, steps.length - 1)];
      if (step.kind === 'wait') {
        if (entered(step.want)) { this.stepIdx += 1; this.stepElapsed = 0; continue; }
        this.stepElapsed += dtMs;
        if (this.stepElapsed >= step.timeoutMs) { this.stepIdx += 1; this.stepElapsed = 0; continue; }
        return;
      }
      if (step.kind === 'trial') {
        // Keep playing flexion cycles until trial `index` is banked: stay
        // while the orchestrator works on index i (ready / ready-next /
        // recording / validating — including retakes after an invalid
        // trial), exit once it moves on (trial-complete, next ready, done).
        const m = /^(ready|ready-next|recording|validating):(\d+)$/.exec(gate);
        const onMine = m !== null && Number(m[2]) === step.index;
        if (!onMine) { this.stepIdx += 1; this.stepElapsed = 0; continue; }
        this.stepElapsed += dtMs;
        return;
      }
      if (step.kind === 'crossing-trial') {
        // Same exit semantics as a trial; the pose (with therapist) is
        // composed in posesAt(). A single trial keeps the acceptance fast.
        const m = /^(ready|ready-next|recording|validating):(\d+)$/.exec(gate);
        const onMine = m !== null && Number(m[2]) === step.index;
        if (!onMine) { this.stepIdx += 1; this.stepElapsed = 0; continue; }
        this.stepElapsed += dtMs;
        return;
      }
      this.stepElapsed += dtMs;
      if (this.stepElapsed >= step.ms) { this.stepIdx += 1; this.stepElapsed = 0; continue; }
      return;
    }
  }

  private poseAt(): NormalizedLandmark[] {
    const steps = this.steps();
    const step = steps[Math.min(this.stepIdx, steps.length - 1)];
    if (step.kind === 'flex') {
      const flex = cosineFlex(this.stepElapsed, step.ms, step.spec.peakFlexDeg);
      return buildKneeFlexionPose({
        ...E2E_REST_POSE,
        flexDeg: flex, vis: step.spec.vis, leanX: step.spec.leanX,
      });
    }
    if (step.kind === 'trial' || step.kind === 'crossing-trial') {
      // Repeating cosine with a neutral beat: motion restarts cleanly each
      // cycle so onset always sees a fresh excursion from rest.
      // (crossing-trial composes its dual-person frame in detections().)
      const t = this.stepElapsed % (step.spec.moveMs + 1200);
      const flex = t < step.spec.moveMs ? cosineFlex(t, step.spec.moveMs, step.spec.peakFlexDeg) : 0;
      return buildKneeFlexionPose({
        ...E2E_REST_POSE,
        flexDeg: flex, vis: step.spec.vis, leanX: step.spec.leanX,
      });
    }
    if (step.kind === 'rest' || step.kind === 'wait') return buildKneeFlexionPose(step.pose);
    // Unreachable: 'flex' handled above; kept for exhaustiveness.
    return buildKneeFlexionPose(E2E_REST_POSE);
  }

  /**
   * Full detection list for this frame. Single-person scenarios return one
   * detection; the crossing scenario returns patient + therapist (with an
   * occlusion envelope collapsing the patient's visibility mid-crossing).
   */
  detections(now: number): PoseDetection[] {
    if (this.t0 === null) { this.t0 = now; this.lastT = now; }
    const dt = Math.min(200, Math.max(0, now - this.lastT));
    this.lastT = now;
    this.advance(dt);
    const steps = this.steps();
    const step = steps[Math.min(this.stepIdx, steps.length - 1)];
    if (step.kind === 'crossing-trial') {
      // Choreography over the trial dwell: patient flexes on the repeating
      // cosine; the therapist walks through once across the whole dwell.
      const cycle = step.spec.moveMs + 1200;
      const rep = Math.floor(this.stepElapsed / cycle);
      const t = this.stepElapsed % cycle;
      const flex = t < step.spec.moveMs ? cosineFlex(t, step.spec.moveMs, step.spec.peakFlexDeg) : 0;
      const crossT = Math.min(1, this.stepElapsed / Math.max(1, step.spec.moveMs * 2 + 2400));
      const occ = crossingOcclusion(crossT);
      const patient = buildKneeFlexionPose({ ...E2E_REST_POSE, flexDeg: flex, vis: step.spec.vis });
      if (occ > 0) {
        // Therapist body blocks the camera: collapse the knee-chain + hip
        // visibility proportionally (downstream suspends, never switches).
        const occIdx = [LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex, LM.leftHip, LM.rightHip];
        for (const i of occIdx) {
          const v = Math.max(0.03, step.spec.vis * (1 - occ));
          patient[i] = { ...patient[i], visibility: v, presence: v };
        }
      }
      void rep;
      return [
        { landmarks: patient, score: 0.92 * (1 - occ * 0.5), bbox: bboxOf(patient), timestamp: now },
        {
          landmarks: buildTherapistPose(crossT, 7), score: 0.95,
          bbox: bboxOf(buildTherapistPose(crossT, 7)), timestamp: now,
        },
      ];
    }
    return [this.detection(now)];
  }

  detection(now: number): PoseDetection {
    if (this.t0 === null) { this.t0 = now; this.lastT = now; }
    const dt = Math.min(200, Math.max(0, now - this.lastT));
    this.lastT = now;
    this.advance(dt);
    const landmarks = this.poseAt();
    return { landmarks, score: 0.92, bbox: bboxOf(landmarks), timestamp: now };
  }

  async detect(
    _video: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    timestampMs: number,
  ): Promise<PoseFrame> {
    return { timestamp: timestampMs, width: 1280, height: 720, detections: [this.detection(timestampMs)] };
  }
}

/**
 * Deterministic therapist body for the dual-person acceptance fixture: a
 * genuinely different body (taller torso, wider shoulders, distinct gait
 * phase) walking left → right. `crossT` 0..1 spans the crossing; near 0.5
 * the therapist occludes the patient.
 */
export function buildTherapistPose(crossT: number, seed = 0): NormalizedLandmark[] {
  const lms = emptyLandmarks();
  const P = (i: number, x: number, y: number, v = 0.93) => {
    lms[i] = { x, y, z: 0, visibility: v, presence: v };
  };
  const cx = 0.18 + crossT * 0.68 + Math.sin(seed * 1.7 + crossT * 9) * 0.006;
  const step = Math.sin(seed * 2.3 + crossT * 12) * 0.05;
  P(LM.nose, cx, 0.07);
  P(LM.leftEye, cx - 0.012, 0.055); P(LM.rightEye, cx + 0.012, 0.055);
  P(LM.leftEar, cx - 0.022, 0.062); P(LM.rightEar, cx + 0.022, 0.062);
  P(LM.leftShoulder, cx - 0.085, 0.20); P(LM.rightShoulder, cx + 0.085, 0.20);
  P(LM.leftHip, cx - 0.055, 0.42); P(LM.rightHip, cx + 0.055, 0.42);
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

/** Occlusion envelope: 1 at mid-crossing, 0 at the edges. */
export function crossingOcclusion(crossT: number): number {
  const d = Math.abs(crossT - 0.5);
  return d >= 0.14 ? 0 : 1 - d / 0.14;
}

let cached: { key: string; src: SyntheticPoseSource } | null = null;

/** Singleton test source, or null in normal operation. */
export function getE2EPoseSource(): SyntheticPoseSource | null {
  const req = e2ePoseRequest();
  if (!req) return null;
  if (!cached || cached.key !== req.scenario) {
    cached = { key: req.scenario, src: new SyntheticPoseSource(req.scenario) };
  }
  return cached.src;
}
