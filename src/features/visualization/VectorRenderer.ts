import type { NormalizedLandmark } from '../pose/poseTypes';

// Movement vectors: instantaneous joint velocity arrows for distal joints.
export function drawVectors(
  ctx: CanvasRenderingContext2D,
  lms: NormalizedLandmark[],
  velocities: Map<number, { x: number; y: number }>,
  W: number, H: number,
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(163,230,53,0.8)';
  ctx.fillStyle = 'rgba(163,230,53,0.9)';
  ctx.lineWidth = 1.4;
  for (const [idx, v] of velocities) {
    const l = lms[idx];
    if (!l || l.visibility < 0.3) continue;
    const mag = Math.hypot(v.x, v.y);
    if (mag < 0.0004) continue;
    const scale = Math.min(90, 26 + mag * 900);
    const nx = v.x / mag; const ny = v.y / mag;
    const x0 = l.x * W; const y0 = l.y * H;
    const x1 = x0 + nx * scale; const y1 = y0 + ny * scale;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const ah = 5;
    const ang = Math.atan2(ny, nx);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ah * Math.cos(ang - 0.45), y1 - ah * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - ah * Math.cos(ang + 0.45), y1 - ah * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
