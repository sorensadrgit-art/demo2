import { create } from 'zustand';
import type { JointId } from '../features/biomechanics/jointAngles';
import type { ConfidenceLevel } from '../features/biomechanics/confidence';
import type { TrackingState } from '../features/tracking/subjectTracker';
import type { CompensationFlag } from '../features/movement/compensationEngine';
import type { ROMTrial } from '../features/rom/romEngine';
import type { EstimatedKineticSample, SensorSample } from '../features/kinetics/kineticsTypes';

export type SourceMode = 'webcam' | 'upload' | 'multicam' | 'demo';
export type AppMode = 'measure' | 'goniometer' | 'symmetry' | 'analysis3d' | 'report' | 'progress';

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
  appMode: 'measure',
  activeJoint: 'leftKnee',
  activeSubjectId: null,
  trackingState: 'unselected',
  session: { patientId: 'PT-001', movementId: 'squat', cameraPlane: 'sagittal', affectedSide: 'left', startedAt: Date.now() },
  liveAngle: NaN,
  liveVel: NaN,
  liveLevel: 'suspended',
  liveReasons: ['NO SUBJECT SELECTED'],
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
