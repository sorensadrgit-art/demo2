import { create } from 'zustand';
import type { JointId } from '../features/biomechanics/jointAngles';
import type { ConfidenceLevel } from '../features/biomechanics/confidence';
import type { TrackingState } from '../features/tracking/subjectTracker';
import type { CompensationFlag } from '../features/movement/compensationEngine';
import type { ROMTrial } from '../features/rom/romEngine';
import type { EstimatedKineticSample, SensorSample } from '../features/kinetics/kineticsTypes';
import type { SoloViewClass, ViewQuality } from '../features/solo/viewClassifier';
import type { SoloQualityState } from '../features/solo/qualityEngine';
import type { SuspensionReason } from '../features/solo/suspension';

export type SourceMode = 'webcam' | 'upload' | 'multicam' | 'demo';
export type AppMode = 'focus' | 'measure' | 'goniometer' | 'symmetry' | 'analysis3d' | 'report' | 'progress';

export interface MetricSample {
  t: number;
  angles: Partial<Record<JointId, number>>;
  vel: Partial<Record<JointId, number>>;
  confidence: number;
  level: ConfidenceLevel;
  valid: Partial<Record<JointId, boolean>>;
}

export interface SessionMeta {
  patientId: string;
  movementId: string;
  cameraPlane: 'sagittal' | 'frontal';
  affectedSide: 'left' | 'right' | 'bilateral' | 'na';
  startedAt: number;
}

export interface CameraMeta {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
}

interface SessionState {
  sourceMode: SourceMode;
  appMode: AppMode;
  activeJoint: JointId;
  activeSubjectId: number | null;
  trackingState: TrackingState;
  session: SessionMeta;
  liveAngle: number;
  liveVel: number;
  liveLevel: ConfidenceLevel;
  liveReasons: string[];
  /** Solo V6.3: unsmoothed screen-plane clinical angle (never overwritten by filter). */
  liveRawAngle: number;
  /** Solo V6.3: One Euro filtered screen-plane clinical angle. */
  liveFilteredAngle: number;
  /** Solo V6.3 view / quality wiring (single RGB camera only). */
  soloView: SoloViewClass;
  soloViewQuality: ViewQuality;
  soloQualityState: SoloQualityState;
  soloSuspension: SuspensionReason | null;
  soloCoach: string | null;
  cameraMeta: CameraMeta;
  repCount: number;
  compensations: CompensationFlag[];
  trials: ROMTrial[];
  timeline: MetricSample[];
  scrubT: number | null;
  recording: boolean;
  recordStart: number | null;
  sensorSamples: SensorSample[];
  kineticSamples: EstimatedKineticSample[];
  calibQuality: number;
  set: (p: Partial<SessionState>) => void;
  pushSample: (s: MetricSample) => void;
  resetTimeline: () => void;
}

const MAX_TIMELINE = 60 * 60 * 10; // ~10 min at 60 Hz

export const useSession = create<SessionState>((set) => ({
  sourceMode: 'webcam',
  appMode: 'focus',
  activeJoint: 'leftKnee',
  activeSubjectId: null,
  trackingState: 'unselected',
  session: { patientId: 'PT-001', movementId: 'squat', cameraPlane: 'sagittal', affectedSide: 'left', startedAt: Date.now() },
  liveAngle: NaN,
  liveVel: NaN,
  liveLevel: 'suspended',
  liveReasons: ['NO_SUBJECT_SELECTED'],
  liveRawAngle: NaN,
  liveFilteredAngle: NaN,
  soloView: 'UNKNOWN',
  soloViewQuality: 'VIEW_INVALID',
  soloQualityState: 'SUSPENDED',
  soloSuspension: 'NO_SUBJECT_SELECTED',
  soloCoach: 'Step into the measurement position',
  cameraMeta: { id: '', label: '', width: 0, height: 0, fps: 0 },
  repCount: 0,
  compensations: [],
  trials: [],
  timeline: [],
  scrubT: null,
  recording: false,
  recordStart: null,
  sensorSamples: [],
  kineticSamples: [],
  calibQuality: 0,
  set: (p) => set(p),
  pushSample: (s) => set((st) => {
    const timeline = st.recording || true ? [...st.timeline, s] : st.timeline;
    return { timeline: timeline.length > MAX_TIMELINE ? timeline.slice(-MAX_TIMELINE) : timeline };
  }),
  resetTimeline: () => set({ timeline: [], repCount: 0, trials: [], compensations: [], kineticSamples: [], sensorSamples: [] }),
}));
