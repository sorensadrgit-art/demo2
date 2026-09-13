/**
 * Typed TypeScript client for the KineLab biomechanics Python service.
 * Reuses measurement-domain naming; validates external JSON at runtime
 * before it touches session state. Service is optional: UI must boot
 * and Focus must work with the backend unreachable.
 */
export const BIOMECHANICS_PIPELINE_VERSION = 'kinelab-precision-v3';

export interface BackendHealth {
  status: string;
  python: string;
  numpy: boolean;
  scipy: boolean;
  opencv: boolean;
  charuco: boolean;
  rtmw: boolean;
  rtmw_reason: string | null;
  opensim: boolean;
  opensim_reason: string | null;
}

export interface TriangulateObservation {
  cameraId: string;
  xPx: number;
  yPx: number;
  confidence?: number;
}

export interface TriangulateResponse {
  landmarkId: string;
  pointM: [number, number, number];
  usedCameraIds: string[];
  rejectedCameraIds: string[];
  residualsPx: Record<string, number>;
  reprojectionErrorPx: number;
  pipeline: string;
}

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_BIOMECH_URL ?? 'http://127.0.0.1:8101';
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body
      ? String((body as Record<string, unknown>).code) : `HTTP ${res.status}`;
    throw new Error(`biomech ${path}: ${code}`);
  }
  return body as T;
}

export function validateTriangulateResponse(body: unknown): TriangulateResponse {
  const b = body as Record<string, unknown>;
  if (!b || !Array.isArray(b.pointM) || b.pointM.length !== 3) {
    throw new Error('invalid triangulate response: pointM');
  }
  if (!Array.isArray(b.usedCameraIds)) throw new Error('invalid triangulate response: usedCameraIds');
  if (typeof b.reprojectionErrorPx !== 'number') throw new Error('invalid triangulate response: reprojectionErrorPx');
  return body as TriangulateResponse;
}

export const biomechClient = {
  health: async (): Promise<BackendHealth> => {
    const res = await fetch(`${baseUrl()}/health`);
    if (!res.ok) throw new Error(`biomech /health: HTTP ${res.status}`);
    return (await res.json()) as BackendHealth;
  },
  triangulate: async (args: {
    cameras: Array<{ cameraId: string; projectionMatrix: number[][] }>;
    landmarkId: string;
    observations: TriangulateObservation[];
    minViews?: number;
    refine?: boolean;
  }): Promise<TriangulateResponse> =>
    validateTriangulateResponse(await postJson('/reconstruction/triangulate', args)),
  kinematics: (points: Record<string, [number, number, number]>) =>
    postJson('/biomechanics/kinematics', { points }),
  compare: (kinelab: number[], reference: number[], unit = 'deg') =>
    postJson('/validation/compare', { kinelab, reference, unit }),
  processPrecision: (job: {
    cameras?: Array<{ cameraId: string; projectionMatrix: number[][] }>;
    calibrationId?: string;
    frames: Array<{ timestampMs: number; observations: unknown[] }>;
    minViews?: number;
    refine?: boolean;
  }) => postJson('/precision/process', job),
};
