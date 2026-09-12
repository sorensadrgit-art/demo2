import type { PoseFrame } from './poseTypes';

// Replaceable inference abstraction. Analytics consumes PoseFrame only.
export interface IPoseProvider {
  readonly name: string;
  readonly trackingMode: 'single' | 'multi';
  initialize(opts?: Record<string, unknown>): Promise<void>;
  /** Run inference on a video frame; resolves with detections (possibly empty). */
  detect(video: HTMLVideoElement | HTMLCanvasElement | ImageBitmap, timestampMs: number): Promise<PoseFrame>;
  setOptions(opts: Record<string, unknown>): void;
  close(): Promise<void>;
}

export interface PoseProviderStatus {
  state: 'uninitialized' | 'loading' | 'ready' | 'error';
  backend: 'wasm' | 'webgpu' | 'server' | 'mock';
  fps: number;
  error?: string;
}

// Future providers implement IPoseProvider without touching analytics:
// RTMPoseProvider, MultiCameraPoseProvider, OpenCapProvider,
// RecordedAnalysisProvider. See docs in each stub below.
