import { LM } from '../features/pose/poseTypes';

/**
 * Landmark schema abstraction (Phases 11-12). Clinical code references
 * semantic anatomical ids; schema mappers translate provider-native
 * indices → anatomical ids. Supported today: mediapipe-33.
 * Prepared: rtmw-wholebody, biomechanics-dense-v1.
 */
export interface AnatomicalLandmarkDefinition {
  id: string;
  label: string;
  region: 'head' | 'trunk' | 'arm' | 'leg' | 'foot' | 'hand';
  side: 'left' | 'right' | 'midline';
}

export interface LandmarkSchema {
  id: string;
  version: string;
  landmarks: AnatomicalLandmarkDefinition[];
}

const def = (id: string, label: string, region: AnatomicalLandmarkDefinition['region'], side: AnatomicalLandmarkDefinition['side']): AnatomicalLandmarkDefinition => ({
  id, label, region, side,
});

export const MEDIAPIPE_33_SCHEMA: LandmarkSchema = {
  id: 'mediapipe-33',
  version: '1.0',
  landmarks: [
    def('nose', 'Nose', 'head', 'midline'),
    def('left-eye-inner', 'L Eye Inner', 'head', 'left'),
    def('left-eye', 'L Eye', 'head', 'left'),
    def('left-eye-outer', 'L Eye Outer', 'head', 'left'),
    def('right-eye-inner', 'R Eye Inner', 'head', 'right'),
    def('right-eye', 'R Eye', 'head', 'right'),
    def('right-eye-outer', 'R Eye Outer', 'head', 'right'),
    def('left-ear', 'L Ear', 'head', 'left'),
    def('right-ear', 'R Ear', 'head', 'right'),
    def('mouth-left', 'Mouth L', 'head', 'left'),
    def('mouth-right', 'Mouth R', 'head', 'right'),
    def('left-shoulder', 'L Shoulder', 'arm', 'left'),
    def('right-shoulder', 'R Shoulder', 'arm', 'right'),
    def('left-elbow', 'L Elbow', 'arm', 'left'),
    def('right-elbow', 'R Elbow', 'arm', 'right'),
    def('left-wrist', 'L Wrist', 'arm', 'left'),
    def('right-wrist', 'R Wrist', 'arm', 'right'),
    def('left-pinky', 'L Pinky', 'hand', 'left'),
    def('right-pinky', 'R Pinky', 'hand', 'right'),
    def('left-index', 'L Index', 'hand', 'left'),
    def('right-index', 'R Index', 'hand', 'right'),
    def('left-thumb', 'L Thumb', 'hand', 'left'),
    def('right-thumb', 'R Thumb', 'hand', 'right'),
    def('left-hip', 'L Hip', 'trunk', 'left'),
    def('right-hip', 'R Hip', 'trunk', 'right'),
    def('left-knee', 'L Knee', 'leg', 'left'),
    def('right-knee', 'R Knee', 'leg', 'right'),
    def('left-ankle', 'L Ankle', 'leg', 'left'),
    def('right-ankle', 'R Ankle', 'leg', 'right'),
    def('left-heel', 'L Heel', 'foot', 'left'),
    def('right-heel', 'R Heel', 'foot', 'right'),
    def('left-foot-index', 'L Foot Index', 'foot', 'left'),
    def('right-foot-index', 'R Foot Index', 'foot', 'right'),
  ],
};

/** mediapipe-33 native index → anatomical id (index order = schema order). */
const MEDIAPIPE_33_INDEX_TO_ID: string[] = MEDIAPIPE_33_SCHEMA.landmarks.map((l) => l.id);

const LM_INDEX_BY_ID: Record<string, number> = {
  'nose': LM.nose,
  'left-shoulder': LM.leftShoulder, 'right-shoulder': LM.rightShoulder,
  'left-elbow': LM.leftElbow, 'right-elbow': LM.rightElbow,
  'left-wrist': LM.leftWrist, 'right-wrist': LM.rightWrist,
  'left-hip': LM.leftHip, 'right-hip': LM.rightHip,
  'left-knee': LM.leftKnee, 'right-knee': LM.rightKnee,
  'left-ankle': LM.leftAnkle, 'right-ankle': LM.rightAnkle,
  'left-heel': LM.leftHeel, 'right-heel': LM.rightHeel,
  'left-foot-index': LM.leftFootIndex, 'right-foot-index': LM.rightFootIndex,
};

/** Anatomical id → mediapipe-33 native index for the major joints. */
export function anatomicalToMediapipe33(id: string): number | null {
  return LM_INDEX_BY_ID[id] ?? null;
}

export function mediapipe33ToAnatomical(index: number): string | null {
  return MEDIAPIPE_33_INDEX_TO_ID[index] ?? null;
}

export const SCHEMA_REGISTRY: Record<string, LandmarkSchema> = {
  'mediapipe-33': MEDIAPIPE_33_SCHEMA,
};

export function getSchema(id: string): LandmarkSchema | null {
  return SCHEMA_REGISTRY[id] ?? null;
}
