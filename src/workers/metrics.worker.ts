// Metrics worker: angle/velocity/event computation off the main thread.
// Receives smoothed landmark arrays, returns compact metric packets.
import { computeAllJointAngles } from '../features/biomechanics/jointAngles';
import type { NormalizedLandmark } from '../features/pose/poseTypes';

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as { type: 'angles'; landmarks: NormalizedLandmark[]; id: number };
  if (msg.type === 'angles') {
    const all = computeAllJointAngles(msg.landmarks);
    const angles: Record<string, number> = {};
    const valid: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(all)) {
      angles[k] = v.angle;
      valid[k] = v.valid;
    }
    self.postMessage({ type: 'angles-result', id: msg.id, angles, valid });
  }
};
