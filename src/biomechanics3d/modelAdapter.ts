import type { LandmarkPoint3D } from '../measurement/domain';
import { buildSegmentFrames, type SegmentFrame, type SegmentId } from './segments';

/**
 * Biomechanical model adapter (Phase 20). KineLabSegmentModel solves
 * segment frames + joint angles from reconstructed 3D landmarks today.
 * OpenSimAdapter is an interface-conformant skeleton (Phase 21 — see
 * opensim.ts status): same input/output contract, fixture-tested, runtime
 * BLOCKED until a reproducible OpenSim Python environment exists.
 */
export interface PatientModelInput {
  patientId: string;
  heightM?: number;
  massKg?: number;
  affectedSide?: 'left' | 'right' | 'bilateral' | 'na';
}

export interface PatientModel {
  modelId: string;
  input: PatientModelInput;
  createdAt: string;
}

export interface BiomechanicalFrame {
  timestampMs: number;
  segments: Record<SegmentId, SegmentFrame>;
  jointAnglesDeg: Record<string, number>;
}

export interface BiomechanicalModelProvider {
  id: string;
  initializePatientModel(input: PatientModelInput): Promise<PatientModel>;
  solveKinematics(frame: LandmarkPoint3D[], timestampMs: number): Promise<BiomechanicalFrame>;
}

const ANGLE_TRIPLES: Record<string, [string, string, string]> = {
  'knee-flexion-l': ['left-hip', 'left-knee', 'left-ankle'],
  'knee-flexion-r': ['right-hip', 'right-knee', 'right-ankle'],
  'elbow-flexion-l': ['left-shoulder', 'left-elbow', 'left-wrist'],
  'elbow-flexion-r': ['right-shoulder', 'right-elbow', 'right-wrist'],
  'hip-flexion-l': ['left-shoulder', 'left-hip', 'left-knee'],
  'hip-flexion-r': ['right-shoulder', 'right-hip', 'right-knee'],
};

function interior(a: LandmarkPoint3D, b: LandmarkPoint3D, c: LandmarkPoint3D): number {
  const ax = a.xM - b.xM; const ay = a.yM - b.yM; const az = a.zM - b.zM;
  const cx = c.xM - b.xM; const cy = c.yM - b.yM; const cz = c.zM - b.zM;
  const ma = Math.hypot(ax, ay, az); const mc = Math.hypot(cx, cy, cz);
  if (ma < 1e-9 || mc < 1e-9) return NaN;
  const d = Math.min(1, Math.max(-1, (ax * cx + ay * cy + az * cz) / (ma * mc)));
  return (Math.acos(d) * 180) / Math.PI;
}

/** KineLab native segment model: frames + interior angles from 3D points. */
export class KineLabSegmentModel implements BiomechanicalModelProvider {
  readonly id = 'KineLabSegmentModel';
  async initializePatientModel(input: PatientModelInput): Promise<PatientModel> {
    return { modelId: `kinelab-seg-${input.patientId}`, input, createdAt: new Date().toISOString() };
  }
  async solveKinematics(frame: LandmarkPoint3D[], timestampMs: number): Promise<BiomechanicalFrame> {
    const byId = new Map(frame.map((p) => [p.landmarkId, p]));
    const get = (id: string) => byId.get(id) ?? null;
    const segments = buildSegmentFrames(get);
    const jointAnglesDeg: Record<string, number> = {};
    for (const [joint, [ia, ib, ic]] of Object.entries(ANGLE_TRIPLES)) {
      const a = byId.get(ia); const b = byId.get(ib); const c = byId.get(ic);
      jointAnglesDeg[joint] = a && b && c ? interior(a, b, c) : NaN;
    }
    return { timestampMs, segments, jointAnglesDeg };
  }
}
