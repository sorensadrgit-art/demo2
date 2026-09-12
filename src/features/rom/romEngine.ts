import type { JointId } from '../biomechanics/jointAngles';
import { meanSd, summarizeTrial } from '../biomechanics/movementMetrics';

export interface ROMSample { t: number; angle: number; vel: number; valid: boolean; }

export interface ROMTrial {
  id: string;
  joint: JointId;
  start: number; peak: number; min: number; excursion: number;
  peakVelocity: number; duration: number;
  sampleCount: number;
  startedAt: number; endedAt: number;
}

export interface TrialAggregate {
  n: number;
  meanPeak: number; sdPeak: number;
  meanExcursion: number; sdExcursion: number;
  changeVsFirst: number;
}

/** Goniometer trial recorder: Start → live extrema → Hold/Save. */
export class ROMEngine {
  private samples: ROMSample[] = [];
  private trialStart: number | null = null;
  private startAngle: number | null = null;
  recording = false;
  held = false;

  constructor(readonly joint: JointId) {}

  startMeasurement(t: number, angle: number) {
    this.samples = [];
    this.trialStart = t;
    this.startAngle = angle;
    this.recording = true;
    this.held = false;
  }

  hold() { this.held = true; }
  resume() { this.held = false; }
  reset() {
    this.samples = [];
    this.trialStart = null;
    this.startAngle = null;
    this.recording = false;
    this.held = false;
  }

  push(t: number, angle: number, vel: number, valid: boolean) {
    if (!this.recording || this.held || !valid || !Number.isFinite(angle)) return;
    this.samples.push({ t, angle, vel, valid });
  }

  liveStats() {
    if (!this.samples.length) return null;
    const s = summarizeTrial(this.samples);
    if (!s) return null;
    return {
      live: this.samples[this.samples.length - 1].angle,
      start: this.startAngle ?? s.min,
      max: s.max, min: s.min, excursion: s.excursion,
      peakVelocity: s.peakVelocity,
      duration: this.trialStart != null ? (this.samples[this.samples.length - 1].t - this.trialStart) / 1000 : s.duration,
      count: s.sampleCount,
    };
  }

  finishTrial(t: number): ROMTrial | null {
    const s = summarizeTrial(this.samples);
    if (!s || this.startAngle === null || this.trialStart === null) return null;
    const trial: ROMTrial = {
      id: `trial-${Date.now()}`,
      joint: this.joint,
      start: this.startAngle, peak: s.max, min: s.min, excursion: s.excursion,
      peakVelocity: s.peakVelocity, duration: (t - this.trialStart) / 1000,
      sampleCount: s.sampleCount,
      startedAt: this.trialStart, endedAt: t,
    };
    this.recording = false;
    return trial;
  }
}

export function aggregateTrials(trials: ROMTrial[]): TrialAggregate | null {
  if (!trials.length) return null;
  const peaks = meanSd(trials.map((t) => t.peak));
  const exc = meanSd(trials.map((t) => t.excursion));
  return {
    n: trials.length,
    meanPeak: peaks.mean, sdPeak: peaks.sd,
    meanExcursion: exc.mean, sdExcursion: exc.sd,
    changeVsFirst: trials.length > 1 ? trials[trials.length - 1].peak - trials[0].peak : 0,
  };
}
