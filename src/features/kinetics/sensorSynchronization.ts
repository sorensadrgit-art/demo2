import type { SensorSample } from './kineticsTypes';

/** Nearest-sensor-sample lookup against the shared session timeline. */
export function sampleAt(samples: SensorSample[], tSessionMs: number): SensorSample | null {
  if (!samples.length) return null;
  let best = samples[0]; let bestD = Math.abs(samples[0].t - tSessionMs);
  for (let i = 1; i < samples.length; i++) {
    const d = Math.abs(samples[i].t - tSessionMs);
    if (d < bestD) { bestD = d; best = samples[i]; }
  }
  return bestD <= 100 ? best : null;
}

/** Downsample a sensor channel into fixed buckets for timeline rendering. */
export function bucketize(
  samples: SensorSample[],
  t0: number, t1: number, buckets: number,
): Array<{ t: number; value: number | null }> {
  const out: Array<{ t: number; value: number | null }> = [];
  if (buckets <= 0) return out;
  const width = (t1 - t0) / buckets;
  for (let b = 0; b < buckets; b++) {
    const lo = t0 + b * width; const hi = lo + width;
    let sum = 0; let n = 0;
    for (const s of samples) {
      if (s.t >= lo && s.t < hi) { sum += s.value; n++; }
    }
    out.push({ t: lo + width / 2, value: n ? sum / n : null });
  }
  return out;
}
