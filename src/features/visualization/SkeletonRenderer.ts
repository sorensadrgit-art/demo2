import { SKELETON_EDGES, type NormalizedLandmark } from '../pose/poseTypes';
import type { JointId } from '../biomechanics/jointAngles';
import { jointVertexIndex } from './jointMap';

// Anatomically meaningful nodes: small precise markers, brighter on the
// active joint's chain, subdued elsewhere. Never oversized decorative dots.
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lms: NormalizedLandmark[],
  W: number, H: number,
  opts: { activeJoint: JointId; dimOthers: boolean; ghost?: boolean },
) {
  const active = jointVertexIndex(opts.activeJoint);
  ctx.save();
  if (opts.ghost) ctx.globalAlpha = 0.28;
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_EDGES) {
    const A = lms[a]; const B = lms[b];
    if (!A || !B || A.visibility < 0.25 || B.visibility < 0.25) continue;
    const hot = a === active || b === active;
    ctx.strokeStyle = opts.ghost ? '#7dd3fc' : hot ? '#e8f4ff' : 'rgba(148,178,205,0.42)';
    ctx.lineWidth = hot ? 2.4 : 1.4;
    ctx.beginPath();
    ctx.moveTo(A.x * W, A.y * H);
    ctx.lineTo(B.x * W, B.y * H);
    ctx.stroke();
  }
  for (let i = 0; i < lms.length; i++) {
    const l = lms[i];
    if (!l || l.visibility < 0.25) continue;
    const hot = i === active;
    const r = hot ? 5 : i % 2 === 0 ? 2.6 : 2.2;
    ctx.fillStyle = opts.ghost ? '#7dd3fc' : hot ? '#ffffff' : 'rgba(180,205,228,0.75)';
    ctx.beginPath();
    ctx.arc(l.x * W, l.y * H, r, 0, Math.PI * 2);
    ctx.fill();
    if (hot && !opts.ghost) {
      ctx.strokeStyle = 'rgba(56,189,248,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(l.x * W, l.y * H, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
