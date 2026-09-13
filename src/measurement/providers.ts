import type { IPoseProvider } from '../features/pose/PoseProvider';
import { MediaPipePoseProvider } from '../features/pose/MediaPipePoseProvider';

/**
 * Pose provider abstraction V1 (Phase 9). The existing IPoseProvider seam
 * (features/pose/PoseProvider.ts) is preserved unchanged; this module adds
 * the measurement-grade registry: every provider declares its landmark
 * schema id/version so downstream provenance can record exactly which
 * model produced a value. MediaPipe remains the realtime Solo provider.
 */
export interface RegisteredPoseProvider {
  provider: IPoseProvider;
  landmarkSchemaId: string;
  landmarkSchemaVersion: string;
  providerVersion: string;
}

const registry = new Map<string, RegisteredPoseProvider>();

export function registerPoseProvider(id: string, entry: RegisteredPoseProvider): void {
  registry.set(id, entry);
}

export function getPoseProvider(id: string): RegisteredPoseProvider | null {
  return registry.get(id) ?? null;
}

export function listPoseProviders(): string[] {
  return [...registry.keys()];
}

/** Default registry: MediaPipe 33-point provider (Solo realtime). */
let defaultsRegistered = false;
export function ensureDefaultProviders(): void {
  if (defaultsRegistered) return;
  defaultsRegistered = true;
  registerPoseProvider('mediapipe', {
    provider: new MediaPipePoseProvider(),
    landmarkSchemaId: 'mediapipe-33',
    landmarkSchemaVersion: '1.0',
    providerVersion: '0.10.20',
  });
  registerPoseProvider('rtmw', createRTMWSkeleton());
}

export interface RTMWStatus {
  installed: boolean;
  reason: string;
}

/**
 * RTMW research provider (Phase 10). Investigated 2026-09-13: no Python
 * runtime with OpenCV/NumPy in this environment, no torch/mmpose, no
 * model weights, no inference server — backend inference is the required
 * boundary and none exists here. Skeleton registered so the PoseProvider
 * seam, schema mapping, and benchmark harness have a real target; detect()
 * throws a BLOCKED error rather than faking output.
 */
export function rtmwIntegrationStatus(): RTMWStatus {
  return {
    installed: false,
    reason: 'RTMW RUNTIME INTEGRATION: BLOCKED — no Python OpenCV/torch/mmpose runtime, no model weights, and no backend inference service in this environment. Adapter skeleton + schema mapping + fixture tests present; no fake output.',
  };
}

function createRTMWSkeleton(): RegisteredPoseProvider {
  const provider: IPoseProvider = {
    name: 'RTMWPoseProvider',
    trackingMode: 'single',
    async initialize() { throw new Error(rtmwIntegrationStatus().reason); },
    async detect() { throw new Error(rtmwIntegrationStatus().reason); },
    setOptions() { /* skeleton: no runtime to configure */ },
    async close() { /* skeleton: nothing to dispose */ },
  };
  return {
    provider,
    landmarkSchemaId: 'rtmw-wholebody',
    landmarkSchemaVersion: '0.0-unavailable',
    providerVersion: '0.0-unavailable',
  };
}
