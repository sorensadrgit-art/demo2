import type { CameraPlane, JointId } from '../biomechanics/jointAngles';
import type { CompensationFlag } from '../movement/compensationEngine';

export interface ExerciseDef {
  id: string;
  label: string;
  bodyRegion: string;
  requiredJoints: JointId[];
  primaryJoint: JointId;
  preferredPlane: Exclude<CameraPlane, 'any'>;
  planeHint: string;
  phases: string[];
  compensationRules: string[];
}

export interface ExerciseAnalysis {
  repCount: number;
  peakROM: number;
  avgROM: number;
  peakVelocity: number;
  avgVelocity: number;
  symmetry: Array<{ label: string; symmetryPct: number; difference: number; unit: string }>;
  compensations: CompensationFlag[];
  smoothness: number;
  durationMs: number;
}

export const EXERCISE_REGISTRY: Record<string, ExerciseDef> = {
  squat: {
    id: 'squat', label: 'Squat', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex', 'trunkFlex', 'trunkLateral'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Knee flexion → sagittal view recommended.',
    phases: ['setup', 'descent', 'bottom-hold', 'ascent', 'recovery'],
    compensationRules: ['knee valgus tendency', 'asymmetric depth', 'trunk lean', 'pelvic shift', 'heel-rise tendency', 'unequal loading estimate'],
  },
  'single-leg-squat': {
    id: 'single-leg-squat', label: 'Single-Leg Squat', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'trunkLateral'],
    primaryJoint: 'leftKnee', preferredPlane: 'frontal',
    planeHint: 'Single-leg squat → frontal view recommended for valgus assessment.',
    phases: ['setup', 'descent', 'bottom-hold', 'ascent', 'recovery'],
    compensationRules: ['knee valgus tendency', 'pelvic drop', 'trunk lean'],
  },
  'sit-to-stand': {
    id: 'sit-to-stand', label: 'Sit-to-Stand', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex', 'trunkFlex'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Sit-to-stand → sagittal view recommended.',
    phases: ['seated', 'transition', 'standing', 'sitting'],
    compensationRules: ['excessive trunk strategy', 'left-right asymmetry', 'slow transition', 'unequal stance behavior'],
  },
  'step-up': {
    id: 'step-up', label: 'Step-Up', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Step-up → sagittal view recommended.',
    phases: ['setup', 'lift', 'stand', 'lower'],
    compensationRules: ['trunk lean', 'pelvic shift', 'asymmetric depth'],
  },
  'step-down': {
    id: 'step-down', label: 'Step-Down', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Step-down → sagittal view recommended.',
    phases: ['setup', 'lower', 'touch', 'return'],
    compensationRules: ['knee valgus tendency', 'trunk lean', 'pelvic drop'],
  },
  walking: {
    id: 'walking', label: 'Walking', bodyRegion: 'Gait',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex', 'leftAnkle', 'rightAnkle'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Gait → sagittal view recommended; add frontal pass for trunk deviation.',
    phases: ['stance', 'swing'],
    compensationRules: ['step-time asymmetry', 'trunk deviation', 'knee-flexion pattern', 'foot progression approximation'],
  },
  running: {
    id: 'running', label: 'Running', bodyRegion: 'Gait',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Running → sagittal view recommended.',
    phases: ['stance', 'flight', 'swing'],
    compensationRules: ['step-time asymmetry', 'trunk deviation', 'overstriding proxy'],
  },
  lunge: {
    id: 'lunge', label: 'Lunge', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee', 'leftHipFlex', 'rightHipFlex', 'trunkFlex'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Lunge → sagittal view recommended.',
    phases: ['setup', 'descent', 'bottom-hold', 'ascent'],
    compensationRules: ['trunk lean', 'pelvic shift', 'knee valgus tendency'],
  },
  'single-leg-balance': {
    id: 'single-leg-balance', label: 'Single-Leg Balance', bodyRegion: 'Balance',
    requiredJoints: ['leftHipAbd', 'rightHipAbd', 'trunkLateral'],
    primaryJoint: 'trunkLateral', preferredPlane: 'frontal',
    planeHint: 'Balance → frontal view recommended.',
    phases: ['setup', 'hold', 'recovery'],
    compensationRules: ['pelvic drop', 'trunk lean', 'touch-down'],
  },
  'shoulder-flexion': {
    id: 'shoulder-flexion', label: 'Shoulder Flexion', bodyRegion: 'Upper limb',
    requiredJoints: ['leftShoulderFlex', 'rightShoulderFlex', 'trunkFlex'],
    primaryJoint: 'leftShoulderFlex', preferredPlane: 'sagittal',
    planeHint: 'Shoulder flexion → sagittal view recommended.',
    phases: ['rest', 'elevation', 'hold', 'lowering'],
    compensationRules: ['excessive thoracic compensation', 'trunk lateral flexion', 'elbow-flexion compensation'],
  },
  'shoulder-abduction': {
    id: 'shoulder-abduction', label: 'Shoulder Abduction', bodyRegion: 'Upper limb',
    requiredJoints: ['leftShoulderAbd', 'rightShoulderAbd', 'trunkLateral'],
    primaryJoint: 'leftShoulderAbd', preferredPlane: 'frontal',
    planeHint: 'Shoulder abduction → frontal view recommended.',
    phases: ['rest', 'elevation', 'hold', 'lowering'],
    compensationRules: ['trunk lateral flexion', 'scapular-region elevation proxy', 'elbow-flexion compensation'],
  },
  'elbow-flexion': {
    id: 'elbow-flexion', label: 'Elbow Flexion', bodyRegion: 'Upper limb',
    requiredJoints: ['leftElbow', 'rightElbow'],
    primaryJoint: 'leftElbow', preferredPlane: 'sagittal',
    planeHint: 'Elbow flexion → sagittal view recommended.',
    phases: ['extension', 'flexion', 'hold', 'extension'],
    compensationRules: ['shoulder substitution', 'trunk lean'],
  },
  'knee-flexion': {
    id: 'knee-flexion', label: 'Knee Flexion (prone/standing)', bodyRegion: 'Lower limb',
    requiredJoints: ['leftKnee', 'rightKnee'],
    primaryJoint: 'leftKnee', preferredPlane: 'sagittal',
    planeHint: 'Knee flexion → sagittal view recommended.',
    phases: ['extension', 'flexion', 'hold', 'extension'],
    compensationRules: ['hip substitution', 'trunk lean'],
  },
  'straight-leg-raise': {
    id: 'straight-leg-raise', label: 'Straight-Leg Raise', bodyRegion: 'Lower limb',
    requiredJoints: ['leftHipFlex', 'rightHipFlex', 'leftKnee', 'rightKnee'],
    primaryJoint: 'leftHipFlex', preferredPlane: 'sagittal',
    planeHint: 'Straight-leg raise → sagittal view recommended.',
    phases: ['rest', 'lift', 'hold', 'lower'],
    compensationRules: ['knee-flexion substitution', 'trunk compensation'],
  },
  'heel-raise': {
    id: 'heel-raise', label: 'Heel Raise', bodyRegion: 'Lower limb',
    requiredJoints: ['leftAnkle', 'rightAnkle'],
    primaryJoint: 'leftAnkle', preferredPlane: 'sagittal',
    planeHint: 'Heel raise → sagittal view recommended.',
    phases: ['flat', 'rise', 'hold', 'lower'],
    compensationRules: ['toe-clawing proxy', 'trunk sway', 'asymmetric rise'],
  },
};

export const listExercises = () => Object.values(EXERCISE_REGISTRY);
export const getExercise = (id: string): ExerciseDef | undefined => EXERCISE_REGISTRY[id];
