import { CONFIDENCE_STYLE, type ConfidenceLevel } from '../biomechanics/confidence';

// Tracking-confidence indicators: per-landmark halo dimming + banner state.
// Text labels always accompany color (never color-alone communication).
export function confidenceColor(level: ConfidenceLevel): string {
  return CONFIDENCE_STYLE[level].color;
}

export function drawTrackingBanner(
  ctx: CanvasRenderingContext2D,
  state: 'locked' | 'reacquiring' | 'lost' | 'unselected',
  W: number,
  activeId: number | null,
) {
  const label =
    state === 'locked' ? `TARGET ${activeId ?? ''} · LOCKED`
    : state === 'reacquiring' ? 'REACQUIRING TARGET…'
    : state === 'lost' ? 'TARGET LOST' : 'SELECT PATIENT TO LOCK';
  const color =
    state === 'locked' ? '#4ade80'
    : state === 'reacquiring' ? '#fbbf24'
    : state === 'lost' ? '#fb7185' : '#94a3b8';
  ctx.save();
  ctx.font = '600 11px Inter, sans-serif';
  const tw = ctx.measureText(label).width;
  const x = 12; const y = 12;
  ctx.fillStyle = 'rgba(3,8,15,0.78)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, tw + 34, 26, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 12, y + 13, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 22, y + 14);
  void W;
  ctx.restore();
}
