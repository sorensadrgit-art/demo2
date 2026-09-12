import { LM, type NormalizedLandmark, type PoseDetection } from '../pose/poseTypes';

export type TrackingState = 'locked' | 'reacquiring' | 'lost' | 'unselected';

export interface TrackedSubject {
  id: number;
  bbox: PoseDetection['bbox'];
  centroid: { x: number; y: number };
  velocity: { x: number; y: number };
  torsoHeight: number;
  shoulderWidth: number;
  lastSeen: number;
  confidence: number;
  predictedBbox: PoseDetection['bbox'] | null;
}

const centroidOf = (lms: NormalizedLandmark[]) => {
  let x = 0, y = 0, n = 0;
  for (const l of lms) {
    if (l.visibility < 0.2) continue;
    x += l.x; y += l.y; n++;
  }
  return n ? { x: x / n, y: y / n } : { x: 0.5, y: 0.5 };
};

const torsoGeom = (lms: NormalizedLandmark[]) => {
  const sh = { x: (lms[LM.leftShoulder].x + lms[LM.rightShoulder].x) / 2, y: (lms[LM.leftShoulder].y + lms[LM.rightShoulder].y) / 2 };
  const hip = { x: (lms[LM.leftHip].x + lms[LM.rightHip].x) / 2, y: (lms[LM.leftHip].y + lms[LM.rightHip].y) / 2 };
  return {
    torsoHeight: Math.hypot(sh.x - hip.x, sh.y - hip.y),
    shoulderWidth: Math.abs(lms[LM.leftShoulder].x - lms[LM.rightShoulder].x),
  };
};

const iou = (a: PoseDetection['bbox'], b: PoseDetection['bbox']) => {
  const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
};

/**
 * Persistent subject lock. The clinician selects a person once
 * (activeSubjectId); association uses bbox continuity, centroid velocity
 * prediction, torso geometry and body proportions — never silent switching.
 */
export class SubjectTracker {
  activeSubjectId: number | null = null;
  state: TrackingState = 'unselected';
  private subjects = new Map<number, TrackedSubject>();
  private nextId = 1;
  private lastTimestamp = 0;
  private lostSince = 0;
  private reacquireUntil = 0;

  /** Cost threshold above which a detection cannot match the active subject. */
  matchThreshold = 0.55;
  /** How long (ms) to predict + attempt reacquisition before TARGET LOST. */
  reacquireWindowMs = 2500;

  selectSubject(id: number, now: number) {
    this.activeSubjectId = id;
    this.state = this.subjects.has(id) ? 'locked' : 'reacquiring';
    this.reacquireUntil = now + this.reacquireWindowMs;
  }

  clearSelection() {
    this.activeSubjectId = null;
    this.state = 'unselected';
  }

  update(detections: PoseDetection[], now: number): {
    state: TrackingState;
    active: PoseDetection | null;
    activeId: number | null;
    candidates: Array<{ id: number; bbox: PoseDetection['bbox']; score: number }>;
  } {
    const dt = Math.max(1, now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    // Predict existing subjects forward with constant velocity.
    for (const s of this.subjects.values()) {
      s.predictedBbox = {
        x: s.bbox.x + s.velocity.x * dt,
        y: s.bbox.y + s.velocity.y * dt,
        w: s.bbox.w, h: s.bbox.h,
      };
    }

    // Greedy association of detections to known subjects.
    const unmatched = new Set(detections.map((_, i) => i));
    const assignments = new Map<number, number>(); // detectionIdx -> subjectId
    for (const [sid, subj] of this.subjects) {
      let best = -1; let bestCost = Infinity;
      detections.forEach((d, di) => {
        if (!unmatched.has(di)) return;
        const c = centroidOf(d.landmarks);
        const pred = subj.predictedBbox ?? subj.bbox;
        const px = pred.x + pred.w / 2; const py = pred.y + pred.h / 2;
        const dist = Math.hypot(c.x - px, c.y - py);
        const g = torsoGeom(d.landmarks);
        const geomPenalty =
          Math.abs(g.torsoHeight - subj.torsoHeight) * 2
          + Math.abs(g.shoulderWidth - subj.shoulderWidth) * 2;
        const cost = dist * 2 + (1 - iou(d.bbox, pred)) + geomPenalty + (1 - d.score) * 0.5;
        if (cost < bestCost) { bestCost = cost; best = di; }
      });
      if (best >= 0 && bestCost < this.matchThreshold * 2) {
        assignments.set(best, sid);
        unmatched.delete(best);
      }
    }
    // New subjects for unmatched detections.
    for (const di of unmatched) {
      const id = this.nextId++;
      const d = detections[di];
      const c = centroidOf(d.landmarks);
      const g = torsoGeom(d.landmarks);
      this.subjects.set(id, {
        id, bbox: d.bbox, centroid: c, velocity: { x: 0, y: 0 },
        torsoHeight: g.torsoHeight, shoulderWidth: g.shoulderWidth,
        lastSeen: now, confidence: d.score, predictedBbox: null,
      });
      assignments.set(di, id);
    }
    // Refresh matched subjects.
    for (const [di, sid] of assignments) {
      const d = detections[di];
      const s = this.subjects.get(sid);
      if (!s) continue;
      const c = centroidOf(d.landmarks);
      s.velocity = { x: (c.x - s.centroid.x) / dt, y: (c.y - s.centroid.y) / dt };
      s.centroid = c; s.bbox = d.bbox; s.lastSeen = now; s.confidence = d.score;
      const g = torsoGeom(d.landmarks);
      s.torsoHeight = s.torsoHeight * 0.9 + g.torsoHeight * 0.1;
      s.shoulderWidth = s.shoulderWidth * 0.9 + g.shoulderWidth * 0.1;
    }
    // Prune stale subjects (but never the active one while reacquiring).
    for (const [sid, s] of this.subjects) {
      if (sid !== this.activeSubjectId && now - s.lastSeen > 5000) this.subjects.delete(sid);
    }

    const candidates = [...this.subjects.values()].map((s) => ({ id: s.id, bbox: s.bbox, score: s.confidence }));

    if (this.activeSubjectId === null) {
      this.state = 'unselected';
      return { state: this.state, active: null, activeId: null, candidates };
    }
    // Find the active subject's detection in this frame.
    let active: PoseDetection | null = null;
    for (const [di, sid] of assignments) {
      if (sid === this.activeSubjectId) { active = detections[di]; break; }
    }
    if (active) {
      this.state = 'locked';
      this.lostSince = 0;
      this.reacquireUntil = 0;
    } else {
      if (this.state === 'locked' || this.state === 'unselected') {
        this.state = 'reacquiring';
        this.lostSince = now;
        this.reacquireUntil = now + this.reacquireWindowMs;
      } else if (this.state === 'reacquiring' && now > this.reacquireUntil) {
        this.state = 'lost';
      }
    }
    return { state: this.state, active, activeId: this.activeSubjectId, candidates };
  }

  get continuity(): number {
    if (this.state === 'locked') return 1;
    if (this.state === 'reacquiring') return 0.5;
    return 0;
  }
}
