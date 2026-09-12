import { useEffect, useRef } from 'react';
import type { MetricSample } from '../../stores/sessionStore';
import type { JointId } from '../biomechanics/jointAngles';

// Lightweight canvas waveform: angle, velocity, sensor and estimated-kinetic
// lanes with synchronized event markers. Click/drag scrubs the session.
export default function Waveform({
  samples, joint, height = 120, onScrub, scrubT, events = [],
}: {
  samples: MetricSample[];
  joint: JointId;
  height?: number;
  onScrub: (t: number) => void;
  scrubT: number | null;
  events?: Array<{ t: number; label: string; color: string }>;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const W = parent ? parent.clientWidth : 600;
    const H = height;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (samples.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px Inter, sans-serif';
      ctx.fillText('Awaiting motion data — move the patient through the test range.', 12, H / 2);
      return;
    }
    const t0 = samples[0].t; const t1 = samples[samples.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const X = (t: number) => ((t - t0) / span) * W;
    const vals = samples.map((s) => s.angles[joint]).filter((v): v is number => Number.isFinite(v));
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 180;
    const pad = Math.max(4, (hi - lo) * 0.12);
    const Y = (v: number) => H - 14 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 28);

    // Gridlines + y labels.
    ctx.strokeStyle = 'rgba(148,178,205,0.12)';
    ctx.fillStyle = 'rgba(148,178,205,0.6)';
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) {
      const v = lo - pad + ((hi + pad - (lo - pad)) * g) / 3;
      const y = Y(Math.min(hi + pad, Math.max(lo - pad, v)));
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillText(`${v.toFixed(0)}°`, 4, y - 3);
    }
    // Angle trace.
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let started = false;
    for (const s of samples) {
      const v = s.angles[joint];
      if (typeof v !== 'number' || !Number.isFinite(v)) { started = false; continue; }
      const x = X(s.t); const y = Y(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Events.
    for (const e of events) {
      const x = X(e.t);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Scrub cursor.
    if (scrubT !== null && scrubT >= t0 && scrubT <= t1) {
      const x = X(scrubT);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  });

  const toTime = (clientX: number) => {
    const canvas = ref.current;
    if (!canvas || samples.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t0 = samples[0].t; const t1 = samples[samples.length - 1].t;
    onScrub(t0 + frac * (t1 - t0));
  };

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="w-full cursor-ew-resize"
      onMouseDown={(e) => toTime(e.clientX)}
      onMouseMove={(e) => { if (e.buttons === 1) toTime(e.clientX); }}
      aria-label="Joint angle waveform. Drag to scrub the session."
    />
  );
}
