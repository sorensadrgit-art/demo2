import type { NormalizedLandmark } from '../pose/poseTypes';
import { JOINT_DEFS, type JointId } from '../biomechanics/jointAngles';

// High-quality animated angle arc around the selected joint vertex.
export function drawAngleArc(
  ctx: CanvasRenderingContext2D,
  lms: NormalizedLandmark[],
  joint: JointId,
  angle: number,
  W: number, H: number,
  t: number,
) {
  const def = JOINT_DEFS[joint];
  const [ia, ib, ic] = def.triple;
  const A = lms[ia]; const B = lms[ib]; const C = lms[ic];
  if (!A || !B || !C || !Number.isFinite(angle)) return;
  const bx = B.x * W; const by = B.y * H;
  const v1 = { x: A.x * W - bx, y: A.y * H - by };
  const v2 = { x: C.x * W - bx, y: C.y * H - by };
  const a1 = Math.atan2(v1.y, v1.x);
  const a2 = Math.atan2(v2.y, v2.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const R = 44;
  const pulse = 1 + 0.04 * Math.sin(t / 280);
  ctx.save();
  ctx.strokeStyle = 'rgba(56,189,248,0.28)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(bx, by, R * pulse, a1, a1 + sweep, sweep < 0);
  ctx.stroke();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(bx, by, R * pulse, a1, a1 + sweep, sweep < 0);
  ctx.stroke();
  // Limb direction rays
  ctx.strokeStyle = 'rgba(56,189,248,0.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  for (const v of [v1, v2]) {
    const m = Math.hypot(v.x, v.y) || 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + (v.x / m) * (R + 26), by + (v.y / m) * (R + 26));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Value label
  const mid = a1 + sweep / 2;
  const lx = bx + Math.cos(mid) * (R + 40);
  const ly = by + Math.sin(mid) * (R + 40);
  ctx.font = '600 15px "IBM Plex Mono", monospace';
  const text = `${angle.toFixed(1)}°`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(4,10,18,0.85)';
  ctx.strokeStyle = 'rgba(56,189,248,0.6)';
  ctx.lineWidth = 1;
  const pad = 6;
  ctx.beginPath();
  ctx.roundRect(lx - tw / 2 - pad, ly - 12 - pad + 4, tw + pad * 2, 24, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eaf6ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx, ly + 1);
  ctx.restore();
}
