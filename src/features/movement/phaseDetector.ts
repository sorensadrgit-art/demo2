// Movement phase segmentation: rest → concentric → hold → eccentric → rest.
export type MovementPhase = 'rest' | 'concentric' | 'hold' | 'eccentric';

export interface PhaseSegment {
  phase: MovementPhase;
  startT: number; endT: number;
  startAngle: number; endAngle: number;
}

export class PhaseDetector {
  private current: MovementPhase = 'rest';
  private segStart = 0;
  private segAngle = 0;
  private stillSince = 0;
  segments: PhaseSegment[] = [];

  constructor(
    private velThreshold = 12, // deg/s — below = hold/rest
    private stillMs = 350,
  ) {}

  reset(t: number, angle: number) {
    this.current = 'rest'; this.segStart = t; this.segAngle = angle;
    this.stillSince = t; this.segments = [];
  }

  push(t: number, angle: number, vel: number): MovementPhase {
    const moving = Math.abs(vel) > this.velThreshold;
    let next: MovementPhase = this.current;
    if (this.current === 'rest') {
      if (moving) next = vel > 0 ? 'concentric' : 'eccentric';
    } else if (this.current === 'concentric' || this.current === 'eccentric') {
      if (!moving) {
        if (this.stillSince === 0 || t - this.stillSince > 0) {
          if (this.stillSince > 0 && t - this.stillSince >= 0) { /* dwell */ }
        }
        next = 'hold';
        this.stillSince = t;
      } else if ((this.current === 'concentric' && vel < -this.velThreshold)
        || (this.current === 'eccentric' && vel > this.velThreshold)) {
        next = this.current === 'concentric' ? 'eccentric' : 'concentric';
      }
    } else { // hold
      if (moving) next = vel > 0 ? 'concentric' : 'eccentric';
      else if (t - this.stillSince > this.stillMs && Math.abs(angle - this.segAngle) < 3) next = 'rest';
    }
    if (!moving && this.stillSince === 0) this.stillSince = t;
    if (moving) this.stillSince = 0;
    if (next !== this.current) {
      this.segments.push({
        phase: this.current, startT: this.segStart, endT: t,
        startAngle: this.segAngle, endAngle: angle,
      });
      this.current = next; this.segStart = t; this.segAngle = angle;
    }
    return this.current;
  }

  get phase() { return this.current; }
}
