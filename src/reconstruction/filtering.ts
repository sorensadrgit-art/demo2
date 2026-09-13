import type { FrameTimestamp, LandmarkPoint3D } from '../measurement/domain';

/**
 * Temporal 3D filtering (Phase 18). Timestamp-respecting One Euro smoothing
 * over reconstructed points. Raw and filtered trajectories are ALWAYS kept
 * separate; filtering never runs during tracking loss (null in → null out,
 * state resets so no fake values bridge a gap).
 */
export interface TemporalFilterOptions {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  /** Spike gate: jumps beyond this (m/s) reset the filter, not smoothed. */
  maxVelocityMps: number;
}

export const DEFAULT_TEMPORAL_FILTER: TemporalFilterOptions = {
  minCutoff: 1.2,
  beta: 0.02,
  dCutoff: 1.0,
  maxVelocityMps: 8,
};

class AxisFilter {
  private y: number | null = null;
  private dy: number | null = null;
  private lastT: number | null = null;
  constructor(private opts: TemporalFilterOptions) {}
  reset() { this.y = null; this.dy = null; this.lastT = null; }
  filter(x: number, t: number): number {
    const dt = this.lastT === null ? 1 / 60 : Math.max(1e-4, t - this.lastT);
    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(this.dy ?? 0);
    const alpha = 1 / (1 + (1 / (2 * Math.PI * cutoff)) / dt);
    const dAlpha = 1 / (1 + (1 / (2 * Math.PI * this.opts.dCutoff)) / dt);
    if (this.y === null || this.lastT === null) {
      this.y = x; this.dy = 0; this.lastT = t;
      return x;
    }
    const vel = (x - this.y) / dt;
    if (Math.abs(vel) > this.opts.maxVelocityMps) {
      this.reset();
      this.y = x; this.dy = 0; this.lastT = t;
      return x;
    }
    this.dy = dAlpha * vel + (1 - dAlpha) * (this.dy ?? 0);
    this.y = alpha * x + (1 - alpha) * this.y;
    this.lastT = t;
    return this.y;
  }
}

export interface FilteredPoint {
  raw: LandmarkPoint3D;
  filtered: LandmarkPoint3D;
  /** Residual between raw and filtered (m) — persisted for validation. */
  residualM: number;
}

/** Per-landmark temporal filter; raw and filtered kept side by side. */
export class PointTemporalFilter {
  private axes: AxisFilter[];
  constructor(private opts: TemporalFilterOptions = DEFAULT_TEMPORAL_FILTER) {
    this.axes = [new AxisFilter(opts), new AxisFilter(opts), new AxisFilter(opts)];
  }
  reset() { for (const a of this.axes) a.reset(); }
  /**
   * null input (tracking loss) → null output + state reset, so the next
   * valid sample starts fresh instead of interpolating across the gap.
   */
  update(raw: LandmarkPoint3D | null): FilteredPoint | null {
    if (!raw) { this.reset(); return null; }
    const t = raw.timestamp.monotonicMs / 1000;
    const fx = this.axes[0].filter(raw.xM, t);
    const fy = this.axes[1].filter(raw.yM, t);
    const fz = this.axes[2].filter(raw.zM, t);
    const filtered: LandmarkPoint3D = { ...raw, xM: fx, yM: fy, zM: fz };
    const residualM = Math.hypot(fx - raw.xM, fy - raw.yM, fz - raw.zM);
    return { raw, filtered, residualM };
  }
}

/** Filter bank keyed by landmark id. */
export class TemporalFilterBank {
  private filters = new Map<string, PointTemporalFilter>();
  constructor(private opts: TemporalFilterOptions = DEFAULT_TEMPORAL_FILTER) {}
  update(raw: LandmarkPoint3D | null, landmarkId: string): FilteredPoint | null {
    let f = this.filters.get(landmarkId);
    if (!f) { f = new PointTemporalFilter(this.opts); this.filters.set(landmarkId, f); }
    return f.update(raw);
  }
  reset(landmarkId?: string) {
    if (landmarkId) this.filters.get(landmarkId)?.reset();
    else for (const f of this.filters.values()) f.reset();
  }
}

export function timestampAt(monotonicMs: number, frameIndex: number): FrameTimestamp {
  return { monotonicMs, frameIndex };
}
