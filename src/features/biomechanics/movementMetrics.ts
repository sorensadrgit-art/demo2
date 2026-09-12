/** Aggregate statistics over a trial's angle/velocity samples. */
export interface TrialStats {
  min: number; max: number; excursion: number;
  mean: number; sd: number;
  peakVelocity: number; meanVelocity: number;
  duration: number; sampleCount: number;
}

export function summarizeTrial(samples: Array<{ t: number; angle: number; vel: number }>): TrialStats | null {
  const valid = samples.filter((s) => Number.isFinite(s.angle));
  if (valid.length < 2) return null;
  const angles = valid.map((s) => s.angle);
  const min = Math.min(...angles);
  const max = Math.max(...angles);
  const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
  const sd = Math.sqrt(angles.reduce((a, b) => a + (b - mean) ** 2, 0) / angles.length);
  const vels = valid.map((s) => Math.abs(s.vel)).filter(Number.isFinite);
  return {
    min, max, excursion: max - min, mean, sd,
    peakVelocity: vels.length ? Math.max(...vels) : 0,
    meanVelocity: vels.length ? vels.reduce((a, b) => a + b, 0) / vels.length : 0,
    duration: (valid[valid.length - 1].t - valid[0].t) / 1000,
    sampleCount: valid.length,
  };
}

export function meanSd(values: number[]): { mean: number; sd: number; n: number } {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1
    ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1))
    : 0;
  return { mean, sd, n: v.length };
}

/** Dimensionless-jerk smoothness 0-100 (higher = smoother). */
export function smoothnessScore(
  samples: Array<{ t: number; angle: number }>,
  excursion: number,
): number {
  if (samples.length < 5 || excursion <= 0) return NaN;
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (dt <= 0) return NaN;
  const step = Math.max(1e-3, dt / samples.length);
  let jerkSum = 0;
  for (let i = 2; i < samples.length - 1; i++) {
    const j = (samples[i + 1].angle - 2 * samples[i].angle + samples[i - 1].angle) / Math.pow(step, 3);
    jerkSum += Math.abs(j);
  }
  const normalized = (jerkSum / samples.length) * Math.pow(dt, 3) / Math.max(1e-6, excursion);
  return Math.max(0, Math.min(100, 100 - Math.min(100, normalized / 10)));
}
