import { angleDelta } from '../../lib/math/vectors';

/** Central-difference angular velocity (deg/s) over a timestamped angle series. */
export function angularVelocity(
  series: Array<{ t: number; angle: number }>,
  index: number,
  window = 1,
): number {
  const i0 = Math.max(0, index - window);
  const i1 = Math.min(series.length - 1, index + window);
  if (i1 <= i0) return 0;
  const dt = (series[i1].t - series[i0].t) / 1000;
  if (dt <= 1e-6) return 0;
  const a0 = series[i0].angle; const a1 = series[i1].angle;
  if (!Number.isFinite(a0) || !Number.isFinite(a1)) return 0;
  return angleDelta(a1, a0) / dt;
}

/** Angular acceleration (deg/s^2) from a velocity series. */
export function angularAcceleration(
  series: Array<{ t: number; vel: number }>,
  index: number,
  window = 1,
): number {
  const i0 = Math.max(0, index - window);
  const i1 = Math.min(series.length - 1, index + window);
  if (i1 <= i0) return 0;
  const dt = (series[i1].t - series[i0].t) / 1000;
  if (dt <= 1e-6) return 0;
  const v0 = series[i0].vel; const v1 = series[i1].vel;
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return 0;
  return (v1 - v0) / dt;
}
