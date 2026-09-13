import type { NormalizedLandmark } from '../pose/poseTypes';
import { JOINT_DEFS, type JointId } from '../biomechanics/jointAngles';
import type { ConfidenceLevel } from '../biomechanics/confidence';

/**
 * Zero-chrome clinical overlay: ONLY the active protocol joint is rendered.
 * Small anatomical anchors → two segment rays → angle arc with directional
 * arrowhead → live value attached to the joint. Drawn from the locked
 * patient's landmarks only; never from candidates. Runs in the canvas
 * rAF loop — no React state at frame frequency.
 */

export type OverlayVisibility = 'full' | 'fade' | 'hidden';

export function overlayVisibilityFor(level: ConfidenceLevel, jointValid: boolean): OverlayVisibility {
  if (!jointValid || level === 'suspended') return 'hidden';
  if (level === 'low') return 'fade';
  return 'full';
}

/** Hysteresis-guarded movement direction (no flicker at zero crossing). */
export class DirectionState {
  private dir: 1 | -1 | 0 = 0;
  /** Deadband half-width (°/s) + confirmation frames. */
  constructor(private deadband = 10, private confirmFrames = 3) {}
  private pending: 1 | -1 | 0 = 0;
  private pendingN = 0;

  /** Flexion-positive velocity in the joint's display convention. */
  push(vel: number): 1 | -1 | 0 {
    const want: 1 | -1 | 0 = vel > this.deadband ? 1 : vel < -this.deadband ? -1 : 0;
    if (want === this.dir) { this.pending = 0; this.pendingN = 0; return this.dir; }
    if (want === 0) {
      // Near zero: keep the previous stable direction (gently neutral only
      // after a long stillness is handled by callers resetting).
      this.pending = 0; this.pendingN = 0;
      return this.dir;
    }
    if (want === this.pending) {
      this.pendingN += 1;
      if (this.pendingN >= this.confirmFrames) {
        this.dir = want; this.pending = 0; this.pendingN = 0;
      }
    } else {
      this.pending = want; this.pendingN = 1;
    }
    return this.dir;
  }

  get direction(): 1 | -1 | 0 {
    return this.dir;
  }

  reset() {
    this.dir = 0; this.pending = 0; this.pendingN = 0;
  }
}

const directionStates = new Map<string, DirectionState>();

export function directionFor(joint: JointId, vel: number): 1 | -1 | 0 {
  let d = directionStates.get(joint);
  if (!d) { d = new DirectionState(); directionStates.set(joint, d); }
  return d.push(vel);
}

export function resetDirections() {
  directionStates.clear();
}

interface Pt { x: number; y: number }

function arrowhead(ctx: CanvasRenderingContext2D, tip: Pt, angle: number, size: number, color: string) {
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x + Math.cos(a1) * size, tip.y + Math.sin(a1) * size);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x + Math.cos(a2) * size, tip.y + Math.sin(a2) * size);
  ctx.stroke();
}

export interface ClinicalOverlayInput {
  lms: NormalizedLandmark[];
  joint: JointId;
  angle: number;
  vel: number;
  level: ConfidenceLevel;
  jointValid: boolean;
  t: number;
}

/**
 * Draw the active-joint goniometer. Returns the visibility state applied so
 * tests can assert hidden-vs-drawn without pixel inspection.
 */
export function drawClinicalOverlay(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  input: ClinicalOverlayInput,
): OverlayVisibility {
  const vis = overlayVisibilityFor(input.level, input.jointValid);
  if (vis === 'hidden') return vis;
  const def = JOINT_DEFS[input.joint];
  const [ia, ib, ic] = def.triple;
  const A = input.lms[ia]; const B = input.lms[ib]; const C = input.lms[ic];
  if (!A || !B || !C || A.visibility < 0.2 || B.visibility < 0.2 || C.visibility < 0.2) return 'hidden';
  if (!Number.isFinite(input.angle)) return 'hidden';

  const bx = B.x * W; const by = B.y * H;
  const v1 = { x: A.x * W - bx, y: A.y * H - by };
  const v2 = { x: C.x * W - bx, y: C.y * H - by };
  const m1 = Math.hypot(v1.x, v1.y) || 1;
  const m2 = Math.hypot(v2.x, v2.y) || 1;
  const a1 = Math.atan2(v1.y, v1.x);
  let a2 = Math.atan2(v2.y, v2.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  a2 = a1 + sweep;

  // Radius proportional to visible limb length, bounded for readability.
  const limbPx = Math.min(m1, m2);
  const R = Math.max(30, Math.min(76, limbPx * 0.32));
  const dir = directionFor(input.joint, input.vel);

  ctx.save();
  if (vis === 'fade') ctx.globalAlpha = 0.45;

  // Segment rays (thin, precise — not a full skeleton).
  ctx.strokeStyle = 'rgba(232,244,255,0.92)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (const [v, m] of [[v1, m1], [v2, m2]] as const) {
    const len = Math.min(m, limbPx * 0.85);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (v.x / m) * len, by + (v.y / m) * len);
    ctx.stroke();
  }

  // Angle arc between the limb rays.
  const pulse = 1 + 0.03 * Math.sin(input.t / 300);
  ctx.strokeStyle = 'rgba(56,189,248,0.30)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(bx, by, R * pulse, a1, a2, sweep < 0);
  ctx.stroke();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(bx, by, R * pulse, a1, a2, sweep < 0);
  ctx.stroke();

  // Directional arrowhead at the moving-ray end of the arc.
  if (dir !== 0) {
    const endAngle = dir === 1 ? a2 : a1;
    const tip = { x: bx + Math.cos(endAngle) * R * pulse, y: by + Math.sin(endAngle) * R * pulse };
    const tangent = endAngle + (dir === 1 ? 1 : -1) * (Math.PI / 2) * (sweep < 0 ? -1 : 1);
    arrowhead(ctx, tip, tangent, 9, '#7dd3fc');
    // Small arc-direction tick at the other end for readability.
    void tangent;
  }

  // Anatomical anchors: precise, small — joint vertex emphasized.
  const anchors: Array<{ p: Pt; hot: boolean }> = [
    { p: { x: A.x * W, y: A.y * H }, hot: false },
    { p: { x: bx, y: by }, hot: true },
    { p: { x: C.x * W, y: C.y * H }, hot: false },
  ];
  for (const a of anchors) {
    ctx.fillStyle = a.hot ? '#ffffff' : 'rgba(232,244,255,0.9)';
    ctx.beginPath();
    ctx.arc(a.p.x, a.p.y, a.hot ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fill();
    if (a.hot) {
      ctx.strokeStyle = 'rgba(56,189,248,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(a.p.x, a.p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Live value near the arc, offset so it never covers the joint.
  const mid = a1 + sweep / 2;
  const lx = bx + Math.cos(mid) * (R + 34);
  const ly = by + Math.sin(mid) * (R + 34);
  ctx.font = '700 16px "IBM Plex Mono", monospace';
  const text = `${input.angle.toFixed(0)}°`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(4,10,18,0.88)';
  ctx.strokeStyle = 'rgba(56,189,248,0.65)';
  ctx.lineWidth = 1;
  const pad = 6;
  ctx.beginPath();
  ctx.roundRect(lx - tw / 2 - pad, ly - 13, tw + pad * 2, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eaf6ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Readable against light or dark clothing: dark pill + bright text.
  ctx.fillText(text, lx, ly);
  ctx.restore();
  return vis;
}
