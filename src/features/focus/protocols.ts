import type { JointId } from '../biomechanics/jointAngles';

/** Lightweight patient cue events. Visual today; spoken cues can consume the same events later. */
export type PatientCue =
  | 'step-into-frame'
  | 'step-back'
  | 'center-patient'
  | 'turn-sideways'
  | 'turn-front'
  | 'hold-still'
  | 'ready'
  | 'begin'
  | 'rep-complete'
  | 'return-to-start'
  | 'assessment-complete'
  | null;

export interface ProtocolCompletionCriteria {
  kind: 'cycles' | 'timed';
  trialCount: number;
  cyclesPerTrial: number;
  minExcursionDeg: number;
  onsetDeg: number;
  returnToleranceFrac: number;
  stillnessMs: number;
  maxDurationMs: number;
}

export type Side = 'left' | 'right';

/**
 * Clinical protocol: test-first configuration that drives the existing
 * engines (ROM, rep detection, symmetry, compensation, calibration).
 * Movement IDs intentionally match exerciseRegistry entries.
 */
export interface ClinicalProtocol {
  id: string;
  name: string;
  bodyRegion: string;
  movementType: string;
  movementId: string;
  preferredPlane: 'sagittal' | 'frontal';
  joints: { left: JointId; right: JointId };
  bilateral: boolean;
  affectedSideRequired: boolean;
  defaultTrialCount: number;
  autoStart: boolean;
  autoStop: boolean;
  requiredMetrics: string[];
  compensationRules: string[];
  overlays: Array<'angleArc' | 'trails' | 'com' | 'vectors'>;
  setupInstructions: string[];
  completionCriteria: ProtocolCompletionCriteria;
}

const romCycle = (trialCount: number, minExcursionDeg: number): ProtocolCompletionCriteria => ({
  kind: 'cycles',
  trialCount,
  cyclesPerTrial: 1,
  minExcursionDeg,
  onsetDeg: 8,
  returnToleranceFrac: 0.2,
  stillnessMs: 700,
  maxDurationMs: 30000,
});

export const CLINICAL_PROTOCOLS: ClinicalProtocol[] = [
  {
    id: 'knee-flexion-arom',
    name: 'Knee Flexion AROM',
    bodyRegion: 'Knee',
    movementType: 'arom',
    movementId: 'knee-flexion',
    preferredPlane: 'sagittal',
    joints: { left: 'leftKnee', right: 'rightKnee' },
    bilateral: false,
    affectedSideRequired: true,
    defaultTrialCount: 3,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'duration'],
    compensationRules: ['trunk-flex', 'asymmetric-depth'],
    overlays: ['angleArc'],
    setupInstructions: ['Stand sideways to the camera', 'Bend the affected knee as far as comfortable, then straighten'],
    completionCriteria: romCycle(3, 20),
  },
  {
    id: 'knee-extension-arom',
    name: 'Knee Extension AROM',
    bodyRegion: 'Knee',
    movementType: 'arom',
    movementId: 'knee-flexion',
    preferredPlane: 'sagittal',
    joints: { left: 'leftKnee', right: 'rightKnee' },
    bilateral: false,
    affectedSideRequired: true,
    defaultTrialCount: 3,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'duration'],
    compensationRules: ['trunk-flex'],
    overlays: ['angleArc'],
    setupInstructions: ['Stand sideways to the camera', 'Start with the knee bent, then straighten fully'],
    completionCriteria: romCycle(3, 15),
  },
  {
    id: 'shoulder-flexion',
    name: 'Shoulder Flexion',
    bodyRegion: 'Shoulder',
    movementType: 'arom',
    movementId: 'shoulder-flexion',
    preferredPlane: 'sagittal',
    joints: { left: 'leftShoulderFlex', right: 'rightShoulderFlex' },
    bilateral: false,
    affectedSideRequired: true,
    defaultTrialCount: 3,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'duration'],
    compensationRules: ['trunk-flex', 'trunk-lateral'],
    overlays: ['angleArc'],
    setupInstructions: ['Stand sideways to the camera', 'Raise the arm forward overhead, then lower'],
    completionCriteria: romCycle(3, 20),
  },
  {
    id: 'shoulder-abduction',
    name: 'Shoulder Abduction',
    bodyRegion: 'Shoulder',
    movementType: 'arom',
    movementId: 'shoulder-abduction',
    preferredPlane: 'frontal',
    joints: { left: 'leftShoulderAbd', right: 'rightShoulderAbd' },
    bilateral: false,
    affectedSideRequired: true,
    defaultTrialCount: 3,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'duration'],
    compensationRules: ['trunk-lateral'],
    overlays: ['angleArc'],
    setupInstructions: ['Face the camera', 'Raise the arm out to the side overhead, then lower'],
    completionCriteria: romCycle(3, 20),
  },
  {
    id: 'elbow-flexion',
    name: 'Elbow Flexion',
    bodyRegion: 'Elbow',
    movementType: 'arom',
    movementId: 'elbow-flexion',
    preferredPlane: 'sagittal',
    joints: { left: 'leftElbow', right: 'rightElbow' },
    bilateral: false,
    affectedSideRequired: true,
    defaultTrialCount: 3,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'duration'],
    compensationRules: [],
    overlays: ['angleArc'],
    setupInstructions: ['Stand sideways to the camera', 'Bend the elbow fully, then straighten'],
    completionCriteria: romCycle(3, 20),
  },
  {
    id: 'squat',
    name: 'Squat',
    bodyRegion: 'Lower limb',
    movementType: 'functional',
    movementId: 'squat',
    preferredPlane: 'sagittal',
    joints: { left: 'leftKnee', right: 'rightKnee' },
    bilateral: true,
    affectedSideRequired: false,
    defaultTrialCount: 2,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'reps', 'symmetry'],
    compensationRules: ['trunk-lateral', 'trunk-flex', 'asymmetric-depth', 'pelvic-shift'],
    overlays: ['angleArc', 'trails'],
    setupInstructions: ['Stand sideways to the camera', 'Perform 5 controlled squats to a comfortable depth'],
    completionCriteria: {
      kind: 'cycles', trialCount: 2, cyclesPerTrial: 5,
      minExcursionDeg: 25, onsetDeg: 10, returnToleranceFrac: 0.25,
      stillnessMs: 800, maxDurationMs: 60000,
    },
  },
  {
    id: 'sit-to-stand',
    name: 'Sit-to-Stand',
    bodyRegion: 'Lower limb',
    movementType: 'functional',
    movementId: 'sit-to-stand',
    preferredPlane: 'sagittal',
    joints: { left: 'leftKnee', right: 'rightKnee' },
    bilateral: true,
    affectedSideRequired: false,
    defaultTrialCount: 2,
    autoStart: true,
    autoStop: true,
    requiredMetrics: ['peak', 'excursion', 'peakVelocity', 'reps', 'symmetry'],
    compensationRules: ['trunk-flex', 'asymmetric-depth'],
    overlays: ['angleArc'],
    setupInstructions: ['Sit sideways to the camera', 'Stand up fully and sit back down, 5 times'],
    completionCriteria: {
      kind: 'cycles', trialCount: 2, cyclesPerTrial: 5,
      minExcursionDeg: 25, onsetDeg: 10, returnToleranceFrac: 0.25,
      stillnessMs: 800, maxDurationMs: 60000,
    },
  },
];

export const getProtocol = (id: string): ClinicalProtocol | undefined =>
  CLINICAL_PROTOCOLS.find((p) => p.id === id);

/** Resolve the measured joint(s) for a protocol + side. Bilateral → both. */
export function resolveJoints(p: ClinicalProtocol, side: Side): JointId[] {
  if (p.bilateral) return [p.joints.left, p.joints.right];
  return [side === 'left' ? p.joints.left : p.joints.right];
}

/** Primary (display) joint for a protocol + side. */
export function primaryJoint(p: ClinicalProtocol, side: Side): JointId {
  return side === 'left' ? p.joints.left : p.joints.right;
}

/** Default measurement side: stored affected side wins, else left. */
export function defaultSideFor(
  p: ClinicalProtocol,
  patientSide: 'left' | 'right' | 'bilateral' | 'na',
): Side {
  void p;
  if (patientSide === 'left' || patientSide === 'right') return patientSide;
  return 'left';
}
