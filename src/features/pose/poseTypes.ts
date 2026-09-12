// Shared pose-estimation types. Analytics depends only on these,
// never on a specific model SDK.
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}

/** One detected person in a frame, pre-association. */
export interface PoseDetection {
  landmarks: NormalizedLandmark[];
  score: number;
  bbox: { x: number; y: number; w: number; h: number };
  timestamp: number;
}

export interface PoseFrame {
  timestamp: number;
  width: number;
  height: number;
  detections: PoseDetection[];
}

/** MediaPipe BlazePose-33 landmark indices. */
export const LM = {
  nose: 0, leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
  rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18,
  leftIndex: 19, rightIndex: 20,
  leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
} as const;

export const SKELETON_EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [0, 4], [4, 5], [5, 6],
  [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

export function bboxOf(landmarks: NormalizedLandmark[]) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const l of landmarks) {
    if (l.visibility < 0.15) continue;
    if (l.x < x0) x0 = l.x;
    if (l.y < y0) y0 = l.y;
    if (l.x > x1) x1 = l.x;
    if (l.y > y1) y1 = l.y;
  }
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = 0.04;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(1, x1 + pad); y1 = Math.min(1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function emptyLandmarks(): NormalizedLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0, presence: 0 }));
}
