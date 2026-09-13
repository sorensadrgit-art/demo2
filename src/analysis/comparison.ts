import { validationStats } from '../../src/features/validation/validation';

/**
 * Validation comparison statistics (Phase 36). Extends the existing
 * validation.ts (MAE/RMSE/bias/sd untouched) with Pearson correlation
 * and Bland–Altman preparation. All math unit-tested; ICC remains an
 * explicit placeholder interface until a robust implementation is
 * justified (documented in validation.ts reliabilityNote).
 */
export interface ComparisonStats {
  n: number;
  pearsonR: number | null;
  blandAltman: { meanDiff: number; sdDiff: number; loaLow: number; loaHigh: number } | null;
  /** Minimal detectable change inputs: SEM computed from sdDiff. */
  mdcInputs: { sem: number; mdc95: number } | null;
}

/** Pearson product-moment correlation (null when undefined). */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const xa = xs.slice(0, n); const ya = ys.slice(0, n);
  if (!xa.every(Number.isFinite) || !ya.every(Number.isFinite)) return null;
  const mx = xa.reduce((a, b) => a + b, 0) / n;
  const my = ya.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xa[i] - mx) * (ya[i] - my);
    sxx += (xa[i] - mx) ** 2;
    syy += (ya[i] - my) ** 2;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Bland–Altman preparation + MDC inputs from paired reference/app values. */
export function comparisonStats(reference: number[], app: number[]): ComparisonStats | null {
  const pairs = reference.map((r, i) => ({ r, a: app[i] }))
    .filter((p) => Number.isFinite(p.r) && Number.isFinite(p.a));
  if (pairs.length < 2) return null;
  const diffs = pairs.map((p) => p.a - p.r);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const sdDiff = diffs.length > 1
    ? Math.sqrt(diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / (diffs.length - 1))
    : 0;
  const sem = sdDiff / Math.SQRT2;
  return {
    n: pairs.length,
    pearsonR: pearsonCorrelation(pairs.map((p) => p.r), pairs.map((p) => p.a)),
    blandAltman: {
      meanDiff,
      sdDiff,
      loaLow: meanDiff - 1.96 * sdDiff,
      loaHigh: meanDiff + 1.96 * sdDiff,
    },
    mdcInputs: { sem, mdc95: 1.96 * Math.SQRT2 * sem },
  };
}

/** ICC placeholder: interface only — not computed until ≥20 paired trials. */
export interface ICCRequest {
  note: string;
  minTrials: number;
}

export function iccPlaceholder(): ICCRequest {
  return {
    note: 'ICC requires ≥20 paired trials across testers; computed in the full validation report, not from ad-hoc samples.',
    minTrials: 20,
  };
}

export { validationStats };
