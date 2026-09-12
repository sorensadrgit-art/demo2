import type { EstimatedKineticSample } from './kineticsTypes';

// Simplified sagittal-plane inverse-dynamics-style estimates.
// Honest by construction: every output is labeled ESTIMATED with model
// source + confidence, and requires body mass + segment lengths.
export interface Anthropometry {
  bodyMassKg: number;
  shankLengthM: number;
  thighLengthM: number;
  calibrated: boolean;
}

export function estimateKneeMoment(
  t: number,
  kneeFlexDeg: number,
  kneeAngVelDegS: number,
  anthro: Anthropometry,
): EstimatedKineticSample {
  // Quasi-static proxy: M ≈ m_shank * g * d(θ) with a velocity damping term.
  const mShank = anthro.bodyMassKg * 0.0465;
  const g = 9.81;
  const theta = (kneeFlexDeg * Math.PI) / 180;
  const momentArm = anthro.shankLengthM * Math.sin(Math.min(Math.PI / 2, theta * 0.6));
  const quasiStatic = mShank * g * momentArm;
  const damping = 0.02 * mShank * ((kneeAngVelDegS * Math.PI) / 180) * anthro.shankLengthM;
  return {
    t, kind: 'jointMoment', joint: 'knee',
    value: Math.max(0, quasiStatic + damping), unit: 'N·m (EST)',
    modelSource: 'KineLab quasi-static sagittal proxy v0.1',
    confidence: anthro.calibrated ? 0.55 : 0.35,
    calibrationStatus: anthro.calibrated ? 'anthropometric' : 'uncalibrated',
  };
}

export function estimateLoadingDistribution(
  t: number,
  leftAngle: number,
  rightAngle: number,
): EstimatedKineticSample {
  // Symmetric-depth proxy: deeper knee flexion side carries more load.
  const l = Math.max(0, 180 - leftAngle);
  const r = Math.max(0, 180 - rightAngle);
  const total = l + r;
  const leftFrac = total > 1e-6 ? l / total : 0.5;
  return {
    t, kind: 'loadingDistribution', joint: 'limb',
    value: leftFrac * 100, unit: '% left (EST)',
    modelSource: 'KineLab symmetric-depth proxy v0.1',
    confidence: 0.4,
    calibrationStatus: 'uncalibrated',
  };
}
