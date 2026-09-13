// Dedicated real-time frame store. Pose landmarks NEVER enter React state
// at 30-60 Hz; this mutable singleton feeds the canvas render loop directly.
import type { NormalizedLandmark } from '../pose/poseTypes';
import type { JointId } from '../biomechanics/jointAngles';
import type { ConfidenceLevel } from '../biomechanics/confidence';
import type { TrackingState } from '../tracking/subjectTracker';

export interface FrameData {
  landmarks: NormalizedLandmark[] | null;
  ghost: NormalizedLandmark[] | null;
  angles: Partial<Record<JointId, number>>;
  valid: Partial<Record<JointId, boolean>>;
  level: ConfidenceLevel;
  tracking: TrackingState;
  candidates: Array<{ id: number; bbox: { x: number; y: number; w: number; h: number } }>;
  activeJoint: JointId;
  trails: Map<number, Array<{ x: number; y: number }>>;
  com: { x: number; y: number } | null;
  scrubT: number | null;
  /**
   * Owner of the rendered angle overlay: the track id whose landmarks feed
   * the clinical overlay this frame, or null when nothing is rendered.
   * The canvas copies the active patient id here on every overlay draw;
   * tests assert overlayOwnerId === activePatientId during valid capture.
   */
  overlayOwnerId: number | null;
}

export const frameStore: FrameData = {
  landmarks: null,
  ghost: null,
  angles: {},
  valid: {},
  level: 'suspended',
  tracking: 'unselected',
  candidates: [],
  activeJoint: 'leftKnee',
  trails: new Map(),
  com: null,
  scrubT: null,
  overlayOwnerId: null,
};

export function updateFrame(p: Partial<FrameData>) {
  Object.assign(frameStore, p);
}
