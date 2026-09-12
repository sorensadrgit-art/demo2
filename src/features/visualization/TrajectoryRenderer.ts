// Motion trails + center-of-mass approximation overlay.
export function drawTrails(
  ctx: CanvasRenderingContext2D,
  trails: Map<number, Array<{ x: number; y: number }>>,
  W: number, H: number,
  activeIdx: number,
) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const [idx, pts] of trails) {
    if (pts.length < 2) continue;
    const hot = idx === activeIdx;
    ctx.strokeStyle = hot ? 'rgba(56,189,248,0.85)' : 'rgba(125,211,252,0.28)';
    ctx.lineWidth = hot ? 2 : 1.2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const X = p.x * W; const Y = p.y * H;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCOM(
  ctx: CanvasRenderingContext2D,
  com: { x: number; y: number } | null,
  W: number, H: number,
) {
  if (!com) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(232,244,255,0.9)';
  ctx.lineWidth = 1.4;
  const X = com.x * W; const Y = com.y * H;
  ctx.beginPath();
  ctx.arc(X, Y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(X - 12, Y); ctx.lineTo(X + 12, Y);
  ctx.moveTo(X, Y - 12); ctx.lineTo(X, Y + 12);
  ctx.stroke();
  ctx.font = '500 9px Inter, sans-serif';
  ctx.fillStyle = 'rgba(200,220,240,0.85)';
  ctx.textAlign = 'left';
  ctx.fillText('COM ≈', X + 11, Y - 9);
  ctx.restore();
}

export function drawCenterline(
  ctx: CanvasRenderingContext2D,
  top: { x: number; y: number } | null,
  bottom: { x: number; y: number } | null,
  W: number, H: number,
) {
  if (!top || !bottom) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(148,178,205,0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(top.x * W, top.y * H);
  ctx.lineTo(bottom.x * W, bottom.y * H);
  ctx.stroke();
  ctx.restore();
}
