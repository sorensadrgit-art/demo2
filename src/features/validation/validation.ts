// Internal validation module: app measurement vs reference (goniometer,
// force plate, dynamometer, marker-based mocap). Failed trials are kept.
export interface ValidationTrial {
  id: string;
  reference: number;
  app: number;
  joint: string;
  movement: string;
  cameraAngle: string;
  distanceM: number;
  confidence: number;
  tester: string;
  trialNumber: number;
  passed: boolean;
  notes?: string;
}

export interface ValidationStats {
  n: number;
  mae: number;
  rmse: number;
  bias: number;
  sd: number;
  reliabilityNote: string;
}

export function validationStats(trials: ValidationTrial[]): ValidationStats | null {
  const t = trials.filter((x) => Number.isFinite(x.reference) && Number.isFinite(x.app));
  if (!t.length) return null;
  const errs = t.map((x) => x.app - x.reference);
  const abs = errs.map(Math.abs);
  const mae = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sd = errs.length > 1
    ? Math.sqrt(errs.reduce((a, b) => a + (b - bias) ** 2, 0) / (errs.length - 1))
    : 0;
  return {
    n: t.length, mae, rmse, bias, sd,
    reliabilityNote: 'ICC and Bland-Altman require ≥20 paired trials across testers; computed in the full validation report.',
  };
}

export function blandAltman(trials: ValidationTrial[]): Array<{ mean: number; diff: number }> {
  return trials
    .filter((x) => Number.isFinite(x.reference) && Number.isFinite(x.app))
    .map((x) => ({ mean: (x.reference + x.app) / 2, diff: x.app - x.reference }));
}
