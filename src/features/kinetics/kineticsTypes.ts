// Three strictly separated data classifications:
// MOTION MEASURED (camera) vs KINETICS ESTIMATED (model) vs FORCE MEASURED (sensor).
export type DataClass = 'measured-motion' | 'estimated-kinetic' | 'measured-force';

export interface EstimatedKineticSample {
  t: number;
  kind: 'jointMoment' | 'jointLoading' | 'grfProfile' | 'muscleDemand' | 'loadingDistribution';
  joint?: string;
  value: number;
  unit: string;
  modelSource: string;
  confidence: number; // 0..1
  calibrationStatus: 'uncalibrated' | 'anthropometric' | 'calibrated';
}

export type SensorType =
  | 'forcePlate' | 'dynamometer' | 'loadCell'
  | 'pressureInsole' | 'balancePlate' | 'bleRehab'
  | 'imu' | 'emg';

export interface SensorSample {
  t: number; // session-monotonic ms (mapped via DeviceTimeMapper)
  deviceId: string;
  sensorType: SensorType;
  value: number;
  unit: string;
  confidence: number;
  sampleRate: number;
}

export const ESTIMATED_DISCLAIMER =
  'ESTIMATED — model-derived from camera motion, not a direct force measurement. Not medically validated.';
