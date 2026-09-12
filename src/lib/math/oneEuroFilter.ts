// One Euro Filter: low-latency adaptive smoothing for landmark streams.
// Preserves fast intentional motion while suppressing keypoint jitter.
export interface OneEuroOptions {
  minCutoff: number; // steady-state cutoff (Hz)
  beta: number; // speed coefficient
  dCutoff: number; // derivative cutoff (Hz)
}

export const DEFAULT_ONE_EURO: OneEuroOptions = { minCutoff: 1.2, beta: 0.02, dCutoff: 1.0 };

class LowPass {
  private y: number | null = null;
  private a = 0;
  setAlpha(alpha: number) { this.a = alpha; }
  filter(x: number): number {
    this.y = this.y === null ? x : this.a * x + (1 - this.a) * this.y;
    return this.y;
  }
  reset() { this.y = null; }
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / Math.max(1e-6, dt));
};

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  constructor(private opts: OneEuroOptions = DEFAULT_ONE_EURO) {}
  configure(opts: Partial<OneEuroOptions>) { this.opts = { ...this.opts, ...opts }; }
  filter(value: number, tSeconds: number): number {
    const dt = this.lastT === null ? 1 / 60 : Math.max(1e-4, tSeconds - this.lastT);
    this.lastT = tSeconds;
    const dRaw = this.lastT === null ? 0 : 0;
    void dRaw;
    const dValue = this.dx.filter === undefined ? 0 : 0;
    void dValue;
    const prevEst = (this.x as unknown as { y: number | null }).y;
    const d = prevEst === null ? 0 : (value - prevEst) / dt;
    this.dx.setAlpha(alpha(this.opts.dCutoff, dt));
    const dHat = this.dx.filter(d);
    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(dHat);
    this.x.setAlpha(alpha(cutoff, dt));
    return this.x.filter(value);
  }
  reset() { this.x.reset(); this.dx.reset(); this.lastT = null; }
}

/** Bank of filters for a full landmark set (x/y/z independently). */
export class LandmarkSmoother {
  private filters: OneEuroFilter[] = [];
  constructor(count = 33, opts: OneEuroOptions = DEFAULT_ONE_EURO) {
    for (let i = 0; i < count * 3; i++) this.filters.push(new OneEuroFilter(opts));
  }
  configure(opts: Partial<OneEuroOptions>) { for (const f of this.filters) f.configure(opts); }
  smooth(values: Float32Array | number[], tSeconds: number): Float32Array {
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = this.filters[i % this.filters.length].filter(values[i], tSeconds);
    return out;
  }
  reset() { for (const f of this.filters) f.reset(); }
}
