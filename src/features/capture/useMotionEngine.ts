import { useEffect, useRef } from 'react';
import { MediaPipePoseProvider } from '../pose/MediaPipePoseProvider';
import { getE2EPoseSource } from '../pose/SyntheticPoseSource';
import { useFocus } from '../focus/focusStore';
import { SubjectTracker } from '../tracking/subjectTracker';
import { LandmarkSmoother } from '../../lib/math/oneEuroFilter';
import { computeAllJointAngles, JOINT_DEFS, type JointId } from '../biomechanics/jointAngles';
import { angularVelocity, angularAcceleration } from '../biomechanics/angularVelocity';
import { RepetitionDetector } from '../movement/repetitionDetector';
import { PhaseDetector } from '../movement/phaseDetector';
import { detectCompensations } from '../movement/compensationEngine';
import { estimateKneeMoment, estimateLoadingDistribution } from '../kinetics/estimatedKinetics';
import {
  KNEE_FLEXION_CONVENTION,
  ELBOW_FLEXION_CONVENTION,
  HIP_FLEXION_CONVENTION,
  SHOULDER_FLEXION_CONVENTION,
  computeScreenPlaneAngle,
  type ClinicalConvention,
} from '../solo/clinicalAngle';
import { classifySoloView, matchRequiredView, type RequiredView } from '../solo/viewClassifier';
import { assessFraming } from '../solo/framing';
import { assessSoloQuality } from '../solo/qualityEngine';
import { coachCue, type SuspensionReason } from '../solo/suspension';
import { sessionClock } from '../../lib/timing/timeSync';
import { perfMonitor } from '../../lib/performance/perf';
import { frameStore, updateFrame } from '../visualization/frameStore';
import { useSession } from '../../stores/sessionStore';
import { LM, type NormalizedLandmark, type PoseDetection } from '../pose/poseTypes';

export interface EngineRefs {
  video: HTMLVideoElement | null;
  provider: MediaPipePoseProvider | null;
  e2eSource: { name: string } | null;
  tracker: SubjectTracker;
  running: boolean;
  ready: boolean;
  error: string | null;
  demoMode: boolean;
  demoT: number;
}

export const engineRefs: EngineRefs = {
  video: null, provider: null, e2eSource: null, tracker: new SubjectTracker(),
  running: false, ready: false, error: null, demoMode: false, demoT: 0,
};

const smoother = new LandmarkSmoother(33);
const repDetector = new RepetitionDetector();
const phaseDetector = new PhaseDetector();
const angleHistory = new Map<string, Array<{ t: number; angle: number }>>();
const velHistory = new Map<string, Array<{ t: number; vel: number }>>();
const posHistory = new Map<number, { x: number; y: number; t: number }>();

/**
 * Dev/E2E-only identity observability (never in production): the dual-person
 * acceptance test reads active-patient continuity without touching product
 * state. Production builds leave window.__kinelabIdentity unset.
 */
export interface IdentityProbe {
  activeId: number | null;
  state: string;
  idSwitches: number;
  samples: number;
}
function e2eIdentityHook(activeId: number | null, state: string, idSwitches: number) {
  if (typeof window === 'undefined') return;
  if (import.meta.env.PROD && import.meta.env.VITE_E2E_MODE !== 'true') return;
  const w = window as unknown as { __kinelabIdentity?: IdentityProbe };
  const prev = w.__kinelabIdentity;
  w.__kinelabIdentity = {
    activeId, state, idSwitches, samples: (prev?.samples ?? 0) + 1,
  };
}

/** Read the current identity probe (tests only; null in production). */
export function readIdentityProbe(): IdentityProbe | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __kinelabIdentity?: IdentityProbe }).__kinelabIdentity ?? null;
}

function demoLandmarks(t: number): NormalizedLandmark[] {
  // Synthetic squat-like motion for environments without a camera/model.
  const ph = (t / 2600) * Math.PI * 2;
  const flex = (Math.sin(ph - Math.PI / 2) + 1) / 2; // 0..1
  const L = (x: number, y: number, v = 0.95): NormalizedLandmark => ({ x, y, z: 0, visibility: v, presence: v });
  const kneeY = 0.52 + flex * 0.1;
  const hipY = 0.34 + flex * 0.16;
  const mk = (s: number): NormalizedLandmark[] => [
    L(0.5, 0.12), L(0.48, 0.13), L(0.47, 0.14), L(0.46, 0.14), L(0.52, 0.13), L(0.53, 0.14), L(0.54, 0.14),
    L(0.45, 0.15), L(0.55, 0.15), L(0.48, 0.18), L(0.52, 0.18),
    L(0.38 * s, 0.24), L(0.62 * s + (1 - s) * 0.5, 0.24),
    L(0.34 * s, 0.4), L(0.66 * s + (1 - s) * 0.5, 0.4),
    L(0.32 * s, 0.55), L(0.68 * s + (1 - s) * 0.5, 0.55),
    L(0.3 * s, 0.6), L(0.7 * s + (1 - s) * 0.5, 0.6),
    L(0.31 * s, 0.57), L(0.69 * s + (1 - s) * 0.5, 0.57),
    L(0.31 * s, 0.53), L(0.69 * s + (1 - s) * 0.5, 0.53),
    L(0.44, hipY), L(0.56, hipY),
    L(0.44 - flex * 0.03, kneeY), L(0.56 + flex * 0.03, kneeY),
    L(0.44 - flex * 0.02, 0.86), L(0.56 + flex * 0.02, 0.86),
    L(0.42, 0.88), L(0.58, 0.88),
    L(0.46 - flex * 0.02, 0.9), L(0.54 + flex * 0.02, 0.9),
  ];
  return mk(1);
}

function conventionForJoint(joint: JointId): ClinicalConvention {
  if (joint === 'leftKnee' || joint === 'rightKnee') return KNEE_FLEXION_CONVENTION;
  if (joint === 'leftElbow' || joint === 'rightElbow') return ELBOW_FLEXION_CONVENTION;
  if (joint === 'leftHipFlex' || joint === 'rightHipFlex') return HIP_FLEXION_CONVENTION;
  if (joint === 'leftShoulderFlex' || joint === 'rightShoulderFlex') return SHOULDER_FLEXION_CONVENTION;
  return { id: 'screen-plane-interior', kind: 'interior', unit: 'deg' };
}

function requiredViewFor(joint: JointId, cameraPlane: 'sagittal' | 'frontal'): RequiredView {
  // Solo V6.3: side-specific sagittal for knees; frontal for abduction
  // protocols when the session plane is frontal.
  if (cameraPlane === 'frontal') return 'FRONTAL';
  if (joint === 'leftKnee') return 'LEFT_SAGITTAL';
  if (joint === 'rightKnee') return 'RIGHT_SAGITTAL';
  if (joint.startsWith('left')) return 'LEFT_SAGITTAL';
  if (joint.startsWith('right')) return 'RIGHT_SAGITTAL';
  return 'SAGITTAL';
}

function framingSideFor(joint: JointId, affectedSide: string): 'left' | 'right' {
  if (joint.toLowerCase().startsWith('left')) return 'left';
  if (joint.toLowerCase().startsWith('right')) return 'right';
  if (affectedSide === 'right') return 'right';
  return 'left';
}

function suspensionForIdentity(
  state: string,
  cue: string | null,
  candidateCount: number,
): SuspensionReason {
  if (state === 'unselected') return 'NO_SUBJECT_SELECTED';
  if (cue === 'clear-area' || candidateCount > 1) return 'PATIENT_IDENTITY_AMBIGUOUS';
  if (state === 'lost' || state === 'reacquiring') return 'PATIENT_IDENTITY_AMBIGUOUS';
  return 'TARGET_NOT_VISIBLE';
}

/** Core pipeline: raw → gate → associate → smooth → solo screen-plane angles → view/framing/quality → store. */
export function processDetections(detections: PoseDetection[], now: number) {
  const st = useSession.getState();
  const track = engineRefs.tracker.update(detections, now);
  const active = track.active;
  st.set({ trackingState: track.state, activeSubjectId: track.activeId });

  updateFrame({ tracking: track.state, candidates: track.candidates });

  if (!active) {
    updateFrame({ landmarks: null, level: 'suspended' });
    const suspension = suspensionForIdentity(track.state, track.cue ?? null, track.candidates.length);
    const coach = coachCue(suspension);
    st.set({
      liveAngle: NaN,
      liveVel: NaN,
      liveLevel: 'suspended',
      liveReasons: [suspension],
      liveRawAngle: NaN,
      liveFilteredAngle: NaN,
      soloView: 'UNKNOWN',
      soloViewQuality: 'VIEW_INVALID',
      soloQualityState: 'SUSPENDED',
      soloSuspension: suspension,
      soloCoach: coach,
    });
    e2eIdentityHook(track.activeId, track.state, track.idSwitches);
    return;
  }
  e2eIdentityHook(track.activeId, track.state, track.idSwitches);

  // Temporal smoothing (One Euro) on the active subject. Raw is preserved;
  // filtered never overwrites raw.
  const rawLms: NormalizedLandmark[] = active.landmarks;
  const flat: number[] = [];
  for (const l of rawLms) flat.push(l.x, l.y, l.z);
  const smoothed = smoother.smooth(flat, now / 1000);
  const lms: NormalizedLandmark[] = rawLms.map((l, i) => ({
    x: smoothed[i * 3], y: smoothed[i * 3 + 1], z: smoothed[i * 3 + 2],
    visibility: l.visibility, presence: l.presence,
  }));

  const joint = st.activeJoint;
  const def = JOINT_DEFS[joint];
  const convention = conventionForJoint(joint);
  const [proximal, apex, distal] = def.triple;

  // RAW from unsmoothed landmarks, FILTERED from One Euro landmarks.
  const rawAngle = computeScreenPlaneAngle(rawLms, proximal, apex, distal, convention);
  const filtAngle = computeScreenPlaneAngle(lms, proximal, apex, distal, convention);
  const rawClinical = rawAngle.clinicalDeg;
  const filtClinical = filtAngle.clinicalDeg;
  const rawJitterDeg = Number.isFinite(rawClinical) && Number.isFinite(filtClinical)
    ? Math.abs(rawClinical - filtClinical)
    : 0;

  // View classification + protocol match.
  const classified = classifySoloView(lms);
  const required = requiredViewFor(joint, st.session.cameraPlane);
  const matched = matchRequiredView(classified, required, 'moderate');
  const requiredYawDeg = required === 'FRONTAL' ? 0 : 90;

  // Framing on the filtered landmarks.
  const side = framingSideFor(joint, st.session.affectedSide);
  const camMeta = st.cameraMeta;
  const frameW = camMeta.width > 0 ? camMeta.width
    : engineRefs.video?.videoWidth && engineRefs.video.videoWidth > 0 ? engineRefs.video.videoWidth : 1280;
  const frameH = camMeta.height > 0 ? camMeta.height
    : engineRefs.video?.videoHeight && engineRefs.video.videoHeight > 0 ? engineRefs.video.videoHeight : 720;
  const framing = assessFraming(lms, side, frameW, frameH);

  const identityAmbiguous = track.cue === 'clear-area'
    || (detections.length > 1 && track.state !== 'locked');
  const soloQuality = assessSoloQuality({
    viewQuality: matched.quality,
    framing,
    landmarkVisibility: filtAngle.visibility,
    poseScore: active.score,
    trackingContinuity: engineRefs.tracker.continuity,
    identityState: track.state,
    identityAmbiguous,
    cameraLost: false,
    frameRate: camMeta.fps > 0 ? camMeta.fps : 30,
    yawProxyDeg: classified.yawProxyDeg,
    requiredYawDeg,
    rawJitterDeg,
  });
  // Hard guarantee: Solo never publishes 'high' (reserved for multi-view).
  const soloLevel = soloQuality.level === 'suspended' ? 'suspended'
    : soloQuality.level === ('high' as string) ? 'moderate' : soloQuality.level;

  const suspended = soloQuality.state === 'SUSPENDED';
  const liveAngle = suspended ? NaN : filtClinical;

  // Velocity from the filtered clinical angle history.
  let hist = angleHistory.get(joint);
  if (!hist) { hist = []; angleHistory.set(joint, hist); }
  if (!suspended && Number.isFinite(filtClinical)) {
    hist.push({ t: now, angle: filtClinical });
    if (hist.length > 40) hist.shift();
  }
  const vel = angularVelocity(hist, hist.length - 1, 2);
  let vh = velHistory.get(joint);
  if (!vh) { vh = []; velHistory.set(joint, vh); }
  vh.push({ t: now, vel: Number.isFinite(vel) ? vel : 0 });
  if (vh.length > 40) vh.shift();
  const acc = angularAcceleration(vh, vh.length - 1, 2);
  void acc;

  const all = computeAllJointAngles(lms);
  const angles: Record<string, number> = {};
  const valid: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(all)) {
    angles[k] = v.angle;
    valid[k] = v.valid && !suspended;
  }
  // Publish the clinical filtered angle for the active joint.
  angles[joint] = filtClinical;
  valid[joint] = !suspended && filtAngle.valid;
  updateFrame({ landmarks: lms, angles, valid, level: soloLevel, activeJoint: joint });

  // Trails + COM + vectors bookkeeping.
  if (lms[LM.leftAnkle] && lms[LM.rightAnkle]) {
    const com = {
      x: (lms[LM.leftHip].x + lms[LM.rightHip].x + lms[LM.leftShoulder].x + lms[LM.rightShoulder].x) / 4,
      y: (lms[LM.leftHip].y + lms[LM.rightHip].y + lms[LM.leftShoulder].y + lms[LM.rightShoulder].y) / 4,
    };
    updateFrame({ com });
  }
  const vIdx = [LM.leftWrist, LM.rightWrist, LM.leftAnkle, LM.rightAnkle, LM.leftKnee, LM.rightKnee];
  for (const idx of vIdx) {
    const prev = posHistory.get(idx);
    const cur = lms[idx];
    if (prev && cur) {
      const dt = Math.max(1, now - prev.t) / 1000;
      const v = { x: (cur.x - prev.x) / dt, y: (cur.y - prev.y) / dt };
      (frameStore as { velocities?: Map<number, { x: number; y: number }> }).velocities ??= new Map();
      (frameStore as { velocities?: Map<number, { x: number; y: number }> }).velocities!.set(idx, v);
    }
    if (cur) posHistory.set(idx, { x: cur.x, y: cur.y, t: now });
  }
  const ankleIdx = joint.includes('Knee') || joint.includes('Hip')
    ? (joint.startsWith('left') ? LM.leftAnkle : LM.rightAnkle)
    : LM.leftWrist;
  const trail = frameStore.trails.get(ankleIdx) ?? [];
  const ap = lms[ankleIdx];
  if (ap && ap.visibility > 0.3) {
    trail.push({ x: ap.x, y: ap.y });
    if (trail.length > 45) trail.shift();
    frameStore.trails.set(ankleIdx, trail);
  }

  // Movement events on the primary joint (clinical filtered angle).
  const filtValid = filtAngle.valid && Number.isFinite(filtClinical);
  if (!suspended && filtValid && st.session.movementId === 'squat') {
    const rep = repDetector.push(now, filtClinical, vel, true);
    if (rep) st.set({ repCount: rep.index });
  }
  phaseDetector.push(now, filtValid && !suspended ? filtClinical : 0, vel);

  // Compensation evidence (squat-oriented, generic-safe).
  const trunkLat = all.trunkLateral.valid ? 180 - all.trunkLateral.angle : NaN;
  if (!suspended && Number.isFinite(trunkLat)) {
    const flags = detectCompensations({
      trunkLateralDeg: Math.abs(trunkLat) > 90 ? 180 - Math.abs(trunkLat) : trunkLat,
      trunkFlexDeg: all.trunkFlex.valid ? 180 - all.trunkFlex.angle : NaN,
      leftKneeDeg: all.leftKnee.valid ? all.leftKnee.angle : NaN,
      rightKneeDeg: all.rightKnee.valid ? all.rightKnee.angle : NaN,
      leftHipDeg: all.leftHipFlex.valid ? all.leftHipFlex.angle : NaN,
      rightHipDeg: all.rightHipFlex.valid ? all.rightHipFlex.angle : NaN,
      pelvisShiftNorm: NaN,
      trunkValid: all.trunkLateral.valid,
      kneeValid: all.leftKnee.valid && all.rightKnee.valid,
      t: now,
    });
    if (flags.length) {
      // Deduplicate: one active flag per rule — refresh the existing entry
      // instead of appending an identical alert every frame.
      const next = [...st.compensations];
      for (const f of flags) {
        const i = next.findIndex((c) => c.id === f.id);
        if (i >= 0) next[i] = f;
        else next.push(f);
      }
      st.set({ compensations: next.slice(-20) });
    }
  }

  // Estimated kinetics (visually distinct downstream; never Newtons-measured).
  if (!suspended && filtValid && (joint === 'leftKnee' || joint === 'rightKnee')) {
    const mass = 74;
    const knee = estimateKneeMoment(now, filtClinical, vel, { bodyMassKg: mass, shankLengthM: 0.44, thighLengthM: 0.45, calibrated: st.calibQuality > 0.5 });
    const load = estimateLoadingDistribution(
      now,
      all.leftKnee.valid ? all.leftKnee.angle : NaN,
      all.rightKnee.valid ? all.rightKnee.angle : NaN,
    );
    st.set({ kineticSamples: [...st.kineticSamples.slice(-600), knee, load] });
  }

  // Live store: SUSPENDED never publishes a live number. Otherwise prefer
  // the clinical filtered angle for display. Raw is preserved separately.
  const coach = coachCue(soloQuality.suspension) ?? framing.cue ?? null;
  st.set({
    liveAngle,
    liveVel: suspended ? NaN : vel,
    liveLevel: soloLevel,
    liveReasons: soloQuality.reasons,
    liveRawAngle: rawClinical,
    liveFilteredAngle: filtClinical,
    soloView: classified.view,
    soloViewQuality: matched.quality,
    soloQualityState: soloQuality.state,
    soloSuspension: soloQuality.suspension,
    soloCoach: coach,
  });
  st.pushSample({ t: now, angles, vel: { [joint]: vel } as never, confidence: soloQuality.score, level: soloLevel, valid: valid as never });
}

/** React hook that owns the capture loop (webcam or demo synthesis). */
export function useMotionEngine(videoRef: React.RefObject<HTMLVideoElement | null>, _canvasRef?: React.RefObject<HTMLCanvasElement | null>) {
  void _canvasRef;
  const raf = useRef(0);
  const lastInfer = useRef(0);
  const e2eRef = useRef<{ detection: (now: number) => import('../pose/poseTypes').PoseDetection; detections?: (now: number) => import('../pose/poseTypes').PoseDetection[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionClock.start();

    const loop = async () => {
      if (cancelled) return;
      const now = sessionClock.now();
      const t0 = performance.now();
      try {
        const e2eList = e2eRef.current?.detections?.(now);
        if (e2eList) {
          processDetections(e2eList, now);
          perfMonitor.markInference();
        } else {
          const e2e = e2eRef.current?.detection(now);
          if (e2e) {
            processDetections([e2e], now);
            perfMonitor.markInference();
          } else if (engineRefs.demoMode) {
            engineRefs.demoT = now;
            const lms = demoLandmarks(now);
            const det: PoseDetection = {
              landmarks: lms, score: 0.92,
              bbox: { x: 0.28, y: 0.08, w: 0.44, h: 0.84 },
              timestamp: now,
            };
            processDetections([det], now);
            perfMonitor.markInference();
          } else if (engineRefs.provider && engineRefs.video && engineRefs.video.readyState >= 2) {
            if (now - lastInfer.current > 66) { // ~15-30 Hz inference cap
              lastInfer.current = now;
              const frame = await engineRefs.provider.detect(engineRefs.video, now);
              perfMonitor.markInference();
              processDetections(frame.detections, now);
            }
          } else if (!engineRefs.provider && !engineRefs.demoMode) {
            // No provider yet — run demo synthesis so the lab is alive.
            engineRefs.demoMode = true;
          }
        }
      } catch (e) {
        engineRefs.error = e instanceof Error ? e.message : 'Inference failed';
        engineRefs.demoMode = true;
      }
      perfMonitor.markLatency(performance.now() - t0);
      perfMonitor.markRender();
      raf.current = requestAnimationFrame(loop);
    };

    const init = async () => {
      // TEST-ONLY path: honored only in dev builds or VITE_E2E_MODE=true.
      // Production builds ignore ?e2ePose entirely (see SyntheticPoseSource).
      const e2eSource = getE2EPoseSource();
      if (e2eSource) {
        e2eSource.setGateReader(() => {
          const f = useFocus.getState();
          if (f.phase === 'assessment-complete') return 'done';
          if ((f.phase === 'ready' || f.phase === 'ready-next') && f.trials.length <= f.trialIndex) {
            const tag = f.trials.length < f.trialIndex ? `ready:${f.trials.length}` : `ready:${f.trialIndex}`;
            return tag;
          }
          if (f.phase === 'recording' || f.phase === 'validating') {
            return `${f.phase}:${f.trialIndex}`;
          }
          return `${f.phase}:${f.trialIndex}`;
        });
        engineRefs.e2eSource = e2eSource;
        e2eRef.current = e2eSource;
        engineRefs.demoMode = false;
        engineRefs.ready = true;
        engineRefs.running = true;
        raf.current = requestAnimationFrame(loop);
        return;
      }
      try {
        const provider = new MediaPipePoseProvider();
        await provider.initialize({ numPoses: 3 });
        if (cancelled) return;
        engineRefs.provider = provider;
        engineRefs.ready = true;
      } catch {
        engineRefs.demoMode = true; // offline/CDN-blocked → synthetic subject
        engineRefs.ready = true;
      }
      engineRefs.running = true;
      raf.current = requestAnimationFrame(loop);
    };
    void init();

    // Identity release: the manager holds the sticky lock; React only mirrors
    // it. On assessment reset / deliberate patient change the lock is dropped.
    // (Previous index-0 instant-grab removed: acquisition is scored +
    // stability-gated inside PatientIdentityManager.)
    const identitySync = setInterval(() => {
      const f = useFocus.getState();
      if (f.phase === 'patient' || f.phase === 'assessment') {
        if (engineRefs.tracker.activePatientId !== null) {
          engineRefs.tracker.clearSelection();
          useSession.getState().set({ activeSubjectId: null });
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
      clearInterval(identitySync);
      engineRefs.running = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
