/**
 * KineLab measurement domain contracts (Clinical Measurement Core V1).
 *
 * Strong typed structures passed between capture → reconstruction →
 * biomechanics → quality → storage. Replaces anonymous number arrays
 * at system boundaries; every clinical value carries its acquisition
 * grade, source, confidence evidence, and provenance.
 *
 * IMPLEMENTATION MAP (Phase 0 audit → reuse decisions):
 *
 * capture (CameraCapture/VideoCapture/DeviceSelector/useMotionEngine)
 * → runs the live Solo pipeline today
 * → REUSED UNCHANGED for Solo; EXTENDED with rig/sync metadata only
 * → new dependency: capture/rig + reconstruction/sync types (this file)
 *
 * pose/MediaPipePoseProvider + pose/PoseProvider(IPoseProvider)
 * → realtime Solo inference + replaceable provider seam
 * → REUSED UNCHANGED; EXTENDED with landmarkSchema id/version fields
 * → new dependency: pose/schemas registry (schemas.ts)
 *
 * pose/poseTypes (NormalizedLandmark, PoseDetection, PoseFrame, LM, edges)
 * → Solo 2D detection currency + 33-point index map
 * → REUSED UNCHANGED; LM stays the mediapipe-33 index authority
 * → new dependency: schema mapper mediapipe-33 → anatomical ids
 *
 * tracking/patientIdentity + subjectTracker
 * → AutoLock V2 acquisition, continuity, idSwitches
 * → REUSED UNCHANGED; continuity feeds MeasurementConfidence evidence
 *
 * biomechanics/jointAngles (JOINT_DEFS triple + plane + neutral)
 * → Solo 2D triple-angle computation
 * → REUSED UNCHANGED for Solo direct-2d path; EXTENDED with explicit
 *   ClinicalJointDefinition records (joints.ts) referencing semantic ids
 *
 * biomechanics/confidence (evaluateConfidence, ConfidenceLevel)
 * → Solo weighted confidence + hard suspension
 * → REUSED UNCHANGED for Solo; V2 quality (quality.ts) wraps it with
 *   grade/calibration/sync/view-count/reprojection evidence, never
 *   replacing its suspension semantics
 *
 * biomechanics/angularVelocity, anatomicalPlanes, movementMetrics
 * → REUSED UNCHANGED (velocity/plane/metric primitives)
 *
 * calibration/calibrationEngine (patient setup quality, NOT optical)
 * → REUSED UNCHANGED; optical calibration is NEW (capture/calibration.ts)
 *   and does not collide: distinct type names (CameraIntrinsics, etc.)
 *
 * kinetics/* (measured vs estimated vs sensor separation + disclaimers)
 * → REUSED UNCHANGED; ClinicalMeasurement.source reuses the same
 *   separation vocabulary (physical-sensor vs estimated-model)
 *
 * lib/timing/timeSync (SessionClock, DeviceTimeMapper)
 * → REUSED UNCHANGED; sync quality (sync.ts) builds on session-monotonic
 *   ms, same clock domain
 *
 * validation/validation (ValidationTrial, MAE/RMSE/bias/sd)
 * → REUSED UNCHANGED; extended with pearson/correlation + Bland-Altman
 *   preparation helpers (comparison.ts) — existing stats untouched
 *
 * stores/sessionStore (MetricSample timeline, SensorSample channels)
 * → REUSED UNCHANGED; versioned session schema (storage.ts) references
 *   these shapes, never rewrites them
 *
 * visualization/ClinicalOverlay + frameStore + MotionCanvas
 * → REUSED UNCHANGED; overlay gains source/grade awareness (Phase 30)
 *   via ClinicalMeasurement passthrough, no render-path redesign
 *
 * workers/pose.worker + metrics.worker, lib/performance/perf
 * → REUSED UNCHANGED; perfMonitor extended with named stages only
 *   (triangulation/solve timings, no invented numbers)
 */

/** Acquisition grade: spatial certainty tier of a measurement. */
export type AcquisitionGrade = 'precision' | 'clinical' | 'solo';

/** Minimum valid camera views required per grade for triangulated 3D. */
export const MIN_VIEWS_FOR_GRADE: Record<AcquisitionGrade, number> = {
  precision: 3,
  clinical: 2,
  solo: 1,
};

/** Monotonic session-timeline timestamp (lib/timing SessionClock domain). */
export interface FrameTimestamp {
  monotonicMs: number;
  wallClockIso?: string;
  frameIndex: number;
}

/** One 2D landmark observation from one camera. Pixel space. */
export interface LandmarkObservation2D {
  cameraId: string;
  /** Semantic anatomical landmark id (e.g. 'left-knee'), NOT an array index. */
  landmarkId: string;
  xPx: number;
  yPx: number;
  confidence: number;
  visibility?: number;
  timestamp: FrameTimestamp;
}

/** One reconstructed 3D landmark with full triangulation provenance. */
export interface LandmarkPoint3D {
  landmarkId: string;
  xM: number;
  yM: number;
  zM: number;
  sourceCameraIds: string[];
  validViewCount: number;
  observationConfidence: number;
  reprojectionErrorPx: number;
  uncertaintyMm?: number;
  timestamp: FrameTimestamp;
}

export type MeasurementMetric =
  | 'joint-angle'
  | 'rom'
  | 'velocity'
  | 'acceleration'
  | 'symmetry'
  | 'distance'
  | 'spatiotemporal'
  | 'measured-force'
  | 'estimated-kinetic';

export type MeasurementSource =
  | 'direct-2d'
  | 'triangulated-3d'
  | 'biomechanical-model'
  | 'physical-sensor'
  | 'estimated-model';

/** Structured confidence evidence — never a magical bare number. */
export interface MeasurementConfidence {
  level: 'high' | 'moderate' | 'low' | 'suspended';
  /** Engineering score 0..1 (NOT a clinically validated accuracy). */
  score?: number;
  reasons: string[];
}

/** Full provenance: how a value was generated. Persisted, not displayed. */
export interface MeasurementProvenance {
  providerName: string;
  providerVersion?: string;
  protocolId: string;
  cameraIds: string[];
  calibrationId?: string;
  anatomicalModel?: string;
  anatomicalModelVersion?: string;
  landmarkModel?: string;
  landmarkModelVersion?: string;
  sourceLandmarkIds?: string[];
  reprojectionErrorPx?: number;
  validViewCount?: number;
  trackingContinuity?: number;
  processingPipelineVersion: string;
}

/** A clinical value with grade, source, confidence, and provenance. */
export interface ClinicalMeasurement<T = number> {
  id: string;
  metric: MeasurementMetric;
  value: T;
  unit: string;
  acquisitionGrade: AcquisitionGrade;
  source: MeasurementSource;
  confidence: MeasurementConfidence;
  provenance: MeasurementProvenance;
  timestamp: FrameTimestamp;
}

/** Pipeline version stamped on every provenance record. */
export const PROCESSING_PIPELINE_VERSION = 'kinelab-measurement-core/1.0';

let measurementSeq = 0;

/** Build a ClinicalMeasurement with generated id + pipeline version. */
export function makeMeasurement<T>(m: Omit<ClinicalMeasurement<T>, 'id' | 'provenance'> & {
  provenance: Omit<MeasurementProvenance, 'processingPipelineVersion'>;
}): ClinicalMeasurement<T> {
  measurementSeq += 1;
  return {
    ...m,
    id: `m-${Date.now().toString(36)}-${measurementSeq}`,
    provenance: { ...m.provenance, processingPipelineVersion: PROCESSING_PIPELINE_VERSION },
  };
}

/** Guard: high confidence requires minimum valid views for its grade. */
export function gradeSupportsConfidence(
  grade: AcquisitionGrade,
  level: MeasurementConfidence['level'],
  validViewCount: number,
): boolean {
  if (level === 'suspended') return true;
  return validViewCount >= MIN_VIEWS_FOR_GRADE[grade];
}
