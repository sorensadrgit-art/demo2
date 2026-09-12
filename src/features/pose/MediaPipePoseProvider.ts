import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { IPoseProvider } from './PoseProvider';
import { bboxOf, type PoseFrame } from './poseTypes';

// Low-latency browser provider using MediaPipe Tasks Vision Pose Landmarker.
// Runs outside React's render loop; callers should invoke from a worker or
// a rAF/video-frame callback, never inside a component render.
export class MediaPipePoseProvider implements IPoseProvider {
  readonly name = 'MediaPipePoseProvider';
  readonly trackingMode = 'multi' as const;
  private landmarker: PoseLandmarker | null = null;
  private lastVideoTime = -1;

  async initialize(opts: Record<string, unknown> = {}): Promise<void> {
    const wasmBase = (opts.wasmBase as string)
      ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm';
    const modelUrl = (opts.modelUrl as string)
      ?? 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
    const delegate = (opts.delegate as 'GPU' | 'CPU') ?? 'GPU';
    const numPoses = (opts.numPoses as number) ?? 3;
    const vision = await FilesetResolver.forVisionTasks(wasmBase);
    this.landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }

  setOptions(opts: Record<string, unknown>): void {
    if (this.landmarker && typeof opts.numPoses === 'number') {
      this.landmarker.setOptions({ numPoses: opts.numPoses });
    }
  }

  async detect(
    video: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    timestampMs: number,
  ): Promise<PoseFrame> {
    if (!this.landmarker) throw new Error('MediaPipePoseProvider not initialized');
    const t = Math.max(timestampMs, this.lastVideoTime + 1);
    this.lastVideoTime = t;
    const result = this.landmarker.detectForVideo(video as HTMLVideoElement, t);
    const w = (video as HTMLVideoElement).videoWidth || (video as HTMLCanvasElement).width || 1280;
    const h = (video as HTMLVideoElement).videoHeight || (video as HTMLCanvasElement).height || 720;
    return {
      timestamp: timestampMs,
      width: w,
      height: h,
      detections: (result.landmarks ?? []).map((lms, i) => {
        const landmarks = lms.map((l) => ({
          x: l.x ?? 0, y: l.y ?? 0, z: l.z ?? 0,
          visibility: l.visibility ?? 0.5,
          presence: 0.5,
        }));
        const world = result.worldLandmarks?.[i];
        if (world) {
          for (let k = 0; k < landmarks.length && k < world.length; k++) {
            landmarks[k].z = world[k].z ?? landmarks[k].z;
            landmarks[k].visibility = world[k].visibility ?? landmarks[k].visibility;
          }
        }
        const lp = (result as unknown as { poseLandmarks?: Array<Array<{ presence?: number }>> }).poseLandmarks;
        const score = lp?.[i]?.[0]?.presence ?? 0.8;
        return { landmarks, score: Number(score) || 0.8, bbox: bboxOf(landmarks), timestamp: timestampMs };
      }),
    };
  }

  async close(): Promise<void> {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

// --- Future provider stubs (interfaces only; no fake measurements) ---

export class RTMPoseProvider implements IPoseProvider {
  readonly name = 'RTMPoseProvider';
  readonly trackingMode = 'multi' as const;
  async initialize(): Promise<void> { throw new Error('RTMPoseProvider: server endpoint not configured'); }
  async detect(): Promise<PoseFrame> { throw new Error('RTMPoseProvider: server endpoint not configured'); }
  setOptions(): void { /* not connected */ }
  async close(): Promise<void> { /* noop */ }
}

export class MultiCameraPoseProvider implements IPoseProvider {
  readonly name = 'MultiCameraPoseProvider';
  readonly trackingMode = 'multi' as const;
  async initialize(): Promise<void> { throw new Error('MultiCameraPoseProvider: calibration required'); }
  async detect(): Promise<PoseFrame> { throw new Error('MultiCameraPoseProvider: calibration required'); }
  setOptions(): void { /* not connected */ }
  async close(): Promise<void> { /* noop */ }
}

export class OpenCapProvider implements IPoseProvider {
  readonly name = 'OpenCapProvider';
  readonly trackingMode = 'multi' as const;
  async initialize(): Promise<void> { throw new Error('OpenCapProvider: cloud session not configured'); }
  async detect(): Promise<PoseFrame> { throw new Error('OpenCapProvider: cloud session not configured'); }
  setOptions(): void { /* not connected */ }
  async close(): Promise<void> { /* noop */ }
}

/** Replays recorded landmarks for timeline scrubbing / comparison. */
export class RecordedAnalysisProvider implements IPoseProvider {
  readonly name = 'RecordedAnalysisProvider';
  readonly trackingMode = 'single' as const;
  private frames: PoseFrame[] = [];
  load(frames: PoseFrame[]) { this.frames = frames; }
  async initialize(): Promise<void> { /* ready once load() called */ }
  async detect(_v: HTMLVideoElement | HTMLCanvasElement | ImageBitmap, t: number): Promise<PoseFrame> {
    let best = this.frames[0];
    for (const f of this.frames) {
      if (Math.abs(f.timestamp - t) < Math.abs((best?.timestamp ?? Infinity) - t)) best = f;
    }
    return best ?? { timestamp: t, width: 0, height: 0, detections: [] };
  }
  setOptions(): void { /* noop */ }
  async close(): Promise<void> { this.frames = []; }
}
