import { summarizeTrial } from '../biomechanics/movementMetrics';
import type { ConfidenceLevel } from '../biomechanics/confidence';
import type { TrackingState } from '../tracking/subjectTracker';
import type { ClinicalProtocol } from './protocols';

/** Orchestration states. The therapist sees Patient → Test → Perform → Review. */
export type FocusPhase =
  | 'patient'
  | 'assessment'
  | 'setup'
  | 'positioning'
  | 'calibrating'
  | 'acquiring'
  | 'ready'
  | 'recording'
  | 'validating'
  | 'trial-complete'
  | 'ready-next'
  | 'assessment-complete'
  | 'review'
  | 'error';

export type TrialVerdict = 'valid' | 'valid-warning' | 'retake-recommended' | 'invalid';

export interface TrialQualityInput {
  samples: Array<{ t: number; angle: number; vel: number }>;
  minSamples: number;
  validRatio: number;
  tracking: TrackingState;
  calibQuality: number;
  viewSuitability: number;
  liveLevel: ConfidenceLevel;
  completedCycles: number;
  requiredCycles: number;
  minExcursionDeg: number;
  occludedRatio: number;
}

export interface TrialVerdictResult {
  verdict: TrialVerdict;
  reasons: string[];
  stats: { min: number; max: number; excursion: number; peakVelocity: number; duration: number; sampleCount: number } | null;
}

/** Automatic quality gate. Never accepts a trial the sensors cannot support. */
export function evaluateTrialQuality(i: TrialQualityInput): TrialVerdictResult {
  const reasons: string[] = [];
  const stats = summarizeTrial(i.samples);
  const hardFail =
    i.tracking === 'lost'
    || i.liveLevel === 'suspended'
    || i.calibQuality < 0.4
    || i.viewSuitability < 0.4;
  if (i.tracking === 'lost') reasons.push('Target was lost during the trial.');
  if (i.liveLevel === 'suspended') reasons.push('Tracking confidence was too low to measure.');
  if (i.calibQuality < 0.4) reasons.push('Calibration was incomplete.');
  if (i.viewSuitability < 0.4) reasons.push('Camera plane was incorrect for this movement.');
  const insufficient = !!stats && stats.excursion < i.minExcursionDeg;
  const incomplete = i.completedCycles < i.requiredCycles;
  if (!stats) reasons.push('Not enough movement was captured.');
  if (insufficient && stats) {
    reasons.push(`Movement was too small (${stats.excursion.toFixed(0)}° of ${i.minExcursionDeg}° required).`);
  }
  if (incomplete) {
    reasons.push(`Only ${i.completedCycles} of ${i.requiredCycles} repetitions completed.`);
  }
  // An incomplete or immeasurable trial cannot count — the trial is retried.
  if (hardFail || !stats || insufficient || incomplete) return { verdict: 'invalid', reasons, stats };

  const warnings: string[] = [];
  if (i.occludedRatio > 0.25) warnings.push(`Landmarks were occluded during ${Math.round(i.occludedRatio * 100)}% of the movement.`);
  if (i.validRatio < 0.7) warnings.push(`Only ${Math.round(i.validRatio * 100)}% of frames were measurable.`);
  if (stats.excursion < i.minExcursionDeg * 1.2) warnings.push('Range of motion was smaller than expected.');
  if (warnings.length >= 2) return { verdict: 'retake-recommended', reasons: warnings, stats };
  if (warnings.length === 1) return { verdict: 'valid-warning', reasons: warnings, stats };
  return { verdict: 'valid', reasons: [], stats };
}

export interface FocusTrial {
  index: number;
  peak: number;
  min: number;
  excursion: number;
  peakVelocity: number;
  duration: number;
  sampleCount: number;
  verdict: TrialVerdict;
  reasons: string[];
  confidence: number;
  startedAt: number;
  endedAt: number;
}

/** Best-trial selection: measurement quality first, never just the largest ROM. */
export function selectBestTrial(trials: FocusTrial[]): { index: number; reason: string } | null {
  const usable = trials.filter((t) => t.verdict === 'valid' || t.verdict === 'valid-warning');
  if (!usable.length) return null;
  const scored = usable.map((t) => ({
    t,
    score: t.confidence * 0.5
      + Math.min(1, t.sampleCount / 120) * 0.25
      + (t.verdict === 'valid' ? 0.25 : 0.1),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].t;
  return {
    index: best.index,
    reason: `Trial ${best.index + 1} selected — highest measurement confidence (${Math.round(best.confidence * 100)}%).`,
  };
}

/** Pure transition guard: can the orchestrator move into READY? */
export function canEnterReady(input: {
  tracking: TrackingState;
  calibQuality: number;
  viewSuitability: number;
  level: ConfidenceLevel;
}): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (input.tracking !== 'locked') blockers.push('Patient target is not locked.');
  if (input.calibQuality < 0.4) blockers.push('Calibration is incomplete.');
  if (input.viewSuitability < 0.55) blockers.push('Camera plane is incorrect for this movement.');
  if (input.level === 'suspended' || input.level === 'low') blockers.push('Landmark confidence is too low.');
  return { ok: blockers.length === 0, blockers };
}

/** Movement-onset detector for automatic trial start. */
export class OnsetDetector {
  private baseline: number | null = null;
  private stillSince = 0;
  reset() { this.baseline = null; this.stillSince = 0; }

  /** Seed the resting angle; call each still frame in READY. */
  observeRest(angle: number, now: number) {
    this.baseline = this.baseline === null ? angle : this.baseline * 0.9 + angle * 0.1;
    this.stillSince = now;
  }

  /** True when the joint has moved decisively away from rest. */
  detect(angle: number, vel: number, onsetDeg: number): boolean {
    if (this.baseline === null || !Number.isFinite(angle)) return false;
    return Math.abs(angle - this.baseline) >= onsetDeg && Math.abs(vel) > 6;
  }
}

/** Trial-completion detector: cycles counted + return near start + stillness. */
export class CompletionDetector {
  private startAngle: number | null = null;
  private stillSince: number | null = null;
  reset() { this.startAngle = null; this.stillSince = null; }
  arm(startAngle: number) { this.startAngle = startAngle; this.stillSince = null; }

  /**
   * True when required cycles are done, the joint returned near its start
   * angle, and motion has settled (or the trial timed out).
   */
  detect(input: {
    now: number; angle: number; vel: number; valid: boolean;
    cyclesDone: number; required: number;
    returnTolDeg: number; stillnessMs: number; startT: number; maxDurationMs: number;
    excursionSoFar: number; minExcursionDeg: number;
  }): boolean {
    const i = input;
    if (i.now - i.startT > i.maxDurationMs) return true;
    if (this.startAngle === null || !i.valid || !Number.isFinite(i.angle)) return false;
    if (i.cyclesDone < i.required || i.excursionSoFar < i.minExcursionDeg) return false;
    const nearStart = Math.abs(i.angle - this.startAngle) <= i.returnTolDeg;
    const still = Math.abs(i.vel) < 10;
    if (nearStart && still) {
      if (this.stillSince === null) this.stillSince = i.now;
      if (i.now - this.stillSince >= i.stillnessMs) return true;
    } else {
      this.stillSince = null;
    }
    return false;
  }
}

/**
 * Count completed movement cycles from a smoothed angle stream.
 * Direction-agnostic: a cycle = leave the start angle by at least
 * minExcursionDeg, then return near it. Stillness gating belongs to
 * CompletionDetector; this counter only counts excursions.
 */
export class CycleCounter {
  private start = 0;
  private extreme = 0;
  private dir: 'idle' | 'away' | 'back' = 'idle';
  cycles = 0;
  reset() { this.dir = 'idle'; this.cycles = 0; this.start = 0; this.extreme = 0; }

  /** Push valid samples; returns total completed cycles. */
  push(angle: number, vel: number, minExcursionDeg: number): number {
    if (!Number.isFinite(angle)) return this.cycles;
    const moving = Math.abs(vel) > 8;
    if (this.dir === 'idle') {
      this.start = angle;
      this.extreme = angle;
      if (moving) this.dir = 'away';
      return this.cycles;
    }
    if (angle < Math.min(this.start, this.extreme)) this.extreme = Math.min(this.extreme, angle);
    if (angle > Math.max(this.start, this.extreme)) this.extreme = Math.max(this.extreme, angle);
    const excursion = Math.abs(this.extreme - this.start);
    const nearStart = Math.abs(angle - this.start) <= Math.max(6, excursion * 0.2);
    if (this.dir === 'away') {
      // Reversal toward start after a sufficient excursion begins the return.
      if (excursion >= minExcursionDeg && nearStart) {
        this.cycles += 1;
        this.dir = 'idle';
      } else if (excursion >= minExcursionDeg && !nearStart) {
        this.dir = 'back';
      }
    } else if (this.dir === 'back') {
      if (nearStart && excursion >= minExcursionDeg) {
        this.cycles += 1;
        this.dir = 'idle';
      } else if (!moving && !nearStart) {
        // Stalled mid-range: re-anchor so a fresh attempt can be counted.
        this.dir = 'idle';
      }
    }
    return this.cycles;
  }
}

export function trialNeedsRetake(t: FocusTrial): boolean {
  return t.verdict === 'invalid' || t.verdict === 'retake-recommended';
}
