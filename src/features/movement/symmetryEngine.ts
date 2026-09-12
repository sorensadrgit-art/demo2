// Bilateral comparison. Every symmetry figure exposes its underlying
// metrics — never a single unexplained score.
export interface SymmetryMetric {
  label: string;
  left: number; right: number;
  difference: number; // |L − R| in native units
  symmetryPct: number; // 100 * min/max
  unit: string;
}

export function symmetryOf(label: string, left: number, right: number, unit: string): SymmetryMetric | null {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const mx = Math.max(Math.abs(left), Math.abs(right));
  const symmetryPct = mx > 1e-9 ? (Math.min(Math.abs(left), Math.abs(right)) / mx) * 100 : 100;
  return { label, left, right, difference: Math.abs(left - right), symmetryPct, unit };
}

export interface BilateralSample { t: number; left: number; right: number; }

export function symmetrySeries(samples: BilateralSample[], label: string, unit: string): SymmetryMetric | null {
  const l = samples.map((s) => s.left).filter(Number.isFinite);
  const r = samples.map((s) => s.right).filter(Number.isFinite);
  if (!l.length || !r.length) return null;
  const peak = (a: number[]) => Math.max(...a.map(Math.abs));
  return symmetryOf(label, peak(l), peak(r), unit);
}

/** Cross-correlation lag (ms) between sides — positive = right leads. */
export function timingLagMs(samples: BilateralSample[]): number {
  const n = samples.length;
  if (n < 8) return NaN;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const l = samples.map((s) => s.left); const r = samples.map((s) => s.right);
  const ml = mean(l); const mr = mean(r);
  let bestLag = 0; let bestCorr = -Infinity;
  const maxLag = Math.min(30, Math.floor(n / 3));
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let num = 0, dl = 0, dr = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      num += (l[i] - ml) * (r[j] - mr);
      dl += (l[i] - ml) ** 2; dr += (r[j] - mr) ** 2;
    }
    const corr = num / Math.max(1e-9, Math.sqrt(dl * dr));
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  const dt = n > 1 ? (samples[n - 1].t - samples[0].t) / (n - 1) : 0;
  return bestLag * dt;
}
