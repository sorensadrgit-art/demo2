import type { LandmarkPoint3D } from '../measurement/domain';
import type { BiomechanicalFrame, BiomechanicalModelProvider, PatientModel, PatientModelInput } from './modelAdapter';
import { KineLabSegmentModel } from './modelAdapter';

/**
 * OpenSim integration (Phase 21). Investigated 2026-09-13: this
 * environment has no Python OpenCV/NumPy/SciPy runtime at all
 * (`import cv2` fails, `import numpy` fails, no pip opensim package),
 * no OpenSim models, and no measurement-service backend — the required
 * architecture is frontend → measurement service → OpenSim adapter.
 * The skeleton below implements the BiomechanicalModelProvider contract
 * against an injected KineLabSegmentModel core so data conversion and
 * interface tests are real; runtime execution is BLOCKED, never faked.
 */
export interface OpenSimStatus {
  installed: boolean;
  reason: string;
}

export function opensimIntegrationStatus(): OpenSimStatus {
  return {
    installed: false,
    reason: 'OPENSIM RUNTIME INTEGRATION: BLOCKED — no Python/NumPy/OpenSim runtime, no model files, and no measurement-service backend in this environment. Adapter interface + data conversion + fixture tests present; kinematics delegate to the KineLab segment core behind an explicit research-mode flag.',
  };
}

/** OpenSim-compatible output naming for future model-file runs. */
export function toOpenSimJointName(clinicalJointId: string): string | null {
  const map: Record<string, string> = {
    'knee-flexion-l': 'knee_angle_l',
    'knee-flexion-r': 'knee_angle_r',
    'elbow-flexion-l': 'elbow_flexion_l',
    'elbow-flexion-r': 'elbow_flexion_r',
    'hip-flexion-l': 'hip_flexion_l',
    'hip-flexion-r': 'hip_flexion_r',
  };
  return map[clinicalJointId] ?? null;
}

/**
 * Adapter skeleton: converts LandmarkPoint3D[] → provider frame using the
 * same contract a future OpenSim-backed solver will use. Throws unless
 * constructed with an explicit test/fixture core — production code paths
 * must never silently receive segment-model output labeled as OpenSim.
 */
export class OpenSimAdapter implements BiomechanicalModelProvider {
  readonly id = 'OpenSimAdapter';
  private core: KineLabSegmentModel | null = null;
  /** Inject a fixture core ONLY in tests/research mode. */
  attachFixtureCore(core: KineLabSegmentModel): void {
    this.core = core;
  }
  async initializePatientModel(input: PatientModelInput): Promise<PatientModel> {
    if (!this.core) throw new Error(opensimIntegrationStatus().reason);
    const m = await this.core.initializePatientModel(input);
    return { ...m, modelId: `opensim-skeleton-${input.patientId}` };
  }
  async solveKinematics(frame: LandmarkPoint3D[], timestampMs: number): Promise<BiomechanicalFrame> {
    if (!this.core) throw new Error(opensimIntegrationStatus().reason);
    return this.core.solveKinematics(frame, timestampMs);
  }
}
