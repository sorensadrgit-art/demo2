import { LM, type NormalizedLandmark, type PoseDetection } from '../pose/poseTypes';

/**
 * PatientIdentityManager — the single owner of "who is the patient".
 *
 * Separates DETECTION (MediaPipe poses in) from IDENTITY (stable patient
 * track out) from RENDERING (the canvas never sees candidates, only the
 * locked patient's landmarks). Multiple humans may be detected internally;
 * at most one is ever exposed as the patient, and no bounding boxes leave
 * this module during normal Focus operation.
 *
 * No biomechanics here: angles, planes, confidence and trial logic live
 * downstream and consume only the locked patient's landmarks.
 */

export type IdentityState = 'locked' | 'reacquiring' | 'lost' | 'unselected';

/** Re-exported for existing import sites (sessionStore, focusMachine). */
export type TrackingState = IdentityState;

/** One minimal cue when auto-acquisition cannot pick a dominant candidate. */
export type AcquisitionCue = 'step-into-position' | 'clear-area' | null;

export interface AcquisitionConfig {
  /** Stable frames before the winner locks (stability gate). */
  stabilityFrames: number;
  /** Minimum score margin for a dominant candidate (else ambiguous). */
  dominanceMargin: number;
  /** Minimum score to lock at all (else remain unacquired). */
  minLockScore: number;
  /** Reacquisition match threshold (strong match required; else TARGET LOST). */
  reacquireThreshold: number;
  /** Association gate: detections outside the patient ROI cannot match. */
  roiPadding: number;
  /** Stale-track prune interval (ms). Active track is never pruned by time. */
  pruneMs: number;
}

export const DEFAULT_ACQUISITION: AcquisitionConfig = {
  // At ~15–30 Hz inference, 12 stable samples ≈ 500–1000 ms of observation.
  stabilityFrames: 12,
  dominanceMargin: 0.12,
  minLockScore: 0.45,
  reacquireThreshold: 0.62,
  roiPadding: 0.22,
  pruneMs: 5000,
};

export interface CandidateScore {
  index: number;
  score: number;
  reasons: { coverage: number; center: number; scale: number; visibility: number; stability: number };
}

export interface SessionDescriptor {
  /** Pelvis-normalized skeletal proportions (ephemeral, session-only). */
  proportions: number[];
  /** Body scale at acquisition (torso height in normalized units). */
  scale: number;
  /** Shoulder width at acquisition. */
  shoulderWidth: number;
  /** Motion state at acquisition (centroid velocity). */
  velocity: { x: number; y: number };
  /** Acquisition timestamp (session clock). */
  acquiredAt: number;
}

interface InternalTrack {
  id: number;
  centroid: { x: number; y: number };
  velocity: { x: number; y: number };
  torsoHeight: number;
  shoulderWidth: number;
  /** Pelvis-normalized geometry signature (session descriptor basis). */
  signature: number[];
  lastSeen: number;
  confidence: number;
  /** Consecutive frames as the winning acquisition candidate. */
  winStreak: number;
  /** Frames observed (for stability weighting). */
  seenFrames: number;
  bbox: PoseDetection['bbox'];
}

const pelvisOf = (lms: NormalizedLandmark[]) => ({
  x: (lms[LM.leftHip].x + lms[LM.rightHip].x) / 2,
  y: (lms[LM.leftHip].y + lms[LM.rightHip].y) / 2,
});

const torsoOf = (lms: NormalizedLandmark[]) => {
  const sh = {
    x: (lms[LM.leftShoulder].x + lms[LM.rightShoulder].x) / 2,
    y: (lms[LM.leftShoulder].y + lms[LM.rightShoulder].y) / 2,
  };
  const hip = pelvisOf(lms);
  return {
    torsoHeight: Math.hypot(sh.x - hip.x, sh.y - hip.y),
    shoulderWidth: Math.abs(lms[LM.leftShoulder].x - lms[LM.rightShoulder].x),
    center: { x: (sh.x + hip.x) / 2, y: (sh.y + hip.y) / 2 },
  };
};

/** Stable landmark subset for geometry signatures (major joints only). */
const SIG_IDX = [
  LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow,
  LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
  LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
];

/**
 * Pelvis-normalized skeletal signature: translation-invariant, scale-
 * normalized by torso height. Screen translation cannot destroy similarity.
 */
export function geometrySignature(lms: NormalizedLandmark[]): { sig: number[]; scale: number } {
  const pelvis = pelvisOf(lms);
  const t = torsoOf(lms);
  const scale = Math.max(1e-4, t.torsoHeight);
  const sig: number[] = [];
  for (const i of SIG_IDX) {
    const l = lms[i];
    const w = l.visibility >= 0.2 ? 1 : 0;
    sig.push(((l.x - pelvis.x) / scale) * w, ((l.y - pelvis.y) / scale) * w, w);
  }
  return { sig, scale };
}

/** Cosine-style similarity of two signatures over mutually visible joints. */
export function signatureSimilarity(a: number[], b: number[]): number {
  let dot = 0; let na = 0; let nb = 0; let overlap = 0;
  for (let i = 0; i + 2 < a.length + 1 && i + 2 < b.length + 1; i += 3) {
    const wa = a[i + 2]; const wb = b[i + 2];
    if (wa <= 0 || wb <= 0) continue;
    overlap++;
    dot += a[i] * b[i] + a[i + 1] * b[i + 1];
    na += a[i] * a[i] + a[i + 1] * a[i + 1];
    nb += b[i] * b[i] + b[i + 1] * b[i + 1];
  }
  if (!overlap || na <= 0 || nb <= 0) return 0;
  return Math.max(0, dot / Math.sqrt(na * nb));
}

const REQUIRED_PROTOCOL_LANDMARKS = [
  LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow,
  LM.leftWrist, LM.rightWrist, LM.leftHip, LM.rightHip,
  LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle,
];

function visibilityOf(lms: NormalizedLandmark[]): { full: number; required: number } {
  let full = 0; let fullN = 0;
  for (const l of lms) {
    if (l.visibility < 0) continue;
    fullN++;
    if (l.visibility >= 0.4) full++;
  }
  let req = 0;
  for (const i of REQUIRED_PROTOCOL_LANDMARKS) {
    if (lms[i] && lms[i].visibility >= 0.4) req++;
  }
  return {
    full: fullN ? full / fullN : 0,
    required: req / REQUIRED_PROTOCOL_LANDMARKS.length,
  };
}

/**
 * Multi-signal acquisition score. Never index-0: confidence, landmark
 * visibility, protocol coverage, clinical-center distance, usable image
 * coverage, temporal stability and body-scale plausibility all contribute.
 * The internal capture center is never rendered.
 */
export function scoreCandidate(
  det: PoseDetection,
  seenFrames: number,
): CandidateScore & { index: number } {
  const lms = det.landmarks;
  const t = torsoOf(lms);
  const vis = visibilityOf(lms);
  const distCenter = Math.hypot(t.center.x - 0.5, t.center.y - 0.48);
  const center = Math.max(0, 1 - distCenter * 2.2);
  const coverage = Math.min(1, (det.bbox.w * det.bbox.h) / 0.18);
  const plausible = t.torsoHeight > 0.04 && t.torsoHeight < 0.9 ? 1 : 0.2;
  const scale = Math.min(1, coverage) * plausible;
  const stability = Math.min(1, seenFrames / DEFAULT_ACQUISITION.stabilityFrames);
  const score =
    det.score * 0.22
    + vis.required * 0.26
    + vis.full * 0.1
    + center * 0.18
    + scale * 0.14
    + stability * 0.1;
  return {
    index: -1,
    score,
    reasons: { coverage: scale, center, scale, visibility: vis.required, stability },
  };
}

/**
 * Appearance / ReID cue interface. Motion + pose + geometry carry identity;
 * appearance is a replaceable secondary cue used only during ambiguity and
 * reacquisition — never per-frame, never alone, never uploaded.
 */
export interface AppearanceMatcher {
  readonly kind: string;
  /** 0..1 similarity, or null when no descriptor is available. */
  similarity(a: SessionDescriptor, b: SessionDescriptor): number | null;
}

/** Default: no appearance signal (geometry + motion decide). */
export class NullAppearanceMatcher implements AppearanceMatcher {
  readonly kind = 'none';
  similarity(): number | null { return null; }
}

export interface IdentityResult {
  state: IdentityState;
  active: PoseDetection | null;
  activeId: number | null;
  /** Internal only — never rendered in Focus. Exposed for Lab/debug + tests. */
  candidates: Array<{ id: number; bbox: PoseDetection['bbox']; score: number }>;
  cue: AcquisitionCue;
  /** Consecutive identity-preserving frames (for tests/telemetry). */
  lockFrames: number;
  /** Identity switches since session start (must stay 0 across crossings). */
  idSwitches: number;
}

export class PatientIdentityManager {
  activePatientId: number | null = null;
  state: IdentityState = 'unselected';
  config: AcquisitionConfig = { ...DEFAULT_ACQUISITION };
  appearance: AppearanceMatcher = new NullAppearanceMatcher();

  private tracks = new Map<number, InternalTrack>();
  private nextId = 1;
  private lastTimestamp = 0;
  private lostSince = 0;
  private reacquireUntil = 0;
  private lockFrames = 0;
  private idSwitches = 0;
  private descriptor: SessionDescriptor | null = null;
  private seenCount = new Map<number, number>();
  private winCandidate: { fp: string; streak: number } | null = null;

  /** Reacquisition window before TARGET LOST (ms). */
  reacquireWindowMs = 2500;
  /** Association gate (compat with previous matchThreshold semantics). */
  matchThreshold = 0.55;

  /** Manual/emergency reassignment (Lab + hidden recovery only). */
  selectSubject(id: number, now: number) {
    if (this.activePatientId !== null && this.activePatientId !== id) this.idSwitches += 1;
    this.activePatientId = id;
    this.state = this.tracks.has(id) ? 'locked' : 'reacquiring';
    this.reacquireUntil = now + this.reacquireWindowMs;
    this.lockFrames = 0;
    this.descriptor = this.descriptorFor(id, now);
  }

  /** Assessment reset / deliberate patient change / session end. */
  clearSelection() {
    this.activePatientId = null;
    this.state = 'unselected';
    this.descriptor = null;
    this.lockFrames = 0;
    this.winCandidate = null;
  }

  /** Release the lock but keep tracks (e.g. protocol switch keeps people). */
  releaseLock() {
    this.clearSelection();
  }

  get sessionDescriptor(): SessionDescriptor | null {
    return this.descriptor;
  }

  get continuity(): number {
    if (this.state === 'locked') return 1;
    if (this.state === 'reacquiring') return 0.5;
    return 0;
  }

  /** Tracks map for subclass compat (Lab snapshots only). */
  protected get internalTracks(): Map<number, InternalTrack> {
    return this.tracks;
  }

  /** Internal track snapshot for Lab/debug surfaces (never Focus). */
  debugTrack(id: number): InternalTrack | null {
    return this.tracks.get(id) ?? null;
  }

  protected debugTrackCount(): number {
    return this.tracks.size;
  }

  /** Padded patient ROI (full-frame coords). Association gate, never rendered. */
  patientROI(): PoseDetection['bbox'] | null {
    const t = this.activePatientId !== null ? this.tracks.get(this.activePatientId) : undefined;
    if (!t) return null;
    const p = this.config.roiPadding;
    return {
      x: Math.max(0, t.bbox.x - p * t.bbox.w),
      y: Math.max(0, t.bbox.y - p * t.bbox.h),
      w: Math.min(1, t.bbox.w * (1 + 2 * p)),
      h: Math.min(1, t.bbox.h * (1 + 2 * p)),
    };
  }

  private descriptorFor(id: number, now: number): SessionDescriptor | null {
    const t = this.tracks.get(id);
    if (!t) return null;
    return {
      proportions: [...t.signature],
      scale: t.torsoHeight,
      shoulderWidth: t.shoulderWidth,
      velocity: { ...t.velocity },
      acquiredAt: now,
    };
  }

  private fingerprint(det: PoseDetection): string {
    const c = pelvisOf(det.landmarks);
    return `${Math.round(c.x * 20)}:${Math.round(c.y * 20)}:${Math.round(det.score * 10)}`;
  }

  /**
   * Descriptor verification: is this detection plausibly the SAME body that
   * was acquired? Pelvis-normalized geometry alone cannot separate two
   * upright humans (both score ~0.9), so body scale + shoulder width gate
   * alongside geometry. All three must agree; ambiguity resolves to NO match
   * (suspend), never to a switch.
   */
  private verifyAgainstDescriptor(det: PoseDetection): boolean {
    if (!this.descriptor) return true;
    const { sig, scale } = geometrySignature(det.landmarks);
    const sim = signatureSimilarity(this.descriptor.proportions, sig);
    const t = torsoOf(det.landmarks);
    const scaleChange = Math.abs(scale - this.descriptor.scale) / Math.max(1e-4, this.descriptor.scale);
    const shoulderChange = Math.abs(t.shoulderWidth - this.descriptor.shoulderWidth)
      / Math.max(1e-4, this.descriptor.shoulderWidth);
    return sim >= 0.5 && scaleChange <= 0.35 && shoulderChange <= 0.45;
  }

  update(detections: PoseDetection[], now: number): IdentityResult {
    const dt = Math.max(1, now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    // Predict tracks forward (constant-velocity pelvis motion) for the
    // scout lane: full-frame discovery that stays invisible.
    const predicted = new Map<number, { x: number; y: number }>();
    for (const t of this.tracks.values()) {
      predicted.set(t.id, {
        x: t.centroid.x + t.velocity.x * dt,
        y: t.centroid.y + t.velocity.y * dt,
      });
    }

    // Multi-cue association: predicted pelvis distance + velocity continuity
    // + body scale + pelvis-normalized geometry + visibility.
    const unmatched = new Set(detections.map((_, i) => i));
    const assignments = new Map<number, number>();
    const detSig = detections.map((d) => geometrySignature(d.landmarks));
    for (const [sid, track] of this.tracks) {
      let best = -1; let bestCost = Infinity;
      detections.forEach((d, di) => {
        if (!unmatched.has(di)) return;
        // The locked patient only ever ingests descriptor-verified detections:
        // a different body in the slot is rejected here (stays unmatched and
        // becomes its own track) instead of corrupting the patient track.
        if (sid === this.activePatientId && this.descriptor && !this.verifyAgainstDescriptor(d)) return;
        const c = pelvisOf(d.landmarks);
        const pred = predicted.get(sid) ?? track.centroid;
        const dist = Math.hypot(c.x - pred.x, c.y - pred.y);
        const g = torsoOf(d.landmarks);
        const scalePenalty =
          Math.abs(g.torsoHeight - track.torsoHeight) * 2
          + Math.abs(g.shoulderWidth - track.shoulderWidth) * 2;
        const sim = signatureSimilarity(track.signature, detSig[di].sig);
        const vis = visibilityOf(d.landmarks);
        const cost =
          dist * 2.2
          + scalePenalty
          + (1 - sim) * 1.4
          + (1 - vis.required) * 0.6
          + (1 - d.score) * 0.4;
        if (cost < bestCost) { bestCost = cost; best = di; }
      });
      if (best >= 0 && bestCost < this.matchThreshold * 2.6) {
        // Sticky-lock guard: while locked, only the ACTIVE track may claim a
        // detection inside the patient ROI — nobody steals the patient.
        if (this.activePatientId !== null && sid !== this.activePatientId) {
          const roi = this.patientROI();
          if (roi) {
            const c = pelvisOf(detections[best].landmarks);
            const inside =
              c.x >= roi.x && c.x <= roi.x + roi.w && c.y >= roi.y && c.y <= roi.y + roi.h;
            if (inside) continue;
          }
        }
        assignments.set(best, sid);
        unmatched.delete(best);
      }
    }
    for (const di of unmatched) {
      const id = this.nextId++;
      const d = detections[di];
      const c = pelvisOf(d.landmarks);
      const g = torsoOf(d.landmarks);
      this.tracks.set(id, {
        id, centroid: c, velocity: { x: 0, y: 0 },
        torsoHeight: g.torsoHeight, shoulderWidth: g.shoulderWidth,
        signature: detSig[di].sig, lastSeen: now, confidence: d.score,
        winStreak: 0, seenFrames: 1, bbox: d.bbox,
      });
      this.seenCount.set(id, 1);
      assignments.set(di, id);
    }
    for (const [di, sid] of assignments) {
      const d = detections[di];
      const s = this.tracks.get(sid);
      if (!s) continue;
      const c = pelvisOf(d.landmarks);
      s.velocity = {
        x: s.velocity.x * 0.6 + ((c.x - s.centroid.x) / dt) * 0.4,
        y: s.velocity.y * 0.6 + ((c.y - s.centroid.y) / dt) * 0.4,
      };
      s.centroid = c; s.bbox = d.bbox; s.lastSeen = now; s.confidence = d.score;
      s.seenFrames += 1;
      this.seenCount.set(sid, (this.seenCount.get(sid) ?? 0) + 1);
      const g = torsoOf(d.landmarks);
      s.torsoHeight = s.torsoHeight * 0.92 + g.torsoHeight * 0.08;
      s.shoulderWidth = s.shoulderWidth * 0.92 + g.shoulderWidth * 0.08;
      const { sig } = detSig[di];
      s.signature = s.signature.map((v, i) => v * 0.9 + sig[i] * 0.1);
    }
    for (const [sid, s] of this.tracks) {
      if (sid !== this.activePatientId && now - s.lastSeen > this.config.pruneMs) {
        this.tracks.delete(sid);
        this.seenCount.delete(sid);
      }
    }

    const candidates = [...this.tracks.values()].map((s) => ({ id: s.id, bbox: s.bbox, score: s.confidence }));

    // ---- Automatic acquisition (invisible): score, require dominance +
    // stability over consecutive samples, then sticky-lock. ----
    let cue: AcquisitionCue = null;
    if (this.activePatientId === null && detections.length > 0) {
      const scored = [...assignments.entries()].map(([di, sid]) => {
        const sc = scoreCandidate(detections[di], this.seenCount.get(sid) ?? 1);
        sc.index = di;
        return { sid, di, sc };
      }).sort((a, b) => b.sc.score - a.sc.score);
      const top = scored[0];
      const runner = scored[1]?.sc.score ?? -Infinity;
      const margin = top.sc.score - runner;
      const dominant = top.sc.score >= this.config.minLockScore
        && (scored.length === 1 || margin >= this.config.dominanceMargin);
      if (dominant) {
        const fp = this.fingerprint(detections[top.di]);
        const streak = this.winCandidate?.fp === fp ? this.winCandidate.streak + 1 : 1;
        this.winCandidate = { fp, streak };
        if (streak >= this.config.stabilityFrames) {
          this.activePatientId = top.sid;
          this.state = 'locked';
          this.lockFrames = 0;
          this.descriptor = this.descriptorFor(top.sid, now);
          this.winCandidate = null;
        }
      } else {
        this.winCandidate = null;
        cue = scored.length > 1 && top.sc.score - runner < this.config.dominanceMargin
          ? 'clear-area'
          : 'step-into-position';
      }
    }

    if (this.activePatientId === null) {
      if (this.state !== 'unselected') this.state = 'unselected';
      return {
        state: this.state, active: null, activeId: null,
        candidates, cue, lockFrames: 0, idSwitches: this.idSwitches,
      };
    }

    // ---- Sticky patient lane: find the ORIGINAL patient, nobody else. ----
    let active: PoseDetection | null = null;
    for (const [di, sid] of assignments) {
      if (sid === this.activePatientId) { active = detections[di]; break; }
    }
    if (active) {
      // Belt-and-braces: the association gate already verified this detection,
      // but if anything changed under us, hold identity and suspend.
      if (this.descriptor && !this.verifyAgainstDescriptor(active)) {
        this.state = 'reacquiring';
        this.lostSince = now;
        this.reacquireUntil = now + this.reacquireWindowMs;
        return {
          state: this.state, active: null, activeId: this.activePatientId,
          candidates, cue, lockFrames: this.lockFrames, idSwitches: this.idSwitches,
        };
      }
      this.state = 'locked';
      this.lockFrames += 1;
      this.lostSince = 0;
      this.reacquireUntil = 0;
    } else {
      // Patient absent: predict for association only, suspend measurement,
      // search for the ORIGINAL patient — never hand the overlay to another.
      if (this.state === 'locked' || this.state === 'unselected') {
        this.state = 'reacquiring';
        this.lostSince = now;
        this.reacquireUntil = now + this.reacquireWindowMs;
      } else if (this.state === 'reacquiring' && now > this.reacquireUntil) {
        // Before declaring LOST, attempt descriptor-based reacquisition: is
        // a currently visible candidate a strong match to the ORIGINAL?
        const found = this.reacquireFromDescriptor(detections, assignments);
        if (found) {
          active = found;
          this.state = 'locked';
          this.lockFrames += 1;
        } else {
          this.state = 'lost';
        }
      }
    }
    return {
      state: this.state, active, activeId: this.activePatientId,
      candidates, cue, lockFrames: this.lockFrames, idSwitches: this.idSwitches,
    };
  }

  /** Search visible candidates for a strong match to the ORIGINAL patient. */
  private reacquireFromDescriptor(
    detections: PoseDetection[],
    assignments: Map<number, number>,
  ): PoseDetection | null {
    if (!this.descriptor || this.activePatientId === null) return null;
    let best: PoseDetection | null = null;
    let bestScore = -Infinity;
    detections.forEach((d, di) => {
      const sid = assignments.get(di);
      if (sid === this.activePatientId) return; // handled by the sticky lane
      // Hard gates first: scale and shoulder must agree with the ORIGINAL.
      const { sig, scale } = geometrySignature(d.landmarks);
      const t = torsoOf(d.landmarks);
      const scaleChange = Math.abs(scale - this.descriptor!.scale) / Math.max(1e-4, this.descriptor!.scale);
      const shoulderChange = Math.abs(t.shoulderWidth - this.descriptor!.shoulderWidth)
        / Math.max(1e-4, this.descriptor!.shoulderWidth);
      if (scaleChange > 0.4 || shoulderChange > 0.5) return;
      const sim = signatureSimilarity(this.descriptor!.proportions, sig);
      if (sim < 0.5) return;
      const score = sim * 0.8 + (1 - Math.min(1, scaleChange * 3)) * 0.2;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    // Strong match only — the therapist alone in frame must NOT match.
    // False non-acquisition beats an identity switch.
    if (best && bestScore >= this.config.reacquireThreshold) return best;
    return null;
  }
}
