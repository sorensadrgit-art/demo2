// Hysteresis-based repetition detector. Dual thresholds prevent double
// counting near a single threshold; direction must dwell to commit a rep.
export interface RepEvent {
  index: number;
  startT: number; peakT: number; endT: number;
  peakAngle: number; startAngle: number; endAngle: number;
  excursion: number;
  concentricMs: number; eccentricMs: number;
  peakVelocity: number;
}

export interface RepDetectorOptions {
  /** Upper (flexion) trigger as fraction of running range. */
  highFrac: number;
  /** Lower (extension) reset as fraction of running range. */
  lowFrac: number;
  minExcursionDeg: number;
  minDurationMs: number;
}

export const DEFAULT_REP_OPTS: RepDetectorOptions = {
  highFrac: 0.7, lowFrac: 0.3, minExcursionDeg: 15, minDurationMs: 400,
};

export class RepetitionDetector {
  private runningMin = Infinity;
  private runningMax = -Infinity;
  private armed = false;
  private repStart = 0;
  private repStartAngle = 0;
  private peakAngle = 0;
  private peakT = 0;
  private peakVel = 0;
  private count = 0;
  reps: RepEvent[] = [];

  constructor(private opts: RepDetectorOptions = DEFAULT_REP_OPTS) {}

  get repCount() { return this.count; }

  reset() {
    this.runningMin = Infinity; this.runningMax = -Infinity;
    this.armed = false; this.count = 0; this.reps = [];
  }

  /** Push a smoothed, valid angle sample. Returns a completed rep if one closed. */
  push(t: number, angle: number, vel: number, valid: boolean): RepEvent | null {
    if (!valid || !Number.isFinite(angle)) return null;
    // Slowly-adapting range so drift does not freeze detection.
    this.runningMin = Math.min(angle, this.runningMin + 0.02);
    this.runningMax = Math.max(angle, this.runningMax - 0.02);
    const range = this.runningMax - this.runningMin;
    if (range < this.opts.minExcursionDeg) return null;
    const hi = this.runningMin + range * this.opts.highFrac;
    const lo = this.runningMin + range * this.opts.lowFrac;

    if (!this.armed && angle >= hi) {
      this.armed = true;
      this.repStart = t; this.repStartAngle = angle;
      this.peakAngle = angle; this.peakT = t; this.peakVel = Math.abs(vel);
    } else if (this.armed) {
      if (angle > this.peakAngle) { this.peakAngle = angle; this.peakT = t; }
      this.peakVel = Math.max(this.peakVel, Math.abs(vel));
      if (angle <= lo && t - this.repStart >= this.opts.minDurationMs) {
        this.armed = false;
        this.count += 1;
        const rep: RepEvent = {
          index: this.count,
          startT: this.repStart, peakT: this.peakT, endT: t,
          peakAngle: this.peakAngle, startAngle: this.repStartAngle, endAngle: angle,
          excursion: this.peakAngle - Math.min(this.repStartAngle, angle),
          concentricMs: this.peakT - this.repStart, eccentricMs: t - this.peakT,
          peakVelocity: this.peakVel,
        };
        this.reps.push(rep);
        return rep;
      }
    }
    return null;
  }
}
